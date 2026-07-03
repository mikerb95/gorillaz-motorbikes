'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { v4: uuidv4 } = require('uuid');
const { courses, classes: classesData, availability, saveCourses, saveClasses, saveAvailability } = require('../helpers/content');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { uploadProduct, uploadSlideImage, deleteFromBlob } = require('../helpers/files');
const { setFlash } = require('../helpers/flash');
const settings = require('../helpers/settings');
const { catalog, saveCatalog } = require('../helpers/catalog');
const { SCORE_POINTS, loadPuntosConfig, DEFAULTS: PUNTOS_DEFAULTS }  = require('../helpers/score');
const { buildQuotationSummary } = require('../helpers/quotationStats');
const {
  countUsers, countEvents, countAppointments,
  getAllUsers, getUserById, getUserByCedula, updateUser, deleteUser,
  getAllEvents, createEvent, getEventById, updateEvent, deleteEvent,
  getEventAttendances, getAttendanceById, confirmEventAttendance, cancelEventAttendances,
  logAdminAction, getAdminAuditLog,
  getAllAppointments, createAppointment, updateAppointment, deleteAppointment,
  addUserScore,
  getOrdersPage, getOrderStats, countOrders, updateOrderStatus,
  getAllNewsletterSubscribers, getConfirmedNewsletterSubscribers,
  deleteNewsletterByEmail,
  createNewsletterCampaign, getAllNewsletterCampaigns,
  getAllQuotations, getConvertedQuotationIds, getDraftQuotations, getQuotationById, countQuotations, deleteQuotation,
  createServiceOrder, getServiceOrderById, getServiceOrdersPage, getServiceOrderStatusCounts, updateServiceOrder, updateServiceOrderPhone, countServiceOrders, getServiceOrderEvents, addServiceOrderEvent, detachOrderFromInvoice, deleteServiceOrder,
  createInvoice, convertServiceOrderToInvoice, getInvoiceById, getInvoicesPage, getInvoiceStats, updateInvoiceStatus, countInvoices,
  createEmployee, getAllEmployees, getActiveEmployees, getEmployeeById, getEmployeeByUserId, updateEmployee, deleteEmployee,
  getAllClassifieds, getClassifiedById, setClassifiedStatus, deleteClassified, countClassifiedsByStatus,
  backupAllTables,
} = require('../db');
const bcrypt = require('bcryptjs');

// La config editable del admin vive en la tabla app_settings (vía
// helpers/settings). Los archivos JSON en /data se mantienen solo como fallback
// de lectura para los valores que existían antes de esta migración: en cuanto
// el admin guarda una vez, el valor pasa a la BD y persiste entre cold starts.
function readDataJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', file), 'utf8')); }
  catch { return fallback; }
}

function loadCotizadorConfig() {
  return settings.get('cotizador') ?? readDataJson('cotizador-config.json',
    { waHeader: '🏍️ *Cotización Gorillaz Motorbikes*', waItemPrefix: '•', waFooter: 'gorillazmotorbikes.com', waNote: '' });
}
const saveCotizadorConfig = (cfg) => settings.set('cotizador', cfg);

function loadParqueaderoConfig() {
  return settings.get('parqueadero') ?? readDataJson('parqueadero-config.json', { diasGratis: 3, tarifaPorDia: 7000 });
}
const saveParqueaderoConfig = (cfg) => settings.set('parqueadero', cfg);

const PDF_CONFIG_DEFAULTS = { companyName: 'GORILLAZ MOTORBIKES', nit: '', phone: '', email: '', address: '', website: 'gorillazmotorbikes.com', city: 'Bogotá, Colombia', headerColor: '#F25C05', validityDays: 30, footerNote: 'Precios en COP. Cotización no incluye IVA.', showPhone: true, showNotes: true };
function loadPdfConfig() {
  return { ...PDF_CONFIG_DEFAULTS, ...(settings.get('pdf') ?? readDataJson('quotation-pdf-config.json', {})) };
}
const savePdfConfig = (cfg) => settings.set('pdf', cfg);

const savePuntosConfig = (cfg) => settings.set('puntos', cfg);

// Colombia es UTC-5 sin cambio de horario de verano
function nowCOT() {
  const cot = new Date(Date.now() - 5 * 60 * 60 * 1000);
  return cot.toISOString().replace('Z', '-05:00');
}
function loadServicesCatalog() {
  return settings.get('services_catalog') ?? readDataJson('services-catalog.json', []);
}
const saveServicesCatalog = (list) => settings.set('services_catalog', list);
const { resendClient } = require('../config');
const { invalidateCatalogCache } = require('./liquidador');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const results = await Promise.allSettled([
    countUsers(), countEvents(), countAppointments(), countOrders(),
    getAllNewsletterSubscribers(), countQuotations(), countServiceOrders(), countInvoices(),
    countClassifiedsByStatus('pending'),
  ]);
  const [users, events, citas, pedidos, allSubsR, cotizaciones, ordenes, facturas, clasificados] = results.map(r => r.status === 'fulfilled' ? r.value : 0);
  const allSubs      = Array.isArray(allSubsR) ? allSubsR : [];
  const suscriptores = allSubs.filter(s => s.confirmed).length;
  res.render('admin/index', { stats: { users, events, citas, cursos: courses.length, productos: (catalog.products || []).length, pedidos, suscriptores, cotizaciones, ordenes, facturas, clasificados } });
});

router.get('/pedidos', requireAuth, requireAdmin, async (req, res) => {
  const status = req.query.status || '';
  const page   = Number(req.query.page) || 1;
  const [pageData, stats] = await Promise.all([
    getOrdersPage({ page, size: 25, status }),
    getOrderStats(),
  ]);
  res.render('admin/orders', {
    orders: pageData.rows, stats, status,
    page: pageData.page, pages: pageData.pages, total: pageData.total,
  });
});

router.post('/pedidos/estado', requireAuth, requireAdmin, async (req, res) => {
  const { id, status } = req.body;
  await updateOrderStatus(id, status, null);
  res.redirect('/admin/pedidos');
});

router.get('/calendario', requireAuth, requireAdmin, (req, res) => res.render('admin/calendar', { availability }));

router.post('/calendario/bloquear', requireAuth, requireAdmin, async (req, res) => {
  const { date } = req.body;
  if (date && !availability.blockedDates.includes(date)) { availability.blockedDates.push(date); await saveAvailability(); }
  res.redirect('/admin/calendario');
});

router.post('/calendario/desbloquear', requireAuth, requireAdmin, async (req, res) => {
  const { date } = req.body;
  availability.blockedDates = availability.blockedDates.filter(d => d !== date);
  await saveAvailability();
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
  await Promise.all([
    deleteEvent(req.body.id),
    cancelEventAttendances(req.body.id),
  ]);
  await logAdminAction(res.locals.user.id, res.locals.user.name, 'eliminar_evento', 'event', req.body.id, { title: ev ? ev.title : null });
  res.redirect('/admin/eventos');
});

// ── Visitas auto-reportadas (requieren confirmación del admin para dar puntos) ─
router.get('/visitas', requireAuth, requireAdmin, async (req, res) => {
  const users = await getAllUsers();
  const pending = [];
  for (const u of users) {
    (u.visits || []).forEach(v => {
      if (v && v.status === 'pending' && v.id) {
        pending.push({ ...v, userId: u.id, userName: u.nickname || u.name, userFullName: u.name });
      }
    });
  }
  pending.sort((a, b) => new Date(b.date) - new Date(a.date));
  res.render('admin/visitas-pendientes', { pending, SCORE_POINTS });
});

router.post('/visitas/confirmar', requireAuth, requireAdmin, async (req, res) => {
  const { userId, visitId } = req.body;
  const user = await getUserById(userId);
  if (user) {
    const visits = (user.visits || []).map(v => ({ ...v }));
    const visit  = visits.find(v => v.id === visitId);
    // Guarda contra doble conteo: solo se otorgan puntos si sigue pendiente.
    if (visit && visit.status === 'pending') {
      visit.status = 'confirmed';
      const pts = SCORE_POINTS[visit.type] || SCORE_POINTS.visita;
      await updateUser(userId, { visits });
      await addUserScore(userId, pts, visit.type, visit.service);
      await logAdminAction(res.locals.user.id, res.locals.user.name, 'confirmar_visita', 'user', userId, { visitId, pts, type: visit.type, service: visit.service });
    }
  }
  res.redirect('/admin/visitas');
});

router.post('/visitas/rechazar', requireAuth, requireAdmin, async (req, res) => {
  const { userId, visitId } = req.body;
  const user = await getUserById(userId);
  if (user) {
    // Elimina la visita pendiente sin otorgar puntos.
    const visits = (user.visits || []).filter(v => !(v.id === visitId && v.status === 'pending'));
    await updateUser(userId, { visits });
    await logAdminAction(res.locals.user.id, res.locals.user.name, 'rechazar_visita', 'user', userId, { visitId });
  }
  res.redirect('/admin/visitas');
});

router.get('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const users = await getAllUsers();
  res.render('admin/users', { users, error: null });
});

router.post('/usuarios/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const {
    id, firstName, lastName, nickname, cedula, phone, city, department, birthdate, bloodType,
    emergencyName, emergencyPhone, clubNotifications, membershipLevel, role,
  } = req.body;
  const u = await getUserById(id);
  if (!u) return res.redirect('/admin/usuarios');

  const cedulaTrim = (cedula || '').trim();
  if (cedulaTrim && cedulaTrim !== (u.cedula || '')) {
    const existing = await getUserByCedula(cedulaTrim);
    if (existing && existing.id !== id) {
      const users = await getAllUsers();
      return res.status(400).render('admin/users', { users, error: `La cédula ${cedulaTrim} ya está en uso por otro usuario.` });
    }
  }

  const fn = (firstName || '').trim();
  const ln = (lastName  || '').trim();
  const fields = {
    nickname: (nickname || '').trim() || null,
    cedula: cedulaTrim || null,
    phone: (phone || '').trim() || null,
    city: (city || '').trim() || null,
    department: (department || '').trim() || null,
    birthdate: birthdate || null,
    bloodType: bloodType || null,
    emergencyName: (emergencyName || '').trim() || null,
    emergencyPhone: (emergencyPhone || '').trim() || null,
    clubNotifications: clubNotifications === 'true',
  };
  if (fn || ln) {
    fields.firstName = fn;
    fields.lastName  = ln;
    fields.name      = (fn + ' ' + ln).trim();
  }
  if (membershipLevel) fields.membership = { ...u.membership, level: membershipLevel };
  if (role && ['user', 'admin'].includes(role)) fields.role = role;
  await updateUser(id, fields);
  await logAdminAction(res.locals.user.id, res.locals.user.name, 'actualizar_usuario', 'user', id, { name: fields.name, membershipLevel, role });
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

router.post('/cursos/crear', requireAuth, requireAdmin, async (req, res) => {
  const { slug, title, priceCOP } = req.body;
  if (slug && title) {
    courses.push({ slug, title, short: '', category: 'Técnico', level: 'Inicial', durationHours: 0, readingMinutes: 0, modality: 'Presencial', location: 'Bogotá D.C.', priceCOP: parseInt(priceCOP || '0', 10) || 0, tags: [], syllabus: [], outcomes: [], requirements: [], schedule: '', nextIntake: '' });
    await saveCourses();
  }
  res.redirect('/admin/cursos');
});

router.post('/cursos/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { slug, title, priceCOP } = req.body;
  const c = courses.find(x => x.slug === slug);
  if (c) { if (title) c.title = title; if (priceCOP !== undefined) c.priceCOP = parseInt(priceCOP || '0', 10) || 0; await saveCourses(); }
  res.redirect('/admin/cursos');
});

router.post('/cursos/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const idx = courses.findIndex(c => c.slug === req.body.slug);
  if (idx !== -1) { courses.splice(idx, 1); await saveCourses(); }
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

router.post('/tienda/crear', requireAuth, requireAdmin, async (req, res) => {
  const { id, name, price, category, description, brand, sku, stock, discount, tags, existingImages } = req.body;
  if (!catalog.products) catalog.products = [];
  const prodId    = id && id.trim() ? id.trim() : uuidv4();
  const gallery   = existingImages ? (Array.isArray(existingImages) ? existingImages : [existingImages]) : [];
  const mainImage = gallery.length > 0 ? gallery[0] : '/images/download.png';
  if (name && category) {
    catalog.products.push({ id: prodId, name, price: parseInt(price || '0', 10) || 0, category, image: mainImage, gallery: gallery.length > 0 ? gallery : ['/images/download.png'], brand: (brand || '').trim(), sku: (sku || '').trim(), stock: parseInt(stock || '0', 10), discount: Math.min(100, Math.max(0, parseInt(discount || '0', 10))), tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean), description: description || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await saveCatalog();
  }
  res.redirect('/admin/tienda');
});

router.post('/tienda/actualizar', requireAuth, requireAdmin, async (req, res) => {
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
    await saveCatalog();
  }
  res.redirect('/admin/tienda');
});

router.post('/tienda/eliminar', requireAuth, requireAdmin, async (req, res) => {
  catalog.products = (catalog.products || []).filter(p => p.id !== req.body.id);
  await saveCatalog();
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
    await saveCatalog();
    await deleteFromBlob(imageUrl);
  }
  if ((req.headers.accept || '').includes('application/json')) return res.json({ ok: true });
  res.redirect('/admin/tienda/' + productId + '/editar');
});

// ── Clasificados del club: moderación ───────────────────────────────────────

router.get('/clasificados', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const filter = ['pending', 'active', 'rejected', 'sold'].includes(req.query.status) ? req.query.status : '';
    const listings = await getAllClassifieds(filter || undefined);
    const counts = {
      pending:  await countClassifiedsByStatus('pending'),
      active:   await countClassifiedsByStatus('active'),
      rejected: await countClassifiedsByStatus('rejected'),
      sold:     await countClassifiedsByStatus('sold'),
    };
    res.render('admin/clasificados', { listings, filter, counts });
  } catch (e) { next(e); }
});

router.post('/clasificados/aprobar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = (req.body.id || '').toString();
    const listing = await getClassifiedById(id);
    if (!listing) return res.redirect('/admin/clasificados');
    await setClassifiedStatus(id, 'active', null);
    await logAdminAction(res.locals.user.id, res.locals.user.name, 'aprobar_clasificado', 'classified', id, { title: listing.title });
    setFlash(res, 'success', 'Anuncio aprobado y publicado.');
    res.redirect('/admin/clasificados');
  } catch (e) { next(e); }
});

router.post('/clasificados/rechazar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = (req.body.id || '').toString();
    const reason = (req.body.reason || '').toString().trim().slice(0, 300);
    const listing = await getClassifiedById(id);
    if (!listing) return res.redirect('/admin/clasificados');
    await setClassifiedStatus(id, 'rejected', reason || 'No cumple las normas del club.');
    await logAdminAction(res.locals.user.id, res.locals.user.name, 'rechazar_clasificado', 'classified', id, { title: listing.title, reason });
    setFlash(res, 'success', 'Anuncio rechazado.');
    res.redirect('/admin/clasificados');
  } catch (e) { next(e); }
});

router.post('/clasificados/eliminar', requireAuth, requireAdmin, async (req, res, next) => {
  try {
    const id = (req.body.id || '').toString();
    const listing = await getClassifiedById(id);
    if (!listing) return res.redirect('/admin/clasificados');
    await deleteClassified(id);
    await Promise.all((listing.images || []).map(deleteFromBlob));
    await logAdminAction(res.locals.user.id, res.locals.user.name, 'eliminar_clasificado', 'classified', id, { title: listing.title });
    setFlash(res, 'success', 'Anuncio eliminado.');
    res.redirect('/admin/clasificados');
  } catch (e) { next(e); }
});

router.get('/clases', requireAuth, requireAdmin, (req, res) =>
  res.render('admin/classes', { classesData, flash: req.query.flash || null }));

// ── Clases: Cursos ────────────────────────────────────────────────────────

function slugFromTitle(t) {
  return t.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/(^_|_$)/g, '');
}

router.post('/clases/curso/crear', requireAuth, requireAdmin, async (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.redirect('/admin/clases?flash=error');
  let key = slugFromTitle(title) || 'curso';
  if (classesData[key]) key = key + '_' + Date.now().toString(36);
  classesData[key] = { title, topics: {} };
  await saveClasses();
  res.redirect('/admin/clases');
});

router.post('/clases/curso/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { key, title } = req.body;
  if (key && classesData[key] && (title || '').trim()) {
    classesData[key].title = title.trim();
    await saveClasses();
  }
  res.redirect('/admin/clases');
});

router.post('/clases/curso/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const { key } = req.body;
  if (key && classesData[key]) { delete classesData[key]; await saveClasses(); }
  res.redirect('/admin/clases');
});

// ── Clases: Temas ─────────────────────────────────────────────────────────

router.post('/clases/tema/crear', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, title } = req.body;
  const trimmed = (title || '').trim();
  if (!courseKey || !trimmed || !classesData[courseKey]) return res.redirect('/admin/clases?flash=error');
  if (!classesData[courseKey].topics) classesData[courseKey].topics = {};
  const idx = Object.keys(classesData[courseKey].topics).length + 1;
  const key = 'Clase_' + idx;
  classesData[courseKey].topics[key] = { title: trimmed, slides: [] };
  await saveClasses();
  res.redirect('/admin/clases');
});

router.post('/clases/tema/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, topicKey, title } = req.body;
  const course = classesData[courseKey];
  if (course && course.topics && course.topics[topicKey] && (title || '').trim()) {
    course.topics[topicKey].title = title.trim();
    await saveClasses();
  }
  res.redirect('/admin/clases');
});

router.post('/clases/tema/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, topicKey } = req.body;
  const course = classesData[courseKey];
  if (course && course.topics && course.topics[topicKey]) {
    delete course.topics[topicKey];
    await saveClasses();
  }
  res.redirect('/admin/clases');
});

// ── Clases: Diapositivas ──────────────────────────────────────────────────

function buildSlide(type, heading, content, items, img) {
  const slide = {};
  if (type === 'h1') {
    if ((heading || '').trim()) slide.h1 = heading.trim();
    if ((content || '').trim()) slide.p  = content.trim();
  } else if (type === 'h2') {
    if ((heading || '').trim()) slide.h2 = heading.trim();
    if ((content || '').trim()) slide.p  = content.trim();
  } else if (type === 'ul') {
    if ((heading || '').trim()) slide.h2 = heading.trim();
    slide.ul = (items || '').split('\n').map(s => s.trim()).filter(Boolean);
  } else {
    if ((content || '').trim()) slide.p = content.trim();
  }
  if ((img || '').trim()) slide.img = img.trim();
  return slide;
}

router.post('/clases/diapositiva/crear', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, topicKey, type, heading, content, items, img } = req.body;
  const course = classesData[courseKey];
  if (!course || !course.topics || !course.topics[topicKey]) return res.redirect('/admin/clases?flash=error');
  if (!course.topics[topicKey].slides) course.topics[topicKey].slides = [];
  course.topics[topicKey].slides.push(buildSlide(type, heading, content, items, img));
  await saveClasses();
  res.redirect('/admin/clases');
});

router.post('/clases/diapositiva/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, topicKey, index } = req.body;
  const idx = parseInt(index, 10);
  const course = classesData[courseKey];
  if (course && course.topics && course.topics[topicKey] && !isNaN(idx)) {
    course.topics[topicKey].slides.splice(idx, 1);
    await saveClasses();
  }
  res.redirect('/admin/clases');
});

router.post('/clases/diapositiva/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, topicKey, index, type, heading, content, items, img } = req.body;
  const idx = parseInt(index, 10);
  const course = classesData[courseKey];
  if (!course || !course.topics || !course.topics[topicKey] || isNaN(idx)) return res.redirect('/admin/clases?flash=error');
  const slides = course.topics[topicKey].slides || [];
  if (idx < 0 || idx >= slides.length) return res.redirect('/admin/clases?flash=error');
  slides[idx] = buildSlide(type, heading, content, items, img);
  await saveClasses();
  res.redirect('/admin/clases');
});

router.post('/clases/diapositiva/mover', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, topicKey, index, direction } = req.body;
  const idx = parseInt(index, 10);
  const course = classesData[courseKey];
  if (!course || !course.topics || !course.topics[topicKey] || isNaN(idx)) return res.redirect('/admin/clases');
  const slides = course.topics[topicKey].slides || [];
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= slides.length) return res.redirect('/admin/clases');
  [slides[idx], slides[swapIdx]] = [slides[swapIdx], slides[idx]];
  await saveClasses();
  res.redirect('/admin/clases');
});

router.post('/clases/diapositiva/duplicar', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, topicKey, index } = req.body;
  const idx = parseInt(index, 10);
  const course = classesData[courseKey];
  if (!course || !course.topics || !course.topics[topicKey] || isNaN(idx)) return res.redirect('/admin/clases');
  const slides = course.topics[topicKey].slides || [];
  if (idx < 0 || idx >= slides.length) return res.redirect('/admin/clases');
  const copy = JSON.parse(JSON.stringify(slides[idx]));
  slides.splice(idx + 1, 0, copy);
  await saveClasses();
  res.redirect('/admin/clases');
});

router.post('/clases/tema/mover', requireAuth, requireAdmin, async (req, res) => {
  const { courseKey, topicKey, direction } = req.body;
  const course = classesData[courseKey];
  if (!course || !course.topics) return res.redirect('/admin/clases');
  const entries = Object.entries(course.topics);
  const idx = entries.findIndex(([k]) => k === topicKey);
  if (idx === -1) return res.redirect('/admin/clases');
  const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= entries.length) return res.redirect('/admin/clases');
  [entries[idx], entries[swapIdx]] = [entries[swapIdx], entries[idx]];
  course.topics = Object.fromEntries(entries);
  await saveClasses();
  res.redirect('/admin/clases');
});

router.post('/clases/diapositiva/upload-imagen', requireAuth, requireAdmin, uploadSlideImage, (req, res) => {
  if (!req.blobUrl) return res.status(400).json({ ok: false, error: 'No se pudo subir la imagen' });
  res.json({ ok: true, url: req.blobUrl });
});

router.get('/clases/curso/:key/exportar', requireAuth, requireAdmin, (req, res) => {
  const { key } = req.params;
  const course = classesData[key];
  if (!course) return res.redirect('/admin/clases');
  const filename = course.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() + '.json';
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(course, null, 2));
});

router.post('/clases/curso/importar', requireAuth, requireAdmin, async (req, res) => {
  const rawJson     = (req.body.json  || '').trim();
  const titleOverride = (req.body.title || '').trim();
  if (!rawJson) return res.redirect('/admin/clases?flash=error');
  let data;
  try { data = JSON.parse(rawJson); } catch { return res.redirect('/admin/clases?flash=error'); }
  if (!data || typeof data !== 'object') return res.redirect('/admin/clases?flash=error');

  const finalTitle = (titleOverride || String(data.title || '')).trim();
  if (!finalTitle) return res.redirect('/admin/clases?flash=error');

  const rawTopics = (data.topics && typeof data.topics === 'object') ? data.topics : {};
  const sanitized = { title: finalTitle, topics: {} };
  for (const [tk, tv] of Object.entries(rawTopics)) {
    if (!tv || typeof tv !== 'object') continue;
    sanitized.topics[tk] = {
      title: String(tv.title || tk).trim(),
      slides: Array.isArray(tv.slides) ? tv.slides.map(s => {
        if (!s || typeof s !== 'object') return null;
        const sl = {};
        if (typeof s.h1  === 'string' && s.h1.trim())  sl.h1  = s.h1.trim();
        if (typeof s.h2  === 'string' && s.h2.trim())  sl.h2  = s.h2.trim();
        if (typeof s.p   === 'string' && s.p.trim())   sl.p   = s.p.trim();
        if (Array.isArray(s.ul)) sl.ul = s.ul.filter(i => typeof i === 'string' && i.trim()).map(i => i.trim());
        if (typeof s.img === 'string' && s.img.trim()) sl.img = s.img.trim();
        return Object.keys(sl).length ? sl : null;
      }).filter(Boolean) : [],
    };
  }

  let key = slugFromTitle(finalTitle) || 'curso';
  if (classesData[key]) key = key + '_' + Date.now().toString(36);
  classesData[key] = sanitized;
  await saveClasses();
  res.redirect('/admin/clases');
});

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
  // El resumen necesita todas las cotizaciones confirmadas (métricas del periodo,
  // top ítems, sparkline). De órdenes/facturas solo se necesitan los quotationId
  // convertidos → se traen como sets ligeros, sin cargar esas tablas completas.
  const [quotations, drafts, { orderQids, invoiceQids }] = await Promise.all([
    getAllQuotations(), getDraftQuotations(50), getConvertedQuotationIds(),
  ]);
  const summary = buildQuotationSummary(quotations, orderQids, invoiceQids, req.query.periodo);

  // La tabla se pagina en memoria (las cotizaciones ya están cargadas para el
  // resumen): evita renderizar miles de filas sin una query adicional.
  const size  = 25;
  const total = quotations.length;
  const pages = Math.max(1, Math.ceil(total / size));
  const page  = Math.min(pages, Math.max(1, Number(req.query.page) || 1));
  const pageRows = quotations.slice((page - 1) * size, page * size);

  res.render('admin/quotations', { quotations: pageRows, drafts, summary, page, pages, total, periodo: req.query.periodo || '' });
});

router.get('/cotizaciones/:id', requireAuth, requireAdmin, async (req, res) => {
  const quotation = await getQuotationById(req.params.id);
  if (!quotation) return res.redirect('/admin/cotizaciones');
  res.render('admin/quotation-detail', { quotation, pdfConfig: loadPdfConfig(), empleados: await getActiveEmployees() });
});

router.post('/cotizaciones/:id/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteQuotation(req.params.id);
  res.redirect('/admin/cotizaciones');
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

router.post('/cotizador-items/servicio/crear', requireAuth, requireAdmin, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/admin/cotizador-items?flash=error-name');
  const services = loadServicesCatalog();
  const id = 'svc-' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
  services.push({ id, name, type: 'service' });
  await saveServicesCatalog(services);
  invalidateCatalogCache();
  res.redirect('/admin/cotizador-items?flash=created');
});

router.post('/cotizador-items/servicio/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, name } = req.body;
  const trimmed = (name || '').trim();
  if (!id || !trimmed) return res.redirect('/admin/cotizador-items?flash=error-name');
  const services = loadServicesCatalog();
  const svc = services.find(s => s.id === id);
  if (svc) svc.name = trimmed;
  await saveServicesCatalog(services);
  invalidateCatalogCache();
  res.redirect('/admin/cotizador-items?flash=updated');
});

router.post('/cotizador-items/servicio/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body;
  const services = loadServicesCatalog().filter(s => s.id !== id);
  await saveServicesCatalog(services);
  invalidateCatalogCache();
  res.redirect('/admin/cotizador-items?flash=deleted');
});

router.post('/cotizador-items/producto/crear', requireAuth, requireAdmin, async (req, res) => {
  const name = (req.body.name || '').trim();
  if (!name) return res.redirect('/admin/cotizador-items?flash=error-name');
  const services = loadServicesCatalog();
  const id = 'prd-' + name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') + '-' + Date.now().toString(36);
  services.push({ id, name, type: 'product' });
  await saveServicesCatalog(services);
  invalidateCatalogCache();
  res.redirect('/admin/cotizador-items?flash=created');
});

router.post('/cotizador-items/producto/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, name } = req.body;
  const trimmed = (name || '').trim();
  if (!id || !trimmed) return res.redirect('/admin/cotizador-items?flash=error-name');
  const services = loadServicesCatalog();
  const item = services.find(s => s.id === id);
  if (item) item.name = trimmed;
  await saveServicesCatalog(services);
  invalidateCatalogCache();
  res.redirect('/admin/cotizador-items?flash=updated');
});

router.post('/cotizador-items/producto/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.body;
  const services = loadServicesCatalog().filter(s => s.id !== id);
  await saveServicesCatalog(services);
  invalidateCatalogCache();
  res.redirect('/admin/cotizador-items?flash=deleted');
});

// ── Configuración del liquidador ──────────────────────────────────────────

// ── Configuración (módulo unificado) ──────────────────────────────────────

router.get('/configuracion', requireAuth, requireAdmin, async (req, res) => {
  res.render('admin/configuracion', {
    cotizadorConfig:   loadCotizadorConfig(),
    pdfConfig:         loadPdfConfig(),
    parqueaderoConfig: loadParqueaderoConfig(),
    puntosConfig:      loadPuntosConfig(),
    empleados:         await getAllEmployees(),
    usuarios:          await getAllUsers(),
    liquidadorPinSet:  settings.get('liquidador_pin_hash') != null,
    flash: req.query.flash || null,
    tab:   req.query.tab   || 'liquidador',
  });
});

// PIN de acceso rápido al liquidador (alternativa a la sesión de admin).
router.post('/configuracion/liquidador-pin', requireAuth, requireAdmin, async (req, res) => {
  const pin = String(req.body.pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) {
    return res.redirect('/admin/configuracion?tab=liquidador&flash=error');
  }
  await settings.set('liquidador_pin_hash', await bcrypt.hash(pin, 10));
  res.redirect('/admin/configuracion?tab=liquidador&flash=saved');
});

// Quita el PIN: el liquidador queda accesible solo con sesión de admin.
router.post('/configuracion/liquidador-pin/quitar', requireAuth, requireAdmin, async (req, res) => {
  await settings.set('liquidador_pin_hash', null);
  res.redirect('/admin/configuracion?tab=liquidador&flash=saved');
});

// ── Empleados (acceso al portal del taller con PIN) ───────────────────────

// Comprueba que el PIN (6 dígitos) no choque con el de otro empleado activo.
async function pinIsTaken(pin, exceptId) {
  const all = await getAllEmployees();
  for (const e of all) {
    if (e.id === exceptId) continue;
    if (e.pinHash && await bcrypt.compare(pin, e.pinHash)) return true;
  }
  return false;
}

router.post('/configuracion/empleados', requireAuth, requireAdmin, async (req, res) => {
  const name = (req.body.name || '').trim().slice(0, 80);
  const pin  = String(req.body.pin || '').trim();
  if (!name || !/^\d{6}$/.test(pin) || await pinIsTaken(pin)) {
    return res.redirect('/admin/configuracion?tab=empleados&flash=error');
  }
  const pinHash = await bcrypt.hash(pin, 10);
  await createEmployee({ name, pinHash });
  res.redirect('/admin/configuracion?tab=empleados&flash=saved');
});

// Liga un usuario existente de la web como empleado: entra al portal del taller
// con su correo y contraseña en vez de un PIN.
router.post('/configuracion/empleados/ligar', requireAuth, requireAdmin, async (req, res) => {
  const userId = (req.body.userId || '').trim();
  const user = userId ? await getUserById(userId) : null;
  // Validar: usuario existente y no ligado ya a otro empleado.
  if (!user || await getEmployeeByUserId(userId)) {
    return res.redirect('/admin/configuracion?tab=empleados&flash=error');
  }
  await createEmployee({ name: user.name || user.email, userId });
  res.redirect('/admin/configuracion?tab=empleados&flash=saved');
});

router.post('/configuracion/empleados/:id', requireAuth, requireAdmin, async (req, res) => {
  const emp = await getEmployeeById(req.params.id);
  if (!emp) return res.redirect('/admin/configuracion?tab=empleados');
  const updates = {};
  const name = (req.body.name || '').trim().slice(0, 80);
  if (name) updates.name = name;
  updates.active = req.body.active === 'on';
  const pin = String(req.body.pin || '').trim();
  if (pin) {
    if (!/^\d{6}$/.test(pin) || await pinIsTaken(pin, emp.id)) {
      return res.redirect('/admin/configuracion?tab=empleados&flash=error');
    }
    updates.pinHash = await bcrypt.hash(pin, 10);
  }
  await updateEmployee(emp.id, updates);
  res.redirect('/admin/configuracion?tab=empleados&flash=saved');
});

router.post('/configuracion/empleados/:id/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteEmployee(req.params.id);
  res.redirect('/admin/configuracion?tab=empleados&flash=saved');
});

router.post('/configuracion/cotizador', requireAuth, requireAdmin, async (req, res) => {
  const { waHeader, waItemPrefix, waFooter, waNote } = req.body;
  await saveCotizadorConfig({
    waHeader:     (waHeader     || '').trim(),
    waItemPrefix: (waItemPrefix || '•').trim() || '•',
    waFooter:     (waFooter     || '').trim(),
    waNote:       (waNote       || '').trim(),
  });
  res.redirect('/admin/configuracion?tab=liquidador&flash=saved');
});

router.post('/configuracion/pdf', requireAuth, requireAdmin, async (req, res) => {
  const validityDays = Math.max(1, parseInt(req.body.validityDays, 10) || 30);
  await savePdfConfig({
    companyName:  (req.body.companyName  || '').trim() || 'GORILLAZ MOTORBIKES',
    nit:          (req.body.nit          || '').trim(),
    phone:        (req.body.phone        || '').trim(),
    email:        (req.body.email        || '').trim(),
    address:      (req.body.address      || '').trim(),
    website:      (req.body.website      || '').trim(),
    city:         (req.body.city         || '').trim(),
    headerColor:  /^#[0-9a-fA-F]{6}$/.test(req.body.headerColor) ? req.body.headerColor : '#F25C05',
    validityDays,
    footerNote:   (req.body.footerNote   || '').trim(),
    showPhone:    req.body.showPhone  === 'on',
    showNotes:    req.body.showNotes  === 'on',
  });
  res.redirect('/admin/configuracion?tab=pdf&flash=saved');
});

router.post('/configuracion/parqueadero', requireAuth, requireAdmin, async (req, res) => {
  const diasGratis   = Math.max(0, parseInt(req.body.diasGratis, 10)   || 0);
  const tarifaPorDia = Math.max(0, parseInt(req.body.tarifaPorDia, 10) || 0);
  await saveParqueaderoConfig({ diasGratis, tarifaPorDia });
  res.redirect('/admin/configuracion?tab=parqueadero&flash=saved');
});

router.post('/configuracion/puntos', requireAuth, requireAdmin, async (req, res) => {
  const current = loadPuntosConfig();
  const points  = {};
  Object.keys(PUNTOS_DEFAULTS.points).forEach(key => {
    const val = parseInt(req.body[`pts_${key}`], 10);
    points[key] = isNaN(val) ? (current.points[key] || 0) : Math.max(0, val);
  });
  const count  = parseInt(req.body.lvl_count, 10) || 0;
  const levels = [];
  for (let i = 0; i < count; i++) {
    const name  = (req.body[`lvl_name_${i}`]  || '').trim();
    const icon  = (req.body[`lvl_icon_${i}`]  || '').trim();
    const color = (req.body[`lvl_color_${i}`] || '').trim();
    const min   = Math.max(0, parseInt(req.body[`lvl_min_${i}`], 10) || 0);
    if (name) levels.push({ name, icon, color, min });
  }
  await savePuntosConfig({ points, levels: levels.length ? levels : current.levels });
  res.redirect('/admin/configuracion?tab=puntos&flash=saved');
});

// ── Redirects desde las rutas antiguas ────────────────────────────────────

router.get('/cotizador-config', requireAuth, requireAdmin, (req, res) => {
  res.redirect('/admin/configuracion?tab=liquidador');
});
router.get('/config-pdf-cotizacion', requireAuth, requireAdmin, (req, res) => {
  res.redirect('/admin/configuracion?tab=pdf');
});
router.get('/config-parqueadero', requireAuth, requireAdmin, (req, res) => {
  res.redirect('/admin/configuracion?tab=parqueadero');
});

router.post('/cotizador-config', requireAuth, requireAdmin, async (req, res) => {
  const { waHeader, waItemPrefix, waFooter, waNote } = req.body;
  await saveCotizadorConfig({
    waHeader:     (waHeader     || '').trim(),
    waItemPrefix: (waItemPrefix || '•').trim() || '•',
    waFooter:     (waFooter     || '').trim(),
    waNote:       (waNote       || '').trim(),
  });
  res.redirect('/admin/configuracion?tab=liquidador&flash=saved');
});

// ── Configuración PDF de cotización (legacy) ──────────────────────────────

router.post('/config-pdf-cotizacion', requireAuth, requireAdmin, async (req, res) => {
  const validityDays = Math.max(1, parseInt(req.body.validityDays, 10) || 30);
  await savePdfConfig({
    companyName:  (req.body.companyName  || '').trim() || 'GORILLAZ MOTORBIKES',
    nit:          (req.body.nit          || '').trim(),
    phone:        (req.body.phone        || '').trim(),
    email:        (req.body.email        || '').trim(),
    address:      (req.body.address      || '').trim(),
    website:      (req.body.website      || '').trim(),
    city:         (req.body.city         || '').trim(),
    headerColor:  /^#[0-9a-fA-F]{6}$/.test(req.body.headerColor) ? req.body.headerColor : '#F25C05',
    validityDays,
    footerNote:   (req.body.footerNote   || '').trim(),
    showPhone:    req.body.showPhone  === 'on',
    showNotes:    req.body.showNotes  === 'on',
  });
  res.redirect('/admin/configuracion?tab=pdf&flash=saved');
});

// ── Configuración de parqueadero (legacy) ─────────────────────────────────

router.post('/config-parqueadero', requireAuth, requireAdmin, async (req, res) => {
  const diasGratis   = Math.max(0, parseInt(req.body.diasGratis, 10)   || 0);
  const tarifaPorDia = Math.max(0, parseInt(req.body.tarifaPorDia, 10) || 0);
  await saveParqueaderoConfig({ diasGratis, tarifaPorDia });
  res.redirect('/admin/configuracion?tab=parqueadero&flash=saved');
});

// ── Órdenes de servicio ───────────────────────────────────────────────────

// El mecánico asignado y el empleado del portal son una sola cosa: el nombre
// visible (mechanic) se deriva del empleado seleccionado en el configurador.
async function resolveMechanicName(employeeId) {
  if (!employeeId) return null;
  const emp = await getEmployeeById(employeeId);
  return emp ? emp.name : null;
}

router.post('/cotizaciones/:id/convertir-orden', requireAuth, requireAdmin, async (req, res) => {
  const quotation = await getQuotationById(req.params.id);
  if (!quotation) return res.redirect('/admin/cotizaciones');
  const employeeId = req.body.employeeId || null;
  const { id } = await createServiceOrder({
    quotationId:        quotation.id,
    items:              quotation.items,
    total:              quotation.total,
    motorcycle:         [quotation.plate, quotation.motorcycle].filter(Boolean).join(' — ') || null,
    clientPhone:        quotation.clientPhone,
    clientPhoneCountry: quotation.clientPhoneCountry,
    employeeId,
    mechanic:           await resolveMechanicName(employeeId),
    notes:              (req.body.notes || '').trim() || null,
    estimatedDate:      req.body.estimatedDate || null,
    status:             'ingreso_taller',
    actor:              res.locals.user?.name || 'Admin',
  });
  res.redirect('/admin/ordenes-servicio/' + id);
});

router.get('/ordenes-servicio', requireAuth, requireAdmin, async (req, res) => {
  const status = req.query.status || '';
  const page   = Number(req.query.page) || 1;
  const [pageData, counts] = await Promise.all([
    getServiceOrdersPage({ page, size: 25, status }),
    getServiceOrderStatusCounts(),
  ]);
  res.render('admin/service-orders', {
    orders: pageData.rows, counts, status,
    page: pageData.page, pages: pageData.pages, total: pageData.total,
  });
});

// Crear una orden de servicio directamente, sin partir de una cotización.
router.get('/ordenes-servicio/nueva', requireAuth, requireAdmin, async (req, res) => {
  res.render('admin/service-order-new', { error: null, empleados: await getActiveEmployees() });
});

router.post('/ordenes-servicio/nueva', requireAuth, requireAdmin, async (req, res) => {
  let items;
  try {
    items = JSON.parse(req.body.items || '[]');
  } catch {
    items = null;
  }

  // Normaliza y valida los ítems recibidos del formulario.
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
    return res.status(400).render('admin/service-order-new', { error: 'Agrega al menos un ítem válido (nombre, cantidad y precio).', empleados: await getActiveEmployees() });
  }

  const total      = clean.reduce((s, it) => s + it.price * it.qty, 0);
  const plate      = (req.body.plate || '').toUpperCase().trim();
  const moto       = (req.body.motorcycle || '').trim();
  const motorcycle = [plate, moto].filter(Boolean).join(' — ') || null;
  const phone      = (req.body.clientPhone || '').replace(/\D/g, '') || null;
  const employeeId = req.body.employeeId || null;

  const { id } = await createServiceOrder({
    items:              clean,
    total,
    motorcycle,
    clientPhone:        phone,
    clientPhoneCountry: req.body.clientPhoneCountry || '+57',
    mechanic:           await resolveMechanicName(employeeId),
    notes:              (req.body.notes || '').trim() || null,
    estimatedDate:      req.body.estimatedDate || null,
    employeeId,
    status:             'ingreso_taller',
    actor:              res.locals.user?.name || 'Admin',
  });
  res.redirect('/admin/ordenes-servicio/' + id);
});

// Desliga una orden de una factura anulada dejando la trazabilidad intacta:
// rellena el hito 'factura_generada' si la orden es anterior al registro de
// eventos, marca 'factura_anulada', y devuelve la orden a 'trabajo_completo'
// para reabrir la edición de ítems. Se usa tanto al anular como al abrir una
// orden que quedó vinculada a una factura ya anulada (autocorrección).
async function detachAnnulledInvoice(order, invoice, actor) {
  // Claim atómico primero: solo la petición que realmente desliga la orden
  // registra los hitos, evitando duplicados si dos requests coinciden.
  if (!(await detachOrderFromInvoice(order.id, invoice.id))) return;
  const evs = await getServiceOrderEvents(order.id);
  if (!evs.some(e => e.status === 'factura_generada')) {
    await addServiceOrderEvent(order.id, 'factura_generada', null, invoice.label, invoice.createdAt);
  }
  await addServiceOrderEvent(order.id, 'factura_anulada', actor, invoice.label);
  await addServiceOrderEvent(order.id, 'trabajo_completo', actor); // cambio de estado
}

router.get('/ordenes-servicio/:id', requireAuth, requireAdmin, async (req, res) => {
  let order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/admin/ordenes-servicio');
  let invoice = order.invoiceId ? await getInvoiceById(order.invoiceId) : null;
  // Autocorrección: si la orden sigue atada a una factura ya anulada (p. ej.
  // anulada antes de existir el deslinde), se reconcilia al vuelo y se recarga.
  if (invoice && invoice.status === 'anulada' && order.invoiceId === invoice.id) {
    await detachAnnulledInvoice(order, invoice, res.locals.user?.name || 'Admin');
    order = await getServiceOrderById(req.params.id);
    invoice = null;
  }
  const quotation = order.quotationId ? await getQuotationById(order.quotationId) : null;
  const parqueaderoConfig = loadParqueaderoConfig();
  const empleados = await getActiveEmployees();
  const empleadoAsignado = order.employeeId ? await getEmployeeById(order.employeeId) : null;
  const events = await getServiceOrderEvents(order.id);
  res.render('admin/service-order-detail', { order, quotation, invoice, parqueaderoConfig, empleados, empleadoAsignado, events });
});

router.post('/ordenes-servicio/:id/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { status, notes, estimatedDate, employeeId } = req.body;
  const order = await getServiceOrderById(req.params.id);
  const updates = {
    status:        status || 'ingreso_taller',
    notes:         (notes || '').trim() || null,
    estimatedDate: estimatedDate || null,
    employeeId:    employeeId || null,
    mechanic:      await resolveMechanicName(employeeId || null),
  };
  if (status === 'trabajo_completo' && order && !order.trabajoCompletoAt) {
    updates.trabajoCompletoAt = nowCOT();
  }
  // El admin que toca la orden la da por revisada: limpia el aviso del taller.
  if (order && order.pendingReview) updates.pendingReview = false;
  await updateServiceOrder(req.params.id, updates, res.locals.user?.name || 'Admin');
  res.redirect('/admin/ordenes-servicio/' + req.params.id);
});

router.post('/ordenes-servicio/:id/editar-datos', requireAuth, requireAdmin, async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/admin/ordenes-servicio');
  const plate = (req.body.plate || '').toUpperCase().trim();
  const moto = (req.body.motorcycle || '').trim();
  const motorcycle = [plate, moto].filter(Boolean).join(' — ') || null;
  const employeeId = req.body.employeeId || null;
  const updates = {
    motorcycle,
    clientPhone:        (req.body.clientPhone || '').replace(/\D/g, '') || null,
    clientPhoneCountry: req.body.clientPhoneCountry || '+57',
    employeeId,
    mechanic: await resolveMechanicName(employeeId),
    estimatedDate: req.body.estimatedDate || null,
  };
  // Los ítems solo se editan mientras la orden no esté facturada: cambiar el
  // total después de emitida la factura dejaría ambos documentos descuadrados.
  if (!order.invoiceId) {
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
    // Si no llegó ningún ítem válido se conservan los actuales (una orden no
    // puede quedar vacía); cualquier cambio real recalcula el total.
    if (clean.length > 0) {
      updates.items = clean;
      updates.total = clean.reduce((s, it) => s + it.price * it.qty, 0);
    }
  }
  await updateServiceOrder(req.params.id, updates);

  // Deja constancia en la trazabilidad, pero solo si algún campo cambió de
  // verdad, para no ensuciar la línea de tiempo al abrir/guardar sin editar.
  const changed =
    updates.motorcycle          !== order.motorcycle ||
    (updates.clientPhone || null)        !== (order.clientPhone || null) ||
    (updates.clientPhoneCountry || null) !== (order.clientPhoneCountry || null) ||
    (updates.employeeId || null)         !== (order.employeeId || null) ||
    (updates.estimatedDate || null)      !== (order.estimatedDate || null) ||
    (updates.total !== undefined && updates.total !== order.total) ||
    (updates.items !== undefined && JSON.stringify(updates.items) !== JSON.stringify(order.items));
  if (changed) {
    await addServiceOrderEvent(req.params.id, 'editado', res.locals.user?.name || 'Admin');
  }

  res.redirect('/admin/ordenes-servicio/' + req.params.id);
});

router.post('/ordenes-servicio/:id/convertir-factura', requireAuth, requireAdmin, async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order || order.invoiceId || order.status !== 'trabajo_completo') return res.redirect('/admin/ordenes-servicio/' + req.params.id);
  const actor = res.locals.user?.name || 'Admin';
  const { invoiceId } = await convertServiceOrderToInvoice(order, {
    tax:           Math.round(Number(req.body.tax || 0)),
    paymentMethod: req.body.paymentMethod || 'efectivo',
    paidNow:       req.body.paidNow === '1',
    notes:         (req.body.notes || '').trim() || null,
  }, actor);
  res.redirect('/admin/facturas/' + invoiceId);
});

// Borrado permanente de una orden. Se bloquea si ya tiene factura: anular esa
// factura es el paso previo, para no dejar registros contables huérfanos.
router.post('/ordenes-servicio/:id/borrar', requireAuth, requireAdmin, async (req, res) => {
  const order = await getServiceOrderById(req.params.id);
  if (!order) return res.redirect('/admin/ordenes-servicio');
  if (order.invoiceId) return res.redirect('/admin/ordenes-servicio/' + order.id + '?error=facturada');
  await deleteServiceOrder(order.id);
  res.redirect('/admin/ordenes-servicio?flash=borrada');
});

// ── Facturas ──────────────────────────────────────────────────────────────

router.get('/facturas', requireAuth, requireAdmin, async (req, res) => {
  const status = req.query.status || '';
  const page   = Number(req.query.page) || 1;
  const [pageData, stats] = await Promise.all([
    getInvoicesPage({ page, size: 25, status }),
    getInvoiceStats(),
  ]);
  res.render('admin/invoices', {
    invoices: pageData.rows, stats, status,
    page: pageData.page, pages: pageData.pages, total: pageData.total,
  });
});

router.get('/facturas/:id', requireAuth, requireAdmin, async (req, res) => {
  const invoice = await getInvoiceById(req.params.id);
  if (!invoice) return res.redirect('/admin/facturas');
  const order = await getServiceOrderById(invoice.serviceOrderId);
  // Si la orden no tiene teléfono pero la cotización origen sí, lo mostramos como respaldo.
  if (order && !order.clientPhone && invoice.quotationId) {
    const quotation = await getQuotationById(invoice.quotationId);
    if (quotation && quotation.clientPhone) {
      order.clientPhone        = quotation.clientPhone;
      order.clientPhoneCountry = quotation.clientPhoneCountry || '+57';
    }
  }
  res.render('admin/invoice-detail', { invoice, order });
});

// Guarda el número de WhatsApp del cliente en la orden de la factura (igual que el liquidador con la cotización).
router.post('/facturas/:id/telefono', requireAuth, requireAdmin, async (req, res) => {
  try {
    const invoice = await getInvoiceById(req.params.id);
    if (!invoice || !invoice.serviceOrderId) return res.status(404).json({ error: 'Factura no encontrada.' });
    const digits = (req.body.clientPhone || '').replace(/\D/g, '');
    if (!digits) return res.status(400).json({ error: 'Número inválido.' });
    await updateServiceOrderPhone(invoice.serviceOrderId, digits, req.body.clientPhoneCountry || '+57');
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /admin/facturas/:id/telefono error:', err.message);
    res.status(500).json({ error: 'Error al guardar el teléfono.' });
  }
});

const INVOICE_STATUSES = ['pendiente', 'pagada', 'anulada'];

router.post('/facturas/:id/estado', requireAuth, requireAdmin, async (req, res) => {
  const invoice = await getInvoiceById(req.params.id);
  if (!invoice) return res.redirect('/admin/facturas');

  // El estado debe ser uno de los válidos: un POST directo con otro valor haría
  // desaparecer la factura de todos los reportes (que filtran por estos estados).
  const newStatus = req.body.status;
  if (!INVOICE_STATUSES.includes(newStatus)) {
    setFlash(res, 'error', 'Estado de factura inválido.');
    return res.redirect('/admin/facturas/' + req.params.id);
  }
  // 'anulada' es terminal: una factura anulada no puede volver a pendiente/pagada.
  // Reabrirla permitiría re-facturar la orden (se desligó al anular) y contar el
  // ingreso dos veces. Para rehacer el cobro se emite una factura nueva.
  if (invoice.status === 'anulada') {
    setFlash(res, 'error', 'Una factura anulada no puede cambiar de estado.');
    return res.redirect('/admin/facturas/' + req.params.id);
  }

  await updateInvoiceStatus(req.params.id, newStatus, req.body.paymentMethod);

  // Al anular una factura se desliga de su orden para que vuelva a ser editable:
  // se limpia el vínculo, la orden regresa a 'trabajo completo' y queda el hito
  // en la trazabilidad. Solo en la transición real a 'anulada'.
  if (req.body.status === 'anulada' && invoice && invoice.status !== 'anulada' && invoice.serviceOrderId) {
    const order = await getServiceOrderById(invoice.serviceOrderId);
    if (order && order.invoiceId === invoice.id) {
      await detachAnnulledInvoice(order, invoice, res.locals.user?.name || 'Admin');
    }
  }

  const STATUS_LABELS = { pendiente: 'Pendiente', pagada: 'Pagada', anulada: 'Anulada' };
  const label = STATUS_LABELS[req.body.status] || req.body.status;
  if (req.body.status === 'anulada') {
    setFlash(res, 'success', `Factura anulada.`);
  } else {
    setFlash(res, 'success', `Estado de la factura actualizado a «${label}».`);
  }

  res.redirect('/admin/facturas/' + req.params.id);
});

// ── Contabilidad → redirige al módulo de finanzas ─────────────────────────

router.get('/contabilidad', (req, res) => res.redirect(301, '/admin/finanzas'));

// ── Ayuda ──────────────────────────────────────────────────────────────────

router.get('/ayuda', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/ayuda', { title: 'Ayuda' });
});

// ── DEV ────────────────────────────────────────────────────────────────────

router.get('/dev', requireAuth, requireAdmin, (req, res) => {
  res.render('admin/dev', { title: 'DEV' });
});

router.get('/dev/backup', requireAuth, requireAdmin, async (req, res) => {
  const snapshot = await backupAllTables();
  const date = new Date().toISOString().slice(0, 10);
  const filename = `gorillaz-backup-${date}.json`;
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('Content-Type', 'application/json');
  res.send(JSON.stringify(snapshot, null, 2));
});

module.exports = router;
