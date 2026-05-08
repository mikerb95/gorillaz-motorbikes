'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const courses     = require('../data/courses.json');
const classesData = require('../data/classes.json');
const catalog     = require('../data/catalog');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { saveJSON, writeCatalog, uploadProduct, deleteFromBlob } = require('../helpers/files');
const { availability }  = require('../helpers/appointments');
const { SCORE_POINTS }  = require('../helpers/score');
const {
  countUsers, countEvents, countAppointments,
  getAllUsers, getUserById, updateUser, deleteUser,
  getAllEvents, createEvent, getEventById, updateEvent, deleteEvent,
  getEventAttendances, getAttendanceById, confirmEventAttendance,
  logAdminAction, getAdminAuditLog,
  getAllAppointments, createAppointment, updateAppointment, deleteAppointment,
  addUserScore,
  getAllOrders, countOrders, updateOrderStatus,
  getAllNewsletterSubscribers, getConfirmedNewsletterSubscribers,
  deleteNewsletterByEmail,
  createNewsletterCampaign, getAllNewsletterCampaigns,
  getAllQuotations, getQuotationById, countQuotations,
  createServiceOrder, getServiceOrderById, getAllServiceOrders, updateServiceOrder, countServiceOrders,
  createInvoice, getInvoiceById, getAllInvoices, updateInvoiceStatus, countInvoices,
} = require('../db');

const COTIZADOR_CONFIG_PATH   = path.join(__dirname, '..', 'data', 'cotizador-config.json');
const SERVICES_CATALOG_PATH   = path.join(__dirname, '..', 'data', 'services-catalog.json');
const PARQUEADERO_CONFIG_PATH = path.join(__dirname, '..', 'data', 'parqueadero-config.json');

function loadCotizadorConfig() {
  try { return JSON.parse(fs.readFileSync(COTIZADOR_CONFIG_PATH, 'utf8')); }
  catch { return { waHeader: '🏍️ *Cotización Gorillaz Motorbikes*', waItemPrefix: '•', waFooter: 'gorillazmotorbikes.com', waNote: '' }; }
}
function saveCotizadorConfig(cfg) {
  try { fs.writeFileSync(COTIZADOR_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); } catch { }
}
function loadParqueaderoConfig() {
  try { return JSON.parse(fs.readFileSync(PARQUEADERO_CONFIG_PATH, 'utf8')); }
  catch { return { diasGratis: 3, tarifaPorDia: 7000 }; }
}
function saveParqueaderoConfig(cfg) {
  try { fs.writeFileSync(PARQUEADERO_CONFIG_PATH, JSON.stringify(cfg, null, 2), 'utf8'); } catch { }
}
function loadServicesCatalog() {
  try { return JSON.parse(fs.readFileSync(SERVICES_CATALOG_PATH, 'utf8')); }
  catch { return []; }
}
function saveServicesCatalog(list) {
  try { fs.writeFileSync(SERVICES_CATALOG_PATH, JSON.stringify(list, null, 2), 'utf8'); } catch { }
}
const { resendClient } = require('../config');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const results = await Promise.allSettled([
    countUsers(), countEvents(), countAppointments(), countOrders(),
    getAllNewsletterSubscribers(), countQuotations(), countServiceOrders(), countInvoices(),
  ]);
  const [users, events, citas, pedidos, allSubsR, cotizaciones, ordenes, facturas] = results.map(r => r.status === 'fulfilled' ? r.value : 0);
  const allSubs      = Array.isArray(allSubsR) ? allSubsR : [];
  const suscriptores = allSubs.filter(s => s.confirmed).length;
  res.render('admin/index', { stats: { users, events, citas, cursos: courses.length, productos: (catalog.products || []).length, pedidos, suscriptores, cotizaciones, ordenes, facturas } });
});

router.get('/pedidos', requireAuth, requireAdmin, async (req, res) => {
  const orders = await getAllOrders();
  res.render('admin/orders', { orders });
});

router.post('/pedidos/estado', requireAuth, requireAdmin, async (req, res) => {
  const { id, status } = req.body;
  await updateOrderStatus(id, status, null);
  res.redirect('/admin/pedidos');
});

router.get('/calendario', requireAuth, requireAdmin, (req, res) => res.render('admin/calendar', { availability }));

router.post('/calendario/bloquear', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.body;
  if (date && !availability.blockedDates.includes(date)) { availability.blockedDates.push(date); saveJSON('availability.json', availability); }
  res.redirect('/admin/calendario');
});

router.post('/calendario/desbloquear', requireAuth, requireAdmin, (req, res) => {
  const { date } = req.body;
  availability.blockedDates = availability.blockedDates.filter(d => d !== date);
  saveJSON('availability.json', availability);
  res.redirect('/admin/calendario');
});

router.get('/eventos', requireAuth, requireAdmin, async (req, res) => {
  const events = await getAllEvents();
  res.render('admin/events', { events });
});

router.post('/eventos/crear', requireAuth, requireAdmin, async (req, res) => {
  const { title, date, location, description, type, category, lat, lng } = req.body;
  if (title && date) {
    const newId = uuidv4();
    await createEvent({ id: newId, title, date, location, description, type: type || 'evento', category: category || 'club', lat: lat || null, lng: lng || null });
    await logAdminAction(res.locals.user.id, res.locals.user.name, 'crear_evento', 'event', newId, { title, date, type, category });
  }
  res.redirect('/admin/eventos');
});

router.post('/eventos/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, title, date, location, description, type, category, lat, lng } = req.body;
  await updateEvent(id, { title, date, location, description, type, category, lat: lat || null, lng: lng || null });
  await logAdminAction(res.locals.user.id, res.locals.user.name, 'actualizar_evento', 'event', id, { title, date, type, category });
  res.redirect('/admin/eventos');
});

router.get('/eventos/:id/asistencias', requireAuth, requireAdmin, async (req, res) => {
  const ev = await getEventById(req.params.id);
  if (!ev) return res.redirect('/admin/eventos');
  const attendances = await getEventAttendances(req.params.id);
  res.render('admin/event-attendances', { ev, attendances });
});

router.post('/eventos/asistencia/confirmar', requireAuth, requireAdmin, async (req, res) => {
  const { attendanceId, eventId, userId, eventType } = req.body;
  const attendance = await getAttendanceById(attendanceId);
  if (attendance && attendance.status !== 'confirmed') {
    await confirmEventAttendance(attendanceId);
    const pts = SCORE_POINTS[eventType] || SCORE_POINTS.evento;
    const ev  = await getEventById(eventId);
    await addUserScore(userId, pts, eventType || 'evento', ev ? ev.title : 'Evento del club');
    await logAdminAction(res.locals.user.id, res.locals.user.name, 'confirmar_asistencia', 'attendance', attendanceId, { eventId, userId, pts, eventType });
  }
  res.redirect(`/admin/eventos/${eventId}/asistencias`);
});

router.post('/eventos/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const ev = await getEventById(req.body.id);
  await deleteEvent(req.body.id);
  await logAdminAction(res.locals.user.id, res.locals.user.name, 'eliminar_evento', 'event', req.body.id, { title: ev ? ev.title : null });
  res.redirect('/admin/eventos');
});

router.get('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const users = await getAllUsers();
  res.render('admin/users', { users });
});

router.post('/usuarios/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, name, membershipLevel, role } = req.body;
  const u = await getUserById(id);
  if (u) {
    const fields = {};
    if (name) fields.name = name;
    if (membershipLevel) fields.membership = { ...u.membership, level: membershipLevel };
    if (role && ['user', 'admin'].includes(role)) fields.role = role;
    await updateUser(id, fields);
    await logAdminAction(res.locals.user.id, res.locals.user.name, 'actualizar_usuario', 'user', id, { name, membershipLevel, role });
  }
  res.redirect('/admin/usuarios');
});

router.post('/usuarios/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const u = await getUserById(req.body.id);
  await deleteUser(req.body.id);
  await logAdminAction(res.locals.user.id, res.locals.user.name, 'eliminar_usuario', 'user', req.body.id, { name: u ? u.name : null, email: u ? u.email : null });
  res.redirect('/admin/usuarios');
});

router.get('/auditoria', requireAuth, requireAdmin, async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit || '200', 10), 500);
  const logs  = await getAdminAuditLog(limit);
  res.render('admin/audit', { logs, limit });
});

router.get('/citas', requireAuth, requireAdmin, async (req, res) => {
  const appointments = await getAllAppointments();
  res.render('admin/appointments', { appointments });
});

router.post('/citas/crear', requireAuth, requireAdmin, async (req, res) => {
  const { customer, date, time, service } = req.body;
  if (customer && date && time && service) {
    await createAppointment({ id: uuidv4(), customer, name: customer, email: '', date, time, service, status: 'pendiente' });
  }
  res.redirect('/admin/citas');
});

router.post('/citas/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, customer, date, time, service, status } = req.body;
  await updateAppointment(id, { customer, date, time, service, status });
  res.redirect('/admin/citas');
});

router.post('/citas/estado', requireAuth, requireAdmin, async (req, res) => {
  const { id, status } = req.body;
  if (id && status) await updateAppointment(id, { status });
  res.redirect('/admin/citas');
});

router.post('/citas/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteAppointment(req.body.id);
  res.redirect('/admin/citas');
});

router.get('/agenda-servicios', requireAuth, requireAdmin, async (req, res) => {
  const services     = ['Mecánica', 'Pintura', 'Alistamiento tecnomecánica', 'Electricidad', 'Torno', 'Prensa', 'Mecánica rápida', 'Escaneo de motos'];
  const appointments = await getAllAppointments();
  const now          = new Date();
  const monthParam   = req.query.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const [year, month]     = monthParam.split('-').map(Number);
  const selectedService   = req.query.service || '';
  const firstDay          = new Date(year, month - 1, 1);
  const lastDay           = new Date(year, month, 0);
  const daysInMonth       = lastDay.getDate();
  const startingDayOfWeek = firstDay.getDay();
  const calendarDays      = [];
  const prevMonthLastDay  = new Date(year, month - 1, 0).getDate();
  for (let i = startingDayOfWeek - 1; i >= 0; i--) calendarDays.push({ date: prevMonthLastDay - i, isCurrentMonth: false, appointments: [] });
  for (let i = 1; i <= daysInMonth; i++) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(i).padStart(2, '0')}`;
    calendarDays.push({ date: i, isCurrentMonth: true, appointments: appointments.filter(a => a.date === dateStr && (!selectedService || a.service === selectedService)), dateStr });
  }
  const remaining = 42 - calendarDays.length;
  for (let i = 1; i <= remaining; i++) calendarDays.push({ date: i, isCurrentMonth: false, appointments: [] });
  const filteredAppointments = appointments.filter(a => {
    const d = new Date(a.date);
    return d.getFullYear() === year && (d.getMonth() + 1) === month && (!selectedService || a.service === selectedService);
  }).sort((a, b) => new Date(a.date) - new Date(b.date));
  const monthNames = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  res.render('admin/services-schedule', { services, calendarDays, filteredAppointments, currentMonth: monthParam, selectedService, monthYear: `${monthNames[month - 1]} ${year}`, appointments });
});

router.get('/cursos', requireAuth, requireAdmin, (req, res) => res.render('admin/courses', { list: courses }));

router.post('/cursos/crear', requireAuth, requireAdmin, (req, res) => {
  const { slug, title, priceCOP } = req.body;
  if (slug && title) {
    courses.push({ slug, title, short: '', category: 'Técnico', level: 'Inicial', durationHours: 0, readingMinutes: 0, modality: 'Presencial', location: 'Bogotá D.C.', priceCOP: parseInt(priceCOP || '0', 10) || 0, tags: [], syllabus: [], outcomes: [], requirements: [], schedule: '', nextIntake: '' });
    saveJSON('courses.json', courses);
  }
  res.redirect('/admin/cursos');
});

router.post('/cursos/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { slug, title, priceCOP } = req.body;
  const c = courses.find(x => x.slug === slug);
  if (c) { if (title) c.title = title; if (priceCOP !== undefined) c.priceCOP = parseInt(priceCOP || '0', 10) || 0; saveJSON('courses.json', courses); }
  res.redirect('/admin/cursos');
});

router.post('/cursos/eliminar', requireAuth, requireAdmin, (req, res) => {
  const idx = courses.findIndex(c => c.slug === req.body.slug);
  if (idx !== -1) { courses.splice(idx, 1); saveJSON('courses.json', courses); }
  res.redirect('/admin/cursos');
});

router.get('/tienda', requireAuth, requireAdmin, (req, res) => {
  const search    = (req.query.q   || '').toString().trim().toLowerCase();
  const filterCat = (req.query.cat || '').toString();
  let prods       = catalog.products || [];
  if (search)    prods = prods.filter(p => p.name.toLowerCase().includes(search) || (p.sku || '').toLowerCase().includes(search));
  if (filterCat) prods = prods.filter(p => p.category === filterCat);
  res.render('admin/shop', { categories: catalog.categories || [], products: prods, search, filterCat });
});

router.get('/tienda/:id/editar', requireAuth, requireAdmin, (req, res) => {
  const product = (catalog.products || []).find(p => p.id === req.params.id);
  if (!product) return res.redirect('/admin/tienda');
  res.render('admin/shop-edit', { product, categories: catalog.categories || [] });
});

router.post('/tienda/crear', requireAuth, requireAdmin, (req, res) => {
  const { id, name, price, category, description, brand, sku, stock, discount, tags, existingImages } = req.body;
  if (!catalog.products) catalog.products = [];
  const prodId    = id && id.trim() ? id.trim() : uuidv4();
  const gallery   = existingImages ? (Array.isArray(existingImages) ? existingImages : [existingImages]) : [];
  const mainImage = gallery.length > 0 ? gallery[0] : '/images/download.png';
  if (name && category) {
    catalog.products.push({ id: prodId, name, price: parseInt(price || '0', 10) || 0, category, image: mainImage, gallery: gallery.length > 0 ? gallery : ['/images/download.png'], brand: (brand || '').trim(), sku: (sku || '').trim(), stock: parseInt(stock || '0', 10), discount: Math.min(100, Math.max(0, parseInt(discount || '0', 10))), tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean), description: description || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    writeCatalog(catalog);
  }
  res.redirect('/admin/tienda');
});

router.post('/tienda/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { id, name, price, category, description, brand, sku, stock, discount, tags, existingImages } = req.body;
  const p = (catalog.products || []).find(x => x.id === id);
  if (p) {
    if (name)               p.name        = name;
    if (price       !== undefined) p.price       = parseInt(price || '0', 10) || 0;
    if (category)           p.category    = category;
    if (description !== undefined) p.description = description;
    if (brand       !== undefined) p.brand       = (brand || '').trim();
    if (sku         !== undefined) p.sku         = (sku || '').trim();
    if (stock       !== undefined) p.stock       = parseInt(stock || '0', 10);
    if (discount    !== undefined) p.discount    = Math.min(100, Math.max(0, parseInt(discount || '0', 10)));
    if (tags        !== undefined) p.tags        = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
    const gallery = existingImages ? (Array.isArray(existingImages) ? existingImages : [existingImages]) : [];
    if (gallery.length > 0) { p.gallery = gallery; p.image = gallery[0]; }
    p.updatedAt = new Date().toISOString();
    writeCatalog(catalog);
  }
  res.redirect('/admin/tienda');
});

router.post('/tienda/eliminar', requireAuth, requireAdmin, (req, res) => {
  catalog.products = (catalog.products || []).filter(p => p.id !== req.body.id);
  writeCatalog(catalog);
  res.redirect('/admin/tienda');
});

router.post('/tienda/upload-image', requireAuth, requireAdmin, uploadProduct, (req, res) => {
  res.json({ ok: true, urls: req.blobUrls || [] });
});

router.post('/tienda/delete-image', requireAuth, requireAdmin, async (req, res) => {
  const { productId, imageUrl } = req.body;
  const p = (catalog.products || []).find(x => x.id === productId);
  if (p && p.gallery) {
    p.gallery   = p.gallery.filter(img => img !== imageUrl);
    p.image     = p.gallery.length > 0 ? p.gallery[0] : '/images/download.png';
    if (!p.gallery.length) p.gallery = ['/images/download.png'];
    p.updatedAt = new Date().toISOString();
    writeCatalog(catalog);
    await deleteFromBlob(imageUrl);
  }
  if ((req.headers.accept || '').includes('application/json')) return res.json({ ok: true });
  res.redirect('/admin/tienda/' + productId + '/editar');
});

router.get('/clases', requireAuth, requireAdmin, (req, res) => res.render('admin/classes', { classesData }));

// ── Newsletter ────────────────────────────────────────────────────────────

router.get('/newsletter', requireAuth, requireAdmin, async (req, res) => {
  const [subscribers, campaigns] = await Promise.all([
    getAllNewsletterSubscribers(),
    getAllNewsletterCampaigns(),
  ]);
  const flash = req.query.flash || null;
  res.render('admin/newsletter', { subscribers, campaigns, flash });
});

router.post('/newsletter/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteNewsletterByEmail(req.body.email);
  res.redirect('/admin/newsletter');
});

router.post('/newsletter/enviar', requireAuth, requireAdmin, async (req, res) => {
  const subject  = (req.body.subject || '').toString().trim();
  const bodyHtml = (req.body.body || '').toString().trim();
  if (!subject || !bodyHtml) return res.redirect('/admin/newsletter?flash=error');

  const subscribers = await getConfirmedNewsletterSubscribers();
  if (!subscribers.length) return res.redirect('/admin/newsletter?flash=empty');

  const BASE_URL = process.env.BASE_URL || 'https://gorillazmotorbikes.com';
  const FROM = 'boletin@gorillazmotorbikes.com';

  await Promise.allSettled(
    subscribers.map(s => {
      const unsubLink = `${BASE_URL}/newsletter/desuscribirse?token=${s.unsubscribe_token}`;
      return resendClient.emails.send({
        from: FROM,
        to: s.email,
        subject,
        html: `${bodyHtml}<br><br><hr style="border:none;border-top:1px solid #eee;margin:24px 0"><p style="font-size:12px;color:#999">¿No quieres recibir más correos? <a href="${unsubLink}">Desuscríbete aquí</a></p>`,
      });
    })
  );

  await createNewsletterCampaign(subject, bodyHtml, subscribers.length);
  res.redirect('/admin/newsletter?flash=sent');
});

// ── Cotizaciones ──────────────────────────────────────────────────────────

router.get('/cotizaciones', requireAuth, requireAdmin, async (req, res) => {
  const quotations = await getAllQuotations();
  const totalRevenue = quotations.reduce((s, q) => s + q.total, 0);
  res.render('admin/quotations', { quotations, totalRevenue });
});

router.get('/cotizaciones/:id', requireAuth, requireAdmin, async (req, res) => {
  const quotation = await getQuotationById(req.params.id);
  if (!quotation) return res.redirect('/admin/cotizaciones');
  res.render('admin/quotation-detail', { quotation });
});

// ── Ítems del cotizador (servicios + productos) ───────────────────────────

router.get('/cotizador-items', requireAuth, requireAdmin, (req, res) => {
  const services = loadServicesCatalog();
  const products = (catalog.products || []).map(p => ({
    id: p.id, name: p.name, brand: p.brand || '', category: p.category || '',
  }));
  const flash = req.query.flash || null;
  res.render('admin/cotizador-items', { services, products, flash });
});

router.post('/cotizador-items/servicio/crear', requireAuth, requireAdmin, (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/admin/cotizador-items?flash=error-name');
  const services = loadServicesCatalog();
  const id = 'svc-' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
  services.push({ id, name, type: 'service' });
  saveServicesCatalog(services);
  res.redirect('/admin/cotizador-items?flash=created');
});

router.post('/cotizador-items/servicio/actualizar', requireAuth, requireAdmin, (req, res) => {
  const { id, name } = req.body;
  const trimmed = (name || '').trim();
  if (!id || !trimmed) return res.redirect('/admin/cotizador-items?flash=error-name');
  const services = loadServicesCatalog();
  const svc = services.find(s => s.id === id);
  if (svc) svc.name = trimmed;
  saveServicesCatalog(services);
  res.redirect('/admin/cotizador-items?flash=updated');
});

router.post('/cotizador-items/servicio/eliminar', requireAuth, requireAdmin, (req, res) => {
  const { id } = req.body;
  const services = loadServicesCatalog().filter(s => s.id !== id);
  saveServicesCatalog(services);
  res.redirect('/admin/cotizador-items?flash=deleted');
});

// ── Configuración del liquidador ──────────────────────────────────────────

router.get('/cotizador-config', requireAuth, requireAdmin, (req, res) => {
  const config = loadCotizadorConfig();
  const flash = req.query.flash || null;
  res.render('admin/cotizador-config', { config, flash });
});

router.post('/cotizador-config', requireAuth, requireAdmin, (req, res) => {
  const { waHeader, waItemPrefix, waFooter, waNote } = req.body;
  saveCotizadorConfig({
    waHeader:     (waHeader     || '').trim(),
    waItemPrefix: (waItemPrefix || '•').trim() || '•',
    waFooter:     (waFooter     || '').trim(),
    waNote:       (waNote       || '').trim(),
  });
  res.redirect('/admin/cotizador-config?flash=saved');
});

// ── Órdenes de servicio ───────────────────────────────────────────────────

router.post('/cotizaciones/:id/convertir-orden', requireAuth, requireAdmin, async (req, res) => {
  const quotation = await getQuotationById(req.params.id);
  if (!quotation) return res.redirect('/admin/cotizaciones');
  const { id } = await createServiceOrder({
    quotationId:        quotation.id,
    items:              quotation.items,
    total:              quotation.total,
    motorcycle:         quotation.motorcycle,
    clientPhone:        quotation.clientPhone,
    clientPhoneCountry: quotation.clientPhoneCountry,
    mechanic:           (req.body.mechanic || '').trim() || null,
    notes:              (req.body.notes || '').trim() || null,
    estimatedDate:      req.body.estimatedDate || null,
  });
  res.redirect('/admin/ordenes-servicio/' + id);
});

router.get('/ordenes-servicio', requireAuth, requireAdmin, async (req, res) => {
  const orders = await getAllServiceOrders();
  res.render('admin/service-orders', { orders });
});

router.get('/ordenes-servicio/:id', requireAuth, requireAdmin, async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/admin/ordenes-servicio');
  const quotation = order.quotationId ? await getQuotationById(order.quotationId) : null;
  const invoice   = order.invoiceId   ? await getInvoiceById(order.invoiceId)     : null;
  const parqueaderoConfig = loadParqueaderoConfig();
  res.render('admin/service-order-detail', { order, quotation, invoice, parqueaderoConfig });
});

router.post('/ordenes-servicio/:id/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { mechanic, status, notes, estimatedDate } = req.body;
  const order = await getServiceOrderById(req.params.id);
  const updates = {
    mechanic:      (mechanic || '').trim() || null,
    status:        status || 'ingreso_taller',
    notes:         (notes || '').trim() || null,
    estimatedDate: estimatedDate || null,
  };
  if (status === 'trabajo_completo' && order && !order.trabajoCompletoAt) {
    updates.trabajoCompletoAt = new Date().toISOString();
  }
  await updateServiceOrder(req.params.id, updates);
  res.redirect('/admin/ordenes-servicio/' + req.params.id);
});

router.post('/ordenes-servicio/:id/convertir-factura', requireAuth, requireAdmin, async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order || order.invoiceId || order.status !== 'trabajo_completo') return res.redirect('/admin/ordenes-servicio/' + req.params.id);
  const tax = Math.round(Number(req.body.tax || 0));
  const subtotal = order.total;
  const { id: invoiceId } = await createInvoice({
    serviceOrderId:     order.id,
    quotationId:        order.quotationId,
    items:              order.items,
    subtotal,
    tax,
    paymentMethod:      req.body.paymentMethod || 'efectivo',
    notes:              (req.body.notes || '').trim() || null,
  });
  await updateServiceOrder(order.id, { status: 'facturado', invoiceId });
  res.redirect('/admin/facturas/' + invoiceId);
});

// ── Facturas ──────────────────────────────────────────────────────────────

router.get('/facturas', requireAuth, requireAdmin, async (req, res) => {
  const invoices = await getAllInvoices();
  res.render('admin/invoices', { invoices });
});

router.get('/facturas/:id', requireAuth, requireAdmin, async (req, res) => {
  const invoice = await getInvoiceById(req.params.id);
  if (!invoice) return res.redirect('/admin/facturas');
  const order = await getServiceOrderById(invoice.serviceOrderId);
  res.render('admin/invoice-detail', { invoice, order });
});

router.post('/facturas/:id/estado', requireAuth, requireAdmin, async (req, res) => {
  await updateInvoiceStatus(req.params.id, req.body.status, req.body.paymentMethod);
  res.redirect('/admin/facturas/' + req.params.id);
});

// ── Contabilidad → redirige al módulo de finanzas ─────────────────────────

router.get('/contabilidad', (req, res) => res.redirect(301, '/admin/finanzas'));

module.exports = router;
