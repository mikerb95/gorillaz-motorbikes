'use strict';
const express = require('express');
const path    = require('path');
const fs      = require('fs');
const { v4: uuidv4 } = require('uuid');
const jwt    = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { setFlash } = require('../helpers/flash');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

function validateRegistration({ firstName, lastName, email, password, phone, cedula }) {
  if (!firstName || firstName.trim().length < 2 || firstName.trim().length > 50)
    return 'El nombre debe tener entre 2 y 50 caracteres.';
  if (!lastName || lastName.trim().length < 2 || lastName.trim().length > 50)
    return 'El apellido debe tener entre 2 y 50 caracteres.';
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim()))
    return 'El correo electrónico no es válido.';
  if (!password || password.length < 8)
    return 'La contraseña debe tener al menos 8 caracteres.';
  if (phone && !/^[+\d\s\-()ñ]{7,25}$/.test(phone.trim()))
    return 'El teléfono no es válido.';
  if (cedula && (!/^\d{5,12}$/.test(cedula.trim())))
    return 'La cédula debe contener entre 5 y 12 dígitos.';
  return null;
}
const QRCode = require('qrcode');

const { JWT_SECRET, resendClient, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, APP_URL, APPLE_CLIENT_ID, APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY } = require('../config');
const { requireAuth }               = require('../middleware/auth');
const { authLimiter }               = require('../middleware/auth');
const { getScoreLevel, SCORE_POINTS } = require('../helpers/score');
const {
  getUserById, getUserByEmail, getUserByCedula, getUserByResetToken, getUserByGoogleId, getUserByAppleId,
  getPasskeysByUserId, getPasskeyByCredentialId, createPasskey, updatePasskeyCounter, deletePasskey,
  updateUser, createUser,
  getAllEvents, getUpcomingEvents,
  registerEventAttendance, getUserEventRegistrations,
  getLeaderboard,
  addUserScore, getUserRank,
  getQuotationsByMotorcyclePlates,
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

router.get('/login', (req, res) => {
  const returnTo = (req.query.return || '').toString().trim();
  const safeReturn = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '';
  const googleErr = req.query.google;
  const appleErr  = req.query.apple;
  const googleErrorMsg = googleErr === 'denied' ? null
    : googleErr === 'error' ? 'Hubo un problema al autenticarte con Google. Intenta de nuevo.'
    : null;
  const appleErrorMsg = appleErr === 'denied' ? null
    : appleErr === 'error' ? 'Hubo un problema al autenticarte con Apple. Intenta de nuevo.'
    : null;
  const errorMsg = googleErrorMsg || appleErrorMsg || null;
  res.render('club/login', { error: errorMsg, returnTo: safeReturn, googleEnabled: !!GOOGLE_CLIENT_ID, appleEnabled: !!APPLE_CLIENT_ID });
});

router.post('/login', authLimiter, async (req, res) => {
  const { email, password, returnTo } = req.body;
  const safeReturn = (returnTo || '').toString().trim();
  const redirectTo = safeReturn.startsWith('/') && !safeReturn.startsWith('//') ? safeReturn : '/club/panel';
  const gEnabled = !!GOOGLE_CLIENT_ID;
  const aEnabled = !!APPLE_CLIENT_ID;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) {
    return res.status(400).render('club/login', { error: 'Ingresa un correo electrónico válido.', returnTo: safeReturn, googleEnabled: gEnabled, appleEnabled: aEnabled });
  }
  try {
    const user = await getUserByEmail(email);
    if (!user) return res.status(401).render('club/login', { error: 'Credenciales inválidas', returnTo: safeReturn, googleEnabled: gEnabled, appleEnabled: aEnabled });
    if (!user.password || user.password === '$google$' || user.password === '$apple$') {
      const provider = (!user.password || user.password === '$google$') ? 'Google' : 'Apple';
      return res.status(401).render('club/login', { error: `Esta cuenta usa ${provider} para iniciar sesión.`, returnTo: safeReturn, googleEnabled: gEnabled, appleEnabled: aEnabled });
    }
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).render('club/login', { error: 'Credenciales inválidas', returnTo: safeReturn, googleEnabled: gEnabled, appleEnabled: aEnabled });
    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect(redirectTo);
  } catch (e) {
    console.error('POST /club/login error:', e);
    res.status(500).render('club/login', { error: 'Error del servidor', returnTo: safeReturn, googleEnabled: gEnabled, appleEnabled: aEnabled });
  }
});

router.get('/registro', (req, res) => {
  if (req.userId) return res.redirect('/club/panel');
  res.render('club/register', { error: null, googleEnabled: !!GOOGLE_CLIENT_ID, appleEnabled: !!APPLE_CLIENT_ID });
});

router.post('/registro', authLimiter, async (req, res) => {
  const { firstName, lastName, cedula, phone, birthdate, bloodType, city, department, nickname, clubNotifications, emergencyName, emergencyPhone, email, password, confirmPassword } = req.body;
  const validationError = validateRegistration({ firstName, lastName, email, password, phone, cedula });
  if (validationError) return res.status(400).render('club/register', { error: validationError });
  if (password !== confirmPassword) return res.status(400).render('club/register', { error: 'Las contraseñas no coinciden' });
  try {
    if (await getUserByEmail(email)) return res.status(400).render('club/register', { error: 'El correo ya está en uso' });
    if (cedula && await getUserByCedula(cedula)) return res.status(400).render('club/register', { error: 'La cédula ya está en uso' });
    const hashedPassword = await bcrypt.hash(password, 10);
    const brands      = [].concat(req.body.vehicleBrand  || []);
    const models      = [].concat(req.body.vehicleModel  || []);
    const years       = [].concat(req.body.vehicleYear   || []);
    const plates      = [].concat(req.body.vehiclePlate  || []);
    const ccs         = [].concat(req.body.vehicleCC     || []);
    const colors      = [].concat(req.body.vehicleColor  || []);
    const soats       = [].concat(req.body.soatExpires   || []);
    const tecnos      = [].concat(req.body.tecnoExpires  || []);
    const vehicles = brands
      .map((b, i) => ({ brand: b, model: models[i] || '', year: years[i] || '', plate: (plates[i] || '').toUpperCase(), cc: ccs[i] || '', color: colors[i] || '', soatExpires: soats[i] || null, tecnoExpires: tecnos[i] || null }))
      .filter(v => v.brand || v.plate);
    const newUser = await createUser({
      firstName, lastName, email, password: hashedPassword, cedula, phone, birthdate, bloodType: bloodType || null, city, department: department || null,
      nickname, clubNotifications: clubNotifications === 'true',
      emergencyName, emergencyPhone,
      vehicles,
      membership: { level: 'Básica', since: new Date().toISOString().slice(0, 10), expires: null, benefits: ['Descuentos en taller', 'Acceso al club'] },
    });
    const token = jwt.sign({ id: newUser.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 });
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

// ── Google OAuth ──────────────────────────────────────────────────────────

const GOOGLE_AUTH_URL     = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v3/userinfo';

router.get('/auth/google', (req, res) => {
  if (!GOOGLE_CLIENT_ID) return res.redirect('/club/login');
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('g_state', state, { httpOnly: true, maxAge: 600_000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: `${APP_URL}/club/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'online',
    prompt: 'select_account',
  });
  res.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
});

router.get('/auth/google/callback', authLimiter, async (req, res) => {
  const { code, state, error } = req.query;
  if (error || !code) return res.redirect('/club/login?google=denied');

  const savedState = req.cookies.g_state;
  res.clearCookie('g_state');
  if (!state || state !== savedState) return res.redirect('/club/login?google=error');

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: `${APP_URL}/club/auth/google/callback`,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw new Error('No access_token from Google');

    const profileRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profileRes.json();
    const { sub: googleId, email, given_name, family_name, picture } = profile;
    if (!googleId || !email) throw new Error('Incomplete Google profile');

    let user = await getUserByGoogleId(googleId);
    if (!user) user = await getUserByEmail(email);

    if (user) {
      if (!user.googleId) await updateUser(user.id, { googleId, avatarUrl: picture || null });
    } else {
      user = await createUser({
        firstName: given_name || email.split('@')[0],
        lastName: family_name || '',
        email,
        password: '$google$',
        googleId,
        avatarUrl: picture || null,
      });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch (e) {
    console.error('Google OAuth callback error:', e.message);
    res.redirect('/club/login?google=error');
  }
});

// ── Apple Sign In ─────────────────────────────────────────────────────────

const APPLE_AUTH_URL  = 'https://appleid.apple.com/auth/authorize';
const APPLE_TOKEN_URL = 'https://appleid.apple.com/auth/token';
const APPLE_KEYS_URL  = 'https://appleid.apple.com/auth/keys';

function getAppleClientSecret() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    { iss: APPLE_TEAM_ID, iat: now, exp: now + 15777000, aud: 'https://appleid.apple.com', sub: APPLE_CLIENT_ID },
    APPLE_PRIVATE_KEY,
    { algorithm: 'ES256', header: { alg: 'ES256', kid: APPLE_KEY_ID } },
  );
}

async function verifyAppleIdToken(idToken) {
  const { keys } = await fetch(APPLE_KEYS_URL).then(r => r.json());
  const header = JSON.parse(Buffer.from(idToken.split('.')[0], 'base64url').toString());
  const jwk = keys.find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Apple JWK not found for kid: ' + header.kid);
  const pem = require('crypto').createPublicKey({ key: jwk, format: 'jwk' }).export({ type: 'spki', format: 'pem' });
  return jwt.verify(idToken, pem, { algorithms: ['RS256'], audience: APPLE_CLIENT_ID, issuer: 'https://appleid.apple.com' });
}

router.get('/auth/apple', (req, res) => {
  if (!APPLE_CLIENT_ID) return res.redirect('/club/login');
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('a_state', state, { httpOnly: true, maxAge: 600_000, sameSite: 'lax', secure: process.env.NODE_ENV === 'production' });
  const params = new URLSearchParams({
    client_id: APPLE_CLIENT_ID,
    redirect_uri: `${APP_URL}/club/auth/apple/callback`,
    response_type: 'code id_token',
    scope: 'name email',
    state,
    response_mode: 'form_post',
  });
  res.redirect(`${APPLE_AUTH_URL}?${params.toString()}`);
});

// Apple posts to the callback (form_post)
router.post('/auth/apple/callback', authLimiter, async (req, res) => {
  const { code, id_token, state, error, user: userJson } = req.body;
  if (error || !code || !id_token) return res.redirect('/club/login?apple=denied');

  const savedState = req.cookies.a_state;
  res.clearCookie('a_state');
  if (!state || state !== savedState) return res.redirect('/club/login?apple=error');

  try {
    const payload = await verifyAppleIdToken(id_token);
    const appleId = payload.sub;
    const email   = payload.email;
    if (!appleId || !email) throw new Error('Incomplete Apple id_token payload');

    // Apple only sends user name on first login
    let firstName = '', lastName = '';
    if (userJson) {
      try {
        const parsed = typeof userJson === 'string' ? JSON.parse(userJson) : userJson;
        firstName = parsed?.name?.firstName || '';
        lastName  = parsed?.name?.lastName  || '';
      } catch { /* name not available */ }
    }

    let user = await getUserByAppleId(appleId);
    if (!user) user = await getUserByEmail(email);

    if (user) {
      if (!user.appleId) await updateUser(user.id, { appleId });
    } else {
      user = await createUser({
        firstName: firstName || email.split('@')[0],
        lastName,
        email,
        password: '$apple$',
        appleId,
      });
    }

    const token = jwt.sign({ id: user.id }, JWT_SECRET, { expiresIn: '7d' });
    res.cookie('jwt', token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', maxAge: 1000 * 60 * 60 * 24 * 7 });
    res.redirect('/club/panel');
  } catch (e) {
    console.error('Apple Sign In callback error:', e.message);
    res.redirect('/club/login?apple=error');
  }
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
  const plates = (user.vehicles || []).map(v => v.plate).filter(Boolean);
  let upcomingEvents = [], registrations = {}, quotationHistory = [], myRank = null;
  try {
    [upcomingEvents, registrations, quotationHistory, myRank] = await Promise.all([
      getUpcomingEvents(8),
      getUserEventRegistrations(user.id),
      getQuotationsByMotorcyclePlates(plates),
      getUserRank(user.id, user.score || 0),
    ]);
  } catch (e) {
    console.error('GET /club/panel data error:', e.message);
  }
  const scoreLevel = getScoreLevel(user.score || 0);
  res.render('club/dashboard', { user, reminders, upcomingEvents, registrations, scoreLevel, SCORE_POINTS, quotationHistory, myRank, noIndex: true });
});

router.post('/visitas', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId);
    const { date, service, type } = req.body;
    if (date && service && user) {
      const visitType = type || 'visita';
      const pts       = SCORE_POINTS[visitType] || SCORE_POINTS.visita;
      await updateUser(user.id, { visits: [{ date, service, type: visitType }, ...(user.visits || [])] });
      await addUserScore(user.id, pts, visitType, service);
    }
  } catch (e) { console.error('POST /club/visitas error:', e.message); }
  res.redirect('/club/panel');
});

router.post('/perfil', requireAuth, async (req, res) => {
  const user = await getUserById(req.userId);
  if (!user) return res.redirect('/club/login');
  const { firstName, lastName, nickname, phone, city, department, bloodType, emergencyName, emergencyPhone, clubNotifications } = req.body;
  if (!firstName || firstName.trim().length < 2 || firstName.trim().length > 50) {
    setFlash(res, 'error', 'El nombre debe tener entre 2 y 50 caracteres.');
    return res.redirect('/club/panel');
  }
  if (!lastName || lastName.trim().length < 2 || lastName.trim().length > 50) {
    setFlash(res, 'error', 'El apellido debe tener entre 2 y 50 caracteres.');
    return res.redirect('/club/panel');
  }
  if (phone && !/^[+\d\s\-()ñ]{7,25}$/.test(phone.trim())) {
    setFlash(res, 'error', 'El teléfono no es válido.');
    return res.redirect('/club/panel');
  }
  const name = (firstName.trim() + ' ' + lastName.trim()).trim();
  try {
    await updateUser(user.id, {
      name,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      nickname: (nickname || '').trim() || null,
      phone: (phone || '').trim() || null,
      city: (city || '').trim() || null,
      department: (department || '').trim() || null,
      bloodType: bloodType || null,
      emergencyName: (emergencyName || '').trim() || null,
      emergencyPhone: (emergencyPhone || '').trim() || null,
      clubNotifications: clubNotifications === 'true',
    });
    setFlash(res, 'success', 'Perfil actualizado.');
  } catch (e) {
    console.error('POST /club/perfil error:', e.message);
    setFlash(res, 'error', 'No se pudo actualizar el perfil.');
  }
  res.redirect('/club/panel');
});

router.post('/vehiculos', requireAuth, async (req, res) => {
  const { plate, soatExpires, tecnoExpires } = req.body;
  const plateUp = (plate || '').trim().toUpperCase();
  if (!plateUp || !/^[A-Z0-9]{3,7}$/.test(plateUp)) {
    setFlash(res, 'error', 'La placa no es válida (3–7 caracteres alfanuméricos).');
    return res.redirect('/club/panel');
  }
  try {
    const user = await getUserById(req.userId);
    if (user) {
      if ((user.vehicles || []).some(v => v.plate === plateUp)) {
        setFlash(res, 'error', `La placa ${plateUp} ya está registrada.`);
        return res.redirect('/club/panel');
      }
      const qrPayload = JSON.stringify({ t: 'vehicle', plate: plateUp, uid: user.id });
      const vehicles  = [...(user.vehicles || []), { plate: plateUp, soatExpires: soatExpires || '', tecnoExpires: tecnoExpires || '', qr: qrPayload }];
      await updateUser(user.id, { vehicles });
      setFlash(res, 'success', `Vehículo ${plateUp} agregado correctamente.`);
    }
  } catch (e) {
    console.error('POST /club/vehiculos error:', e.message);
    setFlash(res, 'error', 'No se pudo agregar el vehículo. Intenta de nuevo.');
  }
  res.redirect('/club/panel');
});

router.post('/vehiculos/eliminar', requireAuth, async (req, res) => {
  try {
    const user     = await getUserById(req.userId);
    const plate    = (req.body.plate || '').toUpperCase();
    const vehicles = (user.vehicles || []).filter(v => v.plate !== plate);
    await updateUser(user.id, { vehicles });
    setFlash(res, 'success', 'Vehículo eliminado.');
  } catch (e) {
    console.error('POST /club/vehiculos/eliminar error:', e.message);
    setFlash(res, 'error', 'No se pudo eliminar el vehículo.');
  }
  res.redirect('/club/panel');
});

router.post('/vehiculos/actualizar', requireAuth, async (req, res) => {
  try {
    const user = await getUserById(req.userId);
    const { plate, soatExpires, tecnoExpires } = req.body;
    const vehicles = (user.vehicles || []).map(v => {
      if (v.plate !== (plate || '').toUpperCase()) return v;
      return { ...v, soatExpires: soatExpires ?? v.soatExpires, tecnoExpires: tecnoExpires ?? v.tecnoExpires, qr: v.qr || JSON.stringify({ t: 'vehicle', plate: v.plate, uid: user.id }) };
    });
    await updateUser(user.id, { vehicles });
    setFlash(res, 'success', 'Vehículo actualizado.');
  } catch (e) {
    console.error('POST /club/vehiculos/actualizar error:', e.message);
    setFlash(res, 'error', 'No se pudo actualizar el vehículo.');
  }
  res.redirect('/club/panel');
});

router.post('/eventos/:id/asistencia', requireAuth, async (req, res) => {
  const eventId = req.params.id;
  const ev      = await require('../db').getEventById(eventId);
  if (!ev) return res.redirect('/eventos');
  try {
    const registered = await registerEventAttendance(eventId, req.userId);
    if (registered) setFlash(res, 'success', `Te inscribiste a: ${ev.title}`);
    else setFlash(res, 'info', 'Ya estás inscrito a este evento.');
  } catch {
    setFlash(res, 'error', 'No se pudo procesar la inscripción.');
  }
  res.redirect('/eventos');
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
