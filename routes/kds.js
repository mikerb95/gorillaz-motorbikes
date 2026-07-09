'use strict';
const express   = require('express');
const path      = require('path');
const fs        = require('fs');
const jwt       = require('jsonwebtoken');
const bcrypt    = require('bcryptjs');
const rateLimit = require('express-rate-limit');

const { JWT_SECRET } = require('../config');
const { requireKdsEmployee, authLimiter } = require('../middleware/auth');
const { requirePin, verifyPinHandler, touchPinSession, clearPinSessionCookies } = require('../middleware/employeePin');
const settings = require('../helpers/settings');
const { catalog } = require('../helpers/catalog');
const { classes: classesData } = require('../helpers/content');
const { EMP_STATUS, ALLOWED_STATUS } = require('../helpers/service-order-status');
const {
  getActiveEmployees, getEmployeeById,
  isThrottleLocked, recordThrottleFailure,
  getActiveServiceOrders, getServiceOrdersByPlate, getServiceOrderById,
  createServiceOrder, updateServiceOrder, addServiceOrderEvent,
  convertServiceOrderToInvoice, applyStatusPolicy,
  createCheckin, getPendingAppointmentByPlate, getPendingCheckinsByPlate, updateAppointment,
  getTvState, setTvMode, sendTvPlaylistCommand, setTvSlideCount, stepTvSlide,
} = require('../db');

const router = express.Router();

// Throttle propio (clave separada de 'taller_pin') para que un ataque contra
// un panel no bloquee el PIN del otro, aunque la lógica de validación es igual.
const PIN_THROTTLE_KEY = 'kds_pin';
const PIN_WINDOW_MS    = 15 * 60 * 1000;
const PIN_MAX_FAILURES = 20;

// Topes de saneamiento para los ítems (un dedazo en la tablet no debe crear un
// total absurdo que arrastre a la proforma y obligue al admin a anularla).
const MAX_ITEM_PRICE = 100_000_000; // 100M COP por ítem
const MAX_ITEM_QTY   = 999;
// Placa: mayúsculas, sin espacios, alfanumérica con guion, 4–10 caracteres.
const KDS_PLATE_RE = /^[A-Z0-9-]{4,10}$/;

function validLineItem(name, price, qty) {
  return name
    && Number.isInteger(price) && price >= 1 && price <= MAX_ITEM_PRICE
    && Number.isInteger(qty) && qty >= 1 && qty <= MAX_ITEM_QTY;
}

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
// El polling automático (board → /orders.json, TV → /tv/estado) no debe contar
// como interacción: si deslizara la ventana de PIN, la sesión nunca expiraría.
router.use(touchPinSession(['/orders.json', '/tv/estado']));

// Throttle por IP además del global de 'action_pin': así una IP que aporree el
// PIN no puede, por sí sola, agotar el contador global y bloquear las acciones
// del resto de empleados durante 15 min (DoS barato).
const pinVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Demasiados intentos desde este dispositivo. Espera unos minutos.' },
});

// Verifica el PIN para el modal de acciones sensibles (facturar, cambiar estado…).
router.post('/verificar-pin', requireKdsEmployee, pinVerifyLimiter, verifyPinHandler);

// Puente de sesión hacia el liquidador: con sesión de mecánico + PIN emite la
// misma cookie liq_jwt que /liquidador/acceso, para poder embeberlo en un
// iframe sin volver a pedir el PIN del liquidador por separado.
router.post('/liquidador/bridge', requireKdsEmployee, requirePin('/kds'), (req, res) => {
  // Vida ligada a la sesión KDS (4h), no 12h: en una tablet compartida el
  // liquidador no debe quedar accesible horas después de cambiar de mecánico.
  const token = jwt.sign({ liq: true }, JWT_SECRET, { expiresIn: '4h' });
  res.cookie('liq_jwt', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 4,
  });
  res.json({ ok: true });
});

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
  return startKdsSession(res, matched, next && next.startsWith('/kds') ? next : '/kds/board');
});

router.post('/logout', (req, res) => {
  res.clearCookie('kds_jwt');
  res.clearCookie('liq_jwt'); // el puente al liquidador muere con la sesión del mecánico
  clearPinSessionCookies(res);
  res.redirect('/kds/login');
});

// ── Pantalla principal: siempre la cara al cliente (naranja + logo + reloj).
// El panel de taller ya no vive aquí, se accede aparte vía /kds/board.
router.get('/', (req, res) => {
  // Solo lo que el roll necesita mostrar: sin sku/tags/descripcion, que no
  // aportan nada a un cliente mirando la tablet desde lejos.
  const rollProducts = catalog.products
    .filter(p => p.stock > 0)
    .map(p => ({ name: p.name, price: p.price, image: p.image, discount: p.discount || 0 }));
  res.render('kds/kiosk', { classesData, rollProducts });
});

// ── Tablero de órdenes (solo con sesión de mecánico activa) ────────────────
router.get('/board', requireKdsEmployee, async (req, res) => {
  const orders = await getActiveServiceOrders();
  res.render('kds/board', { orders, EMP_STATUS, flash: req.query.flash || null });
});

// Solo el board (que ya exige sesión) consume este feed. Sin el gate, exponía
// placas, mecánicos, totales y los UUID de todas las órdenes activas a internet.
router.get('/orders.json', requireKdsEmployee, async (req, res) => {
  const orders = await getActiveServiceOrders();
  res.json(orders.map(o => ({
    id: o.id, label: o.label, motorcycle: o.motorcycle, mechanic: o.mechanic,
    status: o.status, total: o.total, itemCount: o.items.length, createdAt: o.createdAt,
  })));
});

// ── Check-in de clientes desde la tablet (mismo formulario público de
// /checkin, pero en formato KDS: sin navbar/footer del sitio) ─────────────
const kdsCheckinLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' },
});

// El lookup por placa es GET (fuera del limiter de POST) y consultable en bucle;
// sin freno sería un oráculo de enumeración placa→cita. Ventana generosa porque
// un check-in legítimo solo lo dispara una vez.
const kdsLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, hasAppointment: false, error: 'Demasiadas consultas. Espera unos minutos.' },
});

router.get('/checkin', (req, res) => {
  res.render('kds/checkin', { error: null, ok: false, values: {} });
});

router.post('/checkin', kdsCheckinLimiter, async (req, res) => {
  const clientName = String(req.body.clientName || '').trim();
  const clientPhone = String(req.body.clientPhone || '').replace(/\D/g, '');
  const clientPhoneCountry = String(req.body.clientPhoneCountry || '+57').trim();
  const plate = String(req.body.plate || '').trim().toUpperCase().replace(/\s/g, '');
  const brand = String(req.body.brand || '').trim();
  const reference = String(req.body.reference || '').trim();

  const values = { clientName, clientPhone, clientPhoneCountry, plate, brand, reference };

  if (!clientName || clientName.length < 3) {
    return res.status(400).render('kds/checkin', { error: 'Ingresa tu nombre completo.', ok: false, values });
  }
  if (!clientPhone || clientPhone.length < 7) {
    return res.status(400).render('kds/checkin', { error: 'Ingresa un número de WhatsApp válido.', ok: false, values });
  }
  if (!plate || plate.length < 4) {
    return res.status(400).render('kds/checkin', { error: 'Ingresa la placa de tu moto.', ok: false, values });
  }
  if (!brand) {
    return res.status(400).render('kds/checkin', { error: 'Ingresa la marca de tu moto.', ok: false, values });
  }
  if (!reference) {
    return res.status(400).render('kds/checkin', { error: 'Ingresa la referencia de tu moto.', ok: false, values });
  }

  await createCheckin({
    clientName: clientName.slice(0, 120),
    clientPhone: clientPhone.slice(0, 15),
    clientPhoneCountry,
    plate: plate.slice(0, 20),
    brand: brand.slice(0, 60),
    reference: reference.slice(0, 60),
  });

  res.render('kds/checkin', { error: null, ok: true, values: {} });
});

// Normaliza la placa igual que el agendar/check-in público.
const normalizeKdsPlate = (v) => String(v || '').trim().toUpperCase().replace(/\s/g, '');

function kdsCitaDateLabel(date) {
  if (!date) return '';
  const d = new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return d.toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
}

// Lookup de cita por placa (mismo contrato que /checkin/lookup del sitio).
router.get('/checkin/lookup', kdsLookupLimiter, async (req, res) => {
  const plate = normalizeKdsPlate(req.query.placa);
  if (plate.length < 4) return res.json({ ok: false, hasAppointment: false });

  const [appointment, pendingCheckins] = await Promise.all([
    getPendingAppointmentByPlate(plate),
    getPendingCheckinsByPlate(plate),
  ]);
  const alreadyCheckedIn = pendingCheckins.some(c => normalizeKdsPlate(c.plate) === plate);

  if (!appointment) return res.json({ ok: true, hasAppointment: false, alreadyCheckedIn });

  return res.json({
    ok: true,
    hasAppointment: true,
    alreadyCheckedIn,
    // No se expone el nombre del titular: la UI solo muestra servicio y fecha, y
    // devolverlo convertía el lookup en un oráculo placa→nombre del cliente.
    appointment: {
      service: appointment.service || '',
      dateLabel: kdsCitaDateLabel(appointment.date),
    },
  });
});

// Confirmar asistencia desde la tablet (misma lógica que /checkin/confirmar).
router.post('/checkin/confirmar', kdsCheckinLimiter, async (req, res) => {
  const plate = normalizeKdsPlate(req.body.plate);
  if (plate.length < 4) return res.status(400).json({ ok: false, error: 'Placa inválida.' });

  const appointment = await getPendingAppointmentByPlate(plate);
  if (!appointment) return res.json({ ok: true, already: true });

  const existing = await getPendingCheckinsByPlate(plate);
  const alreadyQueued = existing.some(c => normalizeKdsPlate(c.plate) === plate);
  if (!alreadyQueued) {
    const phone = String(appointment.phone || '').replace(/\D/g, '');
    await createCheckin({
      clientName: (appointment.name || 'Cliente con cita').slice(0, 120),
      clientPhone: phone.slice(0, 15) || '0000000',
      clientPhoneCountry: '+57',
      plate: plate.slice(0, 20),
      brand: null,
      reference: appointment.service ? `Cita: ${appointment.service}`.slice(0, 60) : null,
    });
  }

  await updateAppointment(appointment.id, { status: 'confirmada' });
  return res.json({ ok: true });
});

// ── Buscar por placa ────────────────────────────────────────────────────
router.get('/placa', (req, res) => {
  res.render('kds/placa', { error: null });
});

router.get('/placa/buscar', async (req, res) => {
  const placa = normalizeKdsPlate(req.query.placa);
  // Mínimo 4 caracteres: evita que una placa corta (o un comodín) devuelva por
  // coincidencia parcial la orden de otro cliente.
  if (placa.length < 4) return res.redirect('/kds/placa');
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
  const placa = normalizeKdsPlate(req.body.placa);
  const catalog = loadServicesCatalog();
  if (!KDS_PLATE_RE.test(placa)) {
    return res.status(400).render('kds/order-new', { placa, catalog, error: 'Placa inválida. Usa entre 4 y 10 caracteres (letras, números o guion).' });
  }

  let items;
  try { items = JSON.parse(req.body.items || '[]'); } catch { items = null; }
  const clean = Array.isArray(items) ? items.reduce((acc, it) => {
    const name  = String(it.name || '').trim();
    const price = Math.round(Number(it.price));
    const qty   = Math.round(Number(it.qty));
    if (validLineItem(name, price, qty)) {
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
  res.render('kds/order-detail', { order, EMP_STATUS, catalog, flash: req.query.flash || null });
});

router.post('/orden/:id/estado', requireKdsEmployee, requirePin('/kds'), async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/kds');
  const back = (flash) => res.redirect('/kds/orden/' + order.id + (flash ? '?flash=' + flash : ''));

  const status = req.body.status;
  if (!ALLOWED_STATUS.includes(status)) return back();

  // La política central decide qué pasa con la factura: devolver el estado de
  // una orden con proforma viva la anula y la desliga; una factura cerrada o
  // una orden entregada bloquean el cambio. Si bloquea, se avisa (antes se
  // redirigía en silencio y el mecánico no sabía por qué no cambiaba nada).
  const policy = await applyStatusPolicy(order, status, req.pinActor);
  if (!policy.allowed) return back('bloqueado');
  if (policy.invoiceDetached) order.invoiceId = null;

  // Se considera "finalizada" también si ya estaba en trabajo_completo pero sin
  // proforma (p. ej. la auto-facturación falló antes): así volver a tocar el
  // botón reintenta la emisión, en vez de quedar atascada sin factura.
  const finaliza = policy.status === 'trabajo_completo' &&
    (order.status !== 'trabajo_completo' || !order.invoiceId);

  const updates = {};
  if (policy.status) updates.status = policy.status;
  if (finaliza) {
    if (!order.trabajoCompletoAt) updates.trabajoCompletoAt = nowCOT();
    updates.pendingReview = true;
  }
  if (Object.keys(updates).length) await updateServiceOrder(order.id, updates, req.pinActor);

  // Al quedar lista la moto se emite la factura proforma automáticamente: es
  // el único momento en que se sabe con certeza si aplica parqueadero, así que
  // el total definitivo se cierra recién al entregar la moto (panel admin).
  if (finaliza && !order.invoiceId) {
    try {
      await convertServiceOrderToInvoice({ ...order, status: 'trabajo_completo', invoiceId: null }, {}, req.pinActor);
    } catch (e) {
      console.error('Auto-facturación proforma falló:', e.message);
      return back('factura_error');
    }
  }

  return back();
});

router.post('/orden/:id/items', requireKdsEmployee, requirePin('/kds'), async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/kds');
  // Con factura emitida los ítems quedan congelados: cambiarlos descuadraría
  // la proforma (misma regla que el panel admin).
  if (order.invoiceId) return res.redirect('/kds/orden/' + order.id);

  const name  = String(req.body.name || '').trim();
  const price = Math.round(Number(req.body.price));
  const qty   = Math.round(Number(req.body.qty));
  if (validLineItem(name, price, qty)) {
    const items = [...order.items, { name: name.slice(0, 200), type: req.body.type || 'custom', price, qty }];
    const total = items.reduce((s, it) => s + it.price * it.qty, 0);
    await updateServiceOrder(order.id, { items, total }, req.pinActor);
    await addServiceOrderEvent(order.id, 'editado', req.pinActor, `+ ${name} ×${qty}`);
  }

  res.redirect('/kds/orden/' + order.id);
});

// ── Control remoto del único TV del taller ──────────────────────────────
// Estado leído directo de BD (ver getTvState en db.js) para que la pantalla
// del TV vea los comandos del remoto sin depender de que ambas peticiones
// caigan en la misma instancia serverless. El polling de la pantalla no
// expone nada sensible, así que queda público (igual que /kds/orders.json).
router.get('/tv/estado', async (req, res) => {
  try {
    res.json(await getTvState());
  } catch (e) {
    console.error('GET /kds/tv/estado error:', e.message);
    res.status(500).json({ error: 'No se pudo leer el estado del TV.' });
  }
});

const ALLOWED_TV_PLAYLIST_ACTIONS = ['play', 'pause', 'skip_next', 'skip_prev'];

router.post('/tv/comando', requireKdsEmployee, async (req, res) => {
  try {
    const action = String(req.body.action || '');
    if (action === 'to_playlist') {
      return res.json(await setTvMode('playlist'));
    }
    if (action === 'slide_next') return res.json(await stepTvSlide(1));
    if (action === 'slide_prev') return res.json(await stepTvSlide(-1));
    if (!ALLOWED_TV_PLAYLIST_ACTIONS.includes(action)) {
      return res.status(400).json({ error: 'Comando inválido.' });
    }
    const state = await sendTvPlaylistCommand(action);
    res.json(state);
  } catch (e) {
    console.error('POST /kds/tv/comando error:', e.message);
    res.status(500).json({ error: 'No se pudo enviar el comando.' });
  }
});

// ── Panel de capacitaciones: proyecta un tema (con diapositivas) de los
// cursos ya creados en /admin/clases. Reutiliza el mismo TV único.
router.post('/tv/capacitacion/iniciar', requireKdsEmployee, async (req, res) => {
  try {
    const course = String(req.body.course || '');
    const topic  = String(req.body.topic || '');
    const courseObj = classesData[course];
    const topicObj  = courseObj && (courseObj.topics || {})[topic];
    if (!topicObj) return res.status(404).json({ error: 'Tema no encontrado.' });

    await setTvMode('presentacion', { course, topic });
    await setTvSlideCount((topicObj.slides || []).length || 1);
    res.json(await getTvState());
  } catch (e) {
    console.error('POST /kds/tv/capacitacion/iniciar error:', e.message);
    res.status(500).json({ error: 'No se pudo iniciar la capacitación.' });
  }
});

module.exports = router;
