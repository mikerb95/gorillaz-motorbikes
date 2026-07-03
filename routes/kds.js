'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');

const { JWT_SECRET } = require('../config');
const { requireKdsEmployee, authLimiter } = require('../middleware/auth');
const { requirePin, verifyPinHandler } = require('../middleware/employeePin');
const settings = require('../helpers/settings');
const { EMP_STATUS, ALLOWED_STATUS } = require('../helpers/service-order-status');
const {
  getActiveEmployees, getEmployeeById,
  isThrottleLocked, recordThrottleFailure,
  getActiveServiceOrders, getServiceOrdersByPlate, getServiceOrderById,
  createServiceOrder, updateServiceOrder, addServiceOrderEvent,
  convertServiceOrderToInvoice,
} = require('../db');

const router = express.Router();

// Throttle propio (clave separada de 'taller_pin') para que un ataque contra
// un panel no bloquee el PIN del otro, aunque la lógica de validación es igual.
const PIN_THROTTLE_KEY = 'kds_pin';
const PIN_WINDOW_MS    = 15 * 60 * 1000;
const PIN_MAX_FAILURES = 20;

function readDataJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')); }
  catch { return fallback; }
}
function loadServicesCatalog() {
  return settings.get('services_catalog') ?? readDataJson('services-catalog.json', []);
}

function nowCOT() {
  const cot = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return cot.toISOString().replace('Z', '-05:00');
}

// ── Sesión de empleado en la tablet (cookie propia kds_jwt, vida corta) ────
async function loadKdsEmployee(req, res, next) {
  const token = req.cookies.kds_jwt;
  req.employee = null;
  if (token) {
    try {
      const { eid } = jwt.verify(token, JWT_SECRET);
      const emp = await getEmployeeById(eid);
      if (emp && emp.active) req.employee = emp;
    } catch { /* token inválido o expirado */ }
  }
  res.locals.employee = req.employee;
  next();
}
router.use(loadKdsEmployee);

// Verifica el PIN para el modal de acciones sensibles (facturar, cambiar estado…).
router.post('/verificar-pin', requireKdsEmployee, verifyPinHandler);

function startKdsSession(res, emp, redirectTo) {
  const token = jwt.sign({ eid: emp.id }, JWT_SECRET, { expiresIn: '4h' });
  res.cookie('kds_jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4,
  });
  res.redirect(redirectTo || '/kds');
}

// ── Login / logout (solo PIN — la tablet no maneja correo/contraseña) ─────
router.get('/login', (req, res) => {
  res.render('kds/login', { error: null, next: req.query.next || '' });
});

router.post('/login', authLimiter, async (req, res) => {
  const pin  = String(req.body.pin || '').trim();
  const next = String(req.body.next || '');
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).render('kds/login', { error: 'PIN inválido.', next });
  }
  if (await isThrottleLocked(PIN_THROTTLE_KEY, PIN_MAX_FAILURES, PIN_WINDOW_MS)) {
    return res.status(429).render('kds/login', { error: 'Demasiados intentos. Espera unos minutos.', next });
  }
  const employees = await getActiveEmployees();
  let matched = null;
  for (const emp of employees) {
    if (emp.pinHash && await bcrypt.compare(pin, emp.pinHash)) { matched = emp; break; }
  }
  if (!matched) {
    await recordThrottleFailure(PIN_THROTTLE_KEY, PIN_WINDOW_MS);
    return res.status(401).render('kds/login', { error: 'PIN incorrecto.', next });
  }
  return startKdsSession(res, matched, next && next.startsWith('/kds') ? next : '/kds');
});

router.post('/logout', (req, res) => {
  res.clearCookie('kds_jwt');
  res.redirect('/kds/login');
});

// ── Tablero (visible sin sesión; las acciones se ocultan sin empleado) ────
router.get('/', async (req, res) => {
  const orders = await getActiveServiceOrders();
  res.render('kds/board', { orders, EMP_STATUS, flash: req.query.flash || null });
});

router.get('/orders.json', async (req, res) => {
  const orders = await getActiveServiceOrders();
  res.json(orders.map(o => ({
    id: o.id, label: o.label, motorcycle: o.motorcycle, mechanic: o.mechanic,
    status: o.status, total: o.total, itemCount: o.items.length, createdAt: o.createdAt,
  })));
});

// ── Buscar por placa ────────────────────────────────────────────────────
router.get('/placa', (req, res) => {
  res.render('kds/placa', { error: null });
});

router.get('/placa/buscar', async (req, res) => {
  const placa = String(req.query.placa || '').trim();
  if (!placa) return res.redirect('/kds/placa');
  const matches = await getServiceOrdersByPlate(placa);
  const active  = matches.find(o => !['facturado', 'entregado'].includes(o.status));
  if (active) return res.redirect('/kds/orden/' + active.id);
  if (!req.employee) return res.redirect('/kds/login?next=' + encodeURIComponent('/kds/orden/nueva?placa=' + encodeURIComponent(placa)));
  return res.redirect('/kds/orden/nueva?placa=' + encodeURIComponent(placa));
});

// ── Crear orden nueva desde placa ──────────────────────────────────────
router.get('/orden/nueva', requireKdsEmployee, (req, res) => {
  const placa   = String(req.query.placa || '').trim();
  const catalog = loadServicesCatalog();
  res.render('kds/order-new', { placa, catalog, error: null });
});

router.post('/orden/nueva', requireKdsEmployee, requirePin('/kds'), async (req, res) => {
  const placa = String(req.body.placa || '').trim();
  const catalog = loadServicesCatalog();
  if (!placa) {
    return res.status(400).render('kds/order-new', { placa, catalog, error: 'La placa es obligatoria.' });
  }

  let items;
  try { items = JSON.parse(req.body.items || '[]'); } catch { items = null; }
  const clean = Array.isArray(items) ? items.reduce((acc, it) => {
    const name  = String(it.name || '').trim();
    const price = Math.round(Number(it.price));
    const qty   = Math.round(Number(it.qty));
    if (name && Number.isInteger(price) && price >= 1 && Number.isInteger(qty) && qty >= 1) {
      acc.push({ name: name.slice(0, 200), type: it.type || 'custom', price, qty });
    }
    return acc;
  }, []) : [];

  if (clean.length === 0) {
    return res.status(400).render('kds/order-new', { placa, catalog, error: 'Agrega al menos un ítem válido (nombre, cantidad y precio).' });
  }

  const total = clean.reduce((s, it) => s + it.price * it.qty, 0);

  const { id } = await createServiceOrder({
    items:              clean,
    total,
    motorcycle:         placa,
    clientPhone:        (req.body.clientPhone || '').trim() || null,
    clientPhoneCountry: '+57',
    mechanic:           req.employee.name,
    notes:              (req.body.notes || '').trim() || null,
    employeeId:         req.employee.id,
    status:             'ingreso_taller',
    actor:              req.pinActor,
  });

  res.redirect('/kds/orden/' + id);
});

// ── Detalle de orden (visible para cualquier empleado, no solo el asignado) ─
router.get('/orden/:id', async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/kds');
  const catalog = loadServicesCatalog();
  res.render('kds/order-detail', { order, EMP_STATUS, catalog });
});

router.post('/orden/:id/estado', requireKdsEmployee, requirePin('/kds'), async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/kds');

  const status = req.body.status;
  if (!ALLOWED_STATUS.includes(status)) return res.redirect('/kds/orden/' + order.id);

  const updates = { status };
  const finaliza = status === 'trabajo_completo' && order.status !== 'trabajo_completo';
  if (finaliza) {
    if (!order.trabajoCompletoAt) updates.trabajoCompletoAt = nowCOT();
    updates.pendingReview = true;
  }
  await updateServiceOrder(order.id, updates, req.pinActor);

  // Al quedar lista la moto se emite la factura proforma automáticamente: es
  // el único momento en que se sabe con certeza si aplica parqueadero, así que
  // el total definitivo se cierra recién al entregar la moto (panel admin).
  if (finaliza) {
    try {
      await convertServiceOrderToInvoice({ ...order, status: 'trabajo_completo', invoiceId: null }, {}, req.pinActor);
    } catch (e) {
      console.error('Auto-facturación proforma falló:', e.message);
    }
  }

  res.redirect('/kds/orden/' + order.id);
});

router.post('/orden/:id/items', requireKdsEmployee, requirePin('/kds'), async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/kds');

  const name  = String(req.body.name || '').trim();
  const price = Math.round(Number(req.body.price));
  const qty   = Math.round(Number(req.body.qty));
  if (name && Number.isInteger(price) && price >= 1 && Number.isInteger(qty) && qty >= 1) {
    const items = [...order.items, { name: name.slice(0, 200), type: req.body.type || 'custom', price, qty }];
    const total = items.reduce((s, it) => s + it.price * it.qty, 0);
    await updateServiceOrder(order.id, { items, total }, req.pinActor);
    await addServiceOrderEvent(order.id, 'editado', req.pinActor, `+ ${name} ×${qty}`);
  }

  res.redirect('/kds/orden/' + order.id);
});

module.exports = router;
