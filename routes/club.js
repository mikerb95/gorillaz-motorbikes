'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const QRCode = require('qrcode');

const { JWT_SECRET, resendClient }  = require('../config');
const { requireAuth }               = require('../middleware/auth');
const { authLimiter }               = require('../middleware/auth');
const { getScoreLevel, SCORE_POINTS } = require('../helpers/score');
const {
  getUserById, getUserByEmail, getUserByCedula, getUserByResetToken,
  updateUser, createUser,
  getAllEvents, getUpcomingEvents,
  registerEventAttendance, getUserEventRegistrations,
  getLeaderboard,
  addUserScore,
} = require('../db');

const router = express.Router();

router.get('/', async (req, res) => {
  if (req.userId) return res.redirect('/club/panel');
  const dir     = path.join(__dirname, '..', 'images', 'slideshow', 'club');
  const allowed = new Set(['.jpg', '.jpeg', '.png', '.webp', '.avif']);
  let slidesClub = [];
  try {
    slidesClub = fs.readdirSync(dir)
      .filter(f => allowed.has(path.extname(f).toLowerCase()))
      .sort()
      .map(f => `/images/slideshow/club/${encodeURIComponent(f)}`);
  } catch { }
  if (!slidesClub.length) slidesClub = ['/images/download.png'];
  let events = [];
  try { events = await getAllEvents(); } catch { }
  res.render('club/landing', { events, slidesClub });
});

router.get('/login', (req, res) => res.render('club/login', { error: null }));

router.post('/login', authLimiter, async (req, res) => {
  const { email, password } = req.body;
  try {
    const user = await getUserByEmail(email);
    if (!user) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).render('club/login', { error: 'Credenciales inválidas' });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch (e) {
    console.error('POST /club/login error:', e);
    res.status(500).render('club/login', { error: 'Error del servidor' });
  }
});

router.get('/registro', (req, res) => {
  if (req.userId) return res.redirect('/club/panel');
  res.render('club/register', { error: null });
});

router.post('/registro', authLimiter, async (req, res) => {
  const { name, cedula, phone, birthdate, bloodType, city, nickname, clubNotifications, emergencyName, emergencyPhone, vehicleBrand, vehicleModel, vehicleYear, vehiclePlate, vehicleCC, vehicleColor, soatExpires, tecnoExpires, email, password, confirmPassword } = req.body;
  if (!name || !email || !password) return res.status(400).render('club/register', { error: 'Nombre, correo y contraseña son obligatorios' });
  if (password !== confirmPassword) return res.status(400).render('club/register', { error: 'Las contraseñas no coinciden' });
  try {
    if (await getUserByEmail(email)) return res.status(400).render('club/register', { error: 'El correo ya está en uso' });
    if (cedula && await getUserByCedula(cedula)) return res.status(400).render('club/register', { error: 'La cédula ya está en uso' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const vehicles = (vehicleBrand || vehiclePlate) ? [{ brand: vehicleBrand, model: vehicleModel, year: vehicleYear, plate: vehiclePlate, cc: vehicleCC, color: vehicleColor, soatExpires: soatExpires || null, tecnoExpires: tecnoExpires || null }] : [];
    const newUser = await createUser({
      name, email, password: hashedPassword, cedula, phone, birthdate, bloodType: bloodType || null, city,
      nickname, clubNotifications: clubNotifications === 'true',
      emergencyName, emergencyPhone,
      vehicles,
      membership: { level: 'Básica', since: new Date().toISOString().slice(0, 10), expires: null, benefits: ['Descuentos en taller', 'Acceso al club'] },
    });
    const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch (e) {
    console.error(e);
    res.status(500).render('club/register', { error: 'Error del servidor' });
  }
});

router.get('/olvide', (req, res) => {
  if (req.userId) return res.redirect('/club/panel');
  res.render('club/forgot', { message: null, error: null });
});

router.post('/olvide', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.render('club/forgot', { error: 'Por favor, ingresa tu correo.', message: null });
  try {
    const user = await getUserByEmail(email);
    if (user) {
      const resetToken = crypto.randomBytes(32).toString('hex');
      await updateUser(user.id, { resetToken, resetTokenExpiry: Date.now() + 3600000 });
      const resetLink = `${req.protocol}://${req.get('host')}/club/reset-password?token=${resetToken}`;
      if (process.env.RESEND_API_KEY) {
        await resendClient.emails.send({ from: 'booking@gorillazmotorbikes.com', to: user.email, subject: 'Recuperar contraseña - Gorillaz Motorbikes', html: `<p>Hola ${user.name || 'Motociclista'},</p><p>Para restablecer tu contraseña, haz clic en el siguiente enlace. Este enlace caducará en 1 hora.</p><p><a href="${resetLink}">[Restablecer contraseña]</a></p><p>Si no solicitaste este cambio, puedes ignorar este mensaje.</p>` });
      } else {
        console.log(`[DEV ONLY] Reset Link: ${resetLink}`);
      }
    }
  } catch (err) { console.error(err); }
  res.render('club/forgot', { message: 'Si el correo existe, te enviamos un enlace de restablecimiento.', error: null });
});

router.get('/reset-password', async (req, res) => {
  const { token } = req.query;
  if (!token) return res.redirect('/club/olvide');
  const user = await getUserByResetToken(token);
  if (!user) return res.render('club/reset', { error: 'El enlace es inválido o ha expirado.', token: '' });
  res.render('club/reset', { error: null, token });
});

router.post('/reset-password', async (req, res) => {
  const { token, password, confirm } = req.body;
  if (password !== confirm) return res.render('club/reset', { error: 'Las contraseñas no coinciden.', token });
  const user = await getUserByResetToken(token);
  if (!user) return res.render('club/reset', { error: 'El enlace es inválido o ha expirado.', token: '' });
  await updateUser(user.id, { password: await bcrypt.hash(password, 10), resetToken: null, resetTokenExpiry: null });
  res.redirect('/club/login');
});

router.post('/logout', (req, res) => {
  res.clearCookie('jwt');
  res.redirect('/');
});

router.get('/panel', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  if (!user) return res.redirect('/club/login');
  const today      = new Date(); today.setHours(0, 0, 0, 0);
  const daysBetween = (a, b) => Math.ceil((a.getTime() - b.getTime()) / (1000 * 60 * 60 * 24));
  const reminders  = (user.vehicles || []).map(v => ({
    plate: v.plate,
    soat:  v.soatExpires  ? daysBetween(new Date(v.soatExpires  + 'T00:00:00'), today) : null,
    tecno: v.tecnoExpires ? daysBetween(new Date(v.tecnoExpires + 'T00:00:00'), today) : null,
  }));
  const [upcomingEvents, registrations] = await Promise.all([
    getUpcomingEvents(8),
    getUserEventRegistrations(user.id),
  ]);
  const scoreLevel = getScoreLevel(user.score || 0);
  res.render('club/dashboard', { user, reminders, upcomingEvents, registrations, scoreLevel, SCORE_POINTS });
});

router.post('/visitas', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const { date, service, type } = req.body;
  if (date && service) {
    const visitType = type || 'visita';
    const pts       = SCORE_POINTS[visitType] || SCORE_POINTS.visita;
    await updateUser(user.id, { visits: [{ date, service, type: visitType }, ...(user.visits || [])] });
    await addUserScore(user.id, pts, visitType, service);
  }
  res.redirect('/club/panel');
});

router.post('/vehiculos', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const { plate, soatExpires, tecnoExpires } = req.body;
  if (plate) {
    const plateUp  = plate.trim().toUpperCase();
    const qrPayload = JSON.stringify({ t: 'vehicle', plate: plateUp, uid: user.id });
    const vehicles = [...(user.vehicles || []), { plate: plateUp, soatExpires: soatExpires || '', tecnoExpires: tecnoExpires || '', qr: qrPayload }];
    await updateUser(user.id, { vehicles });
  }
  res.redirect('/club/panel');
});

router.post('/vehiculos/eliminar', requireAuth, async (req, res) => {
  const user     = await getUserById(req.userId);
  const vehicles = (user.vehicles || []).filter(v => v.plate !== req.body.plate);
  await updateUser(user.id, { vehicles });
  res.redirect('/club/panel');
});

router.post('/vehiculos/actualizar', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  const { plate, soatExpires, tecnoExpires } = req.body;
  const vehicles = (user.vehicles || []).map(v => {
    if (v.plate !== (plate || '').toUpperCase()) return v;
    return { ...v, soatExpires: soatExpires ?? v.soatExpires, tecnoExpires: tecnoExpires ?? v.tecnoExpires, qr: v.qr || JSON.stringify({ t: 'vehicle', plate: v.plate, uid: user.id }) };
  });
  await updateUser(user.id, { vehicles });
  res.redirect('/club/panel');
});

router.post('/eventos/:id/asistencia', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  const ev      = await require('../db').getEventById(eventId);
  if (!ev) return res.redirect('/club/panel');
  await registerEventAttendance(eventId, req.userId);
  res.redirect('/club/panel');
});

router.get('/tabla', async (req, res) => {
  const board  = await getLeaderboard(20);
  const levels = board.map(u => ({ ...u, level: getScoreLevel(u.score) }));
  let myRank   = null;
  if (req.userId) {
    const idx = board.findIndex(u => u.id === req.userId);
    myRank = idx >= 0 ? idx + 1 : null;
  }
  res.render('club/leaderboard', { board: levels, myRank, scorePoints: SCORE_POINTS });
});

router.get('/vehiculos/:plate/qr.png', requireAuth, async (req, res) => {
  const user  = await getUserById(req.userId);
  const plate = (req.params.plate || '').toUpperCase();
  const v     = (user.vehicles || []).find(x => x.plate === plate);
  if (!v) return res.status(404).send('No encontrado');
  try {
    const payload = v.qr || JSON.stringify({ t: 'vehicle', plate: v.plate, uid: user.id });
    const png     = await QRCode.toBuffer(payload, { type: 'png', errorCorrectionLevel: 'M', width: 384, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    res.send(png);
  } catch { res.status(500).send('Error generando QR'); }
});

module.exports = router;
