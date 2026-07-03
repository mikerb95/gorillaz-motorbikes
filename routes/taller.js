'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const jwt     = require('jsonwebtoken');
const bcrypt  = require('bcryptjs');

const { JWT_SECRET, resendClient } = require('../config');
const { requireEmployee, authLimiter } = require('../middleware/auth');
const { requirePin, verifyPinHandler } = require('../middleware/employeePin');
const settings = require('../helpers/settings');
const {
  getActiveEmployees, getEmployeeById, getEmployeeByUserId, getUserByEmail,
  getServiceOrdersByEmployee, getServiceOrderById, updateServiceOrder,
  isThrottleLocked, recordThrottleFailure,
  getPendingCheckins, getPendingCheckinsByPlate, getCheckinById, markCheckinAttended, createServiceOrder,
} = require('../db');

const router = express.Router();

// Anti fuerza bruta para el login por PIN. Tope global de fallos en una ventana:
// frena ataques distribuidos (IPs rotativas) que el límite por-IP no detiene.
// El acceso por correo+contraseña sigue disponible si el PIN queda bloqueado.
const PIN_THROTTLE_KEY  = 'taller_pin';
const PIN_WINDOW_MS     = 15 * 60 * 1000;
const PIN_MAX_FAILURES  = 20;

const { EMP_STATUS, ALLOWED_STATUS } = require('../helpers/service-order-status');

const PDF_CONFIG_PATH = path.join(__dirname, '..', 'data', 'quotation-pdf-config.json');
function adminEmail() {
  if (process.env.ADMIN_EMAIL) return process.env.ADMIN_EMAIL;
  let cfg = settings.get('pdf');
  if (cfg === undefined) {
    try { cfg = JSON.parse(fs.readFileSync(PDF_CONFIG_PATH, 'utf8')); }
    catch { cfg = null; }
  }
  if (cfg && cfg.email) return cfg.email;
  return 'info@gorillazmotorbikes.com';
}

// Fecha en hora Colombia (-05:00), igual que en routes/admin.js.
function nowCOT() {
  const cot = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return cot.toISOString().replace('Z', '-05:00');
}

// ── Sesión de empleado (cookie propia emp_jwt) ─────────────────────────────
async function loadEmployee(req, res, next) {
  const token = req.cookies.emp_jwt;
  req.employee = null;
  if (token) {
    try {
      const { eid } = jwt.verify(token, JWT_SECRET);
      const emp = await getEmployeeById(eid);
      if (emp && emp.active) req.employee = emp;
    } catch { /* token inválido */ }
  }
  res.locals.employee = req.employee;
  next();
}
router.use(loadEmployee);

// Verifica el PIN para el modal de acciones sensibles (crear orden, cambiar estado).
router.post('/verificar-pin', requireEmployee, verifyPinHandler);

// ── Login ──────────────────────────────────────────────────────────────────
router.get('/login', (req, res) => {
  if (req.employee) return res.redirect('/taller');
  res.render('taller/login', { error: null });
});

// Emite la cookie de sesión del empleado y entra al portal.
function startEmployeeSession(res, emp) {
  const token = jwt.sign({ eid: emp.id }, JWT_SECRET, { expiresIn: '1d' });
  res.cookie('emp_jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24,
  });
  res.redirect('/taller');
}

router.post('/login', authLimiter, async (req, res) => {
  const email    = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');

  // Vía 1: empleado ligado a un usuario de la web → correo + contraseña.
  if (email || password) {
    const user = email ? await getUserByEmail(email) : null;
    if (!user || !user.password || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).render('taller/login', { error: 'Correo o contraseña incorrectos.' });
    }
    const emp = await getEmployeeByUserId(user.id);
    if (!emp || !emp.active) {
      return res.status(403).render('taller/login', { error: 'Esta cuenta no está habilitada como empleado.' });
    }
    return startEmployeeSession(res, emp);
  }

  // Vía 2: empleado con PIN.
  const pin = String(req.body.pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) {
    return res.status(400).render('taller/login', { error: 'PIN inválido.' });
  }
  if (await isThrottleLocked(PIN_THROTTLE_KEY, PIN_MAX_FAILURES, PIN_WINDOW_MS)) {
    return res.status(429).render('taller/login', {
      error: 'Demasiados intentos con PIN. Espera unos minutos o entra con tu correo y contraseña.',
    });
  }
  const employees = await getActiveEmployees();
  let matched = null;
  for (const emp of employees) {
    if (emp.pinHash && await bcrypt.compare(pin, emp.pinHash)) { matched = emp; break; }
  }
  if (!matched) {
    await recordThrottleFailure(PIN_THROTTLE_KEY, PIN_WINDOW_MS);
    return res.status(401).render('taller/login', { error: 'PIN incorrecto.' });
  }
  return startEmployeeSession(res, matched);
});

router.post('/logout', (req, res) => {
  res.clearCookie('emp_jwt');
  res.redirect('/taller/login');
});

// ── Lista de órdenes asignadas ─────────────────────────────────────────────
router.get('/', requireEmployee, async (req, res) => {
  const orders = await getServiceOrdersByEmployee(req.employee.id);
  res.render('taller/orders', { orders, EMP_STATUS });
});

// ── Check-ins pendientes (clientes que registraron su ingreso por QR) ─────
router.get('/checkin', requireEmployee, async (req, res) => {
  const placa = String(req.query.placa || '').trim();
  const checkins = placa ? await getPendingCheckinsByPlate(placa) : await getPendingCheckins();
  res.render('taller/checkin-queue', { checkins, placa });
});

// ── Crear orden de servicio a partir de un check-in ────────────────────────
router.get('/checkin/:id/orden', requireEmployee, async (req, res) => {
  const checkin = await getCheckinById(req.params.id);
  if (!checkin || checkin.status !== 'pendiente') return res.redirect('/taller/checkin');
  res.render('taller/service-order-new', { checkin, error: null });
});

router.post('/checkin/:id/orden', requireEmployee, requirePin('/taller/checkin'), async (req, res) => {
  const checkin = await getCheckinById(req.params.id);
  if (!checkin || checkin.status !== 'pendiente') return res.redirect('/taller/checkin');

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
    return res.status(400).render('taller/service-order-new', { checkin, error: 'Agrega al menos un ítem válido (nombre, cantidad y precio).' });
  }

  const total      = clean.reduce((s, it) => s + it.price * it.qty, 0);
  const motorcycle = [checkin.plate, [checkin.brand, checkin.reference].filter(Boolean).join(' ')].filter(Boolean).join(' — ') || null;

  const { id } = await createServiceOrder({
    items:              clean,
    total,
    motorcycle,
    clientPhone:        checkin.clientPhone,
    clientPhoneCountry: checkin.clientPhoneCountry,
    mechanic:           req.employee.name,
    notes:              `Cliente: ${checkin.clientName}`,
    employeeId:         req.employee.id,
    status:             'ingreso_taller',
    actor:              req.pinActor,
  });

  await markCheckinAttended(checkin.id, id);

  res.redirect('/taller/orden/' + id);
});

// ── Detalle de una orden propia ────────────────────────────────────────────
router.get('/orden/:id', requireEmployee, async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order || order.employeeId !== req.employee.id) return res.redirect('/taller');
  res.render('taller/order-detail', { order, EMP_STATUS });
});

// ── Actualizar estado (limitado) ───────────────────────────────────────────
router.post('/orden/:id/estado', requireEmployee, requirePin('/taller'), async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order || order.employeeId !== req.employee.id) return res.redirect('/taller');

  const status = req.body.status;
  if (!ALLOWED_STATUS.includes(status)) return res.redirect('/taller/orden/' + order.id);

  const updates = { status };
  // Al finalizar: marcar momento, avisar al admin y dejar pendiente de revisión.
  const finaliza = status === 'trabajo_completo' && order.status !== 'trabajo_completo';
  if (finaliza) {
    if (!order.trabajoCompletoAt) updates.trabajoCompletoAt = nowCOT();
    updates.pendingReview = true;
  }
  await updateServiceOrder(order.id, updates, req.pinActor);

  if (finaliza) notifyAdmin(order, req.employee).catch(() => {});

  res.redirect('/taller/orden/' + order.id);
});

// Aviso por correo al admin cuando una orden queda finalizada por un empleado.
async function notifyAdmin(order, employee) {
  const to = adminEmail();
  await resendClient.emails.send({
    from: 'boletin@gorillazmotorbikes.com',
    to,
    subject: `Orden ${order.label} lista para revisar`,
    html: `
      <p>El empleado <strong>${employee.name}</strong> marcó la orden
      <strong>${order.label}</strong> como <strong>Trabajo completo</strong>.</p>
      <p>Moto / Placa: <strong>${order.motorcycle || '—'}</strong></p>
      <p>Ya puedes contactar al cliente, generar el PDF/factura y marcarla como pagada desde el panel.</p>
      <p><a href="https://gorillazmotorbikes.com/admin/ordenes-servicio/${order.id}">Abrir la orden →</a></p>
    `,
  });
}

module.exports = router;
