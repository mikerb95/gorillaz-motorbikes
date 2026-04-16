'use strict';
const express  = require('express');
const { v4: uuidv4 } = require('uuid');
const courses     = require('../data/courses.json');
const classesData = require('../data/classes.json');
const catalog     = require('../data/catalog');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { saveJSON, writeCatalog, uploadProduct } = require('../helpers/files');
const { availability }  = require('../helpers/appointments');
const { SCORE_POINTS }  = require('../helpers/score');
const {
  countUsers, countEvents, countAppointments,
  getAllUsers, getUserById, updateUser, deleteUser,
  getAllEvents, countEvents: _ce, createEvent, getEventById, updateEvent, deleteEvent,
  getEventAttendances, confirmEventAttendance,
  getAllAppointments, createAppointment, updateAppointment, deleteAppointment,
  addUserScore,
} = require('../db');

const router = express.Router();

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const [users, events, citas] = await Promise.all([countUsers(), countEvents(), countAppointments()]);
  res.render('admin/index', { stats: { users, events, citas, cursos: courses.length, productos: (catalog.products || []).length } });
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
  const { title, date, location, description, type } = req.body;
  if (title && date) await createEvent({ id: uuidv4(), title, date, location, description, type: type || 'evento' });
  res.redirect('/admin/eventos');
});

router.post('/eventos/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, title, date, location, description, type } = req.body;
  await updateEvent(id, { title, date, location, description, type });
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
  await confirmEventAttendance(attendanceId);
  const pts = SCORE_POINTS[eventType] || SCORE_POINTS.evento;
  const ev  = await getEventById(eventId);
  await addUserScore(userId, pts, eventType || 'evento', ev ? ev.title : 'Evento del club');
  res.redirect(`/admin/eventos/${eventId}/asistencias`);
});

router.post('/eventos/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteEvent(req.body.id);
  res.redirect('/admin/eventos');
});

router.get('/usuarios', requireAuth, requireAdmin, async (req, res) => {
  const users = await getAllUsers();
  res.render('admin/users', { users });
});

router.post('/usuarios/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { id, name, membershipLevel } = req.body;
  const u = await getUserById(id);
  if (u) {
    const fields = {};
    if (name) fields.name = name;
    if (membershipLevel) fields.membership = { ...u.membership, level: membershipLevel };
    await updateUser(id, fields);
  }
  res.redirect('/admin/usuarios');
});

router.post('/usuarios/eliminar', requireAuth, requireAdmin, async (req, res) => {
  await deleteUser(req.body.id);
  res.redirect('/admin/usuarios');
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
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).send('Error subiendo imágenes');
    const { id, name, price, category, description, brand, sku, stock, discount, tags } = req.body;
    if (!catalog.products) catalog.products = [];
    const prodId  = id && id.trim() ? id.trim() : uuidv4();
    const gallery = (req.files || []).map(f => '/images/products/' + f.filename);
    const mainImage = gallery.length > 0 ? gallery[0] : '/images/download.png';
    if (name && category) {
      catalog.products.push({ id: prodId, name, price: parseInt(price || '0', 10) || 0, category, image: mainImage, gallery: gallery.length > 0 ? gallery : ['/images/download.png'], brand: (brand || '').trim(), sku: (sku || '').trim(), stock: parseInt(stock || '0', 10), discount: Math.min(100, Math.max(0, parseInt(discount || '0', 10))), tags: (tags || '').split(',').map(t => t.trim()).filter(Boolean), description: description || '', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      writeCatalog(catalog);
    }
    res.redirect('/admin/tienda');
  });
});

router.post('/tienda/actualizar', requireAuth, requireAdmin, (req, res) => {
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).send('Error subiendo imágenes');
    const { id, name, price, category, description, brand, sku, stock, discount, tags, existingImages } = req.body;
    const p = (catalog.products || []).find(x => x.id === id);
    if (p) {
      if (name) p.name = name;
      if (price       !== undefined) p.price    = parseInt(price || '0', 10) || 0;
      if (category)                  p.category = category;
      if (description !== undefined) p.description = description;
      if (brand       !== undefined) p.brand    = (brand || '').trim();
      if (sku         !== undefined) p.sku      = (sku || '').trim();
      if (stock       !== undefined) p.stock    = parseInt(stock || '0', 10);
      if (discount    !== undefined) p.discount = Math.min(100, Math.max(0, parseInt(discount || '0', 10)));
      if (tags        !== undefined) p.tags     = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
      let kept         = existingImages ? (Array.isArray(existingImages) ? existingImages : [existingImages]) : [];
      const newUploads = (req.files || []).map(f => '/images/products/' + f.filename);
      const gallery    = [...kept, ...newUploads];
      if (gallery.length > 0) { p.gallery = gallery; p.image = gallery[0]; }
      p.updatedAt = new Date().toISOString();
      writeCatalog(catalog);
    }
    res.redirect('/admin/tienda');
  });
});

router.post('/tienda/eliminar', requireAuth, requireAdmin, (req, res) => {
  catalog.products = (catalog.products || []).filter(p => p.id !== req.body.id);
  writeCatalog(catalog);
  res.redirect('/admin/tienda');
});

router.post('/tienda/upload-image', requireAuth, requireAdmin, (req, res) => {
  uploadProduct(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, message: 'Error subiendo imágenes' });
    res.json({ ok: true, urls: (req.files || []).map(f => '/images/products/' + f.filename) });
  });
});

router.post('/tienda/delete-image', requireAuth, requireAdmin, (req, res) => {
  const { productId, imageUrl } = req.body;
  const p = (catalog.products || []).find(x => x.id === productId);
  if (p && p.gallery) {
    p.gallery   = p.gallery.filter(img => img !== imageUrl);
    p.image     = p.gallery.length > 0 ? p.gallery[0] : '/images/download.png';
    if (!p.gallery.length) p.gallery = ['/images/download.png'];
    p.updatedAt = new Date().toISOString();
    writeCatalog(catalog);
  }
  if ((req.headers.accept || '').includes('application/json')) return res.json({ ok: true });
  res.redirect('/admin/tienda/' + productId + '/editar');
});

router.get('/clases', requireAuth, requireAdmin, (req, res) => res.render('admin/classes', { classesData }));

module.exports = router;
