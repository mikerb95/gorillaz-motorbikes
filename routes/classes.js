'use strict';
const express     = require('express');
const rateLimit   = require('express-rate-limit');
const QRCode      = require('qrcode');
const { classes: classesData } = require('../helpers/content');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const {
  createPresentationSession,
  getPresentationSession,
  setPresentationSlideIndex,
  isThrottleLocked,
  recordThrottleFailure,
} = require('../db');

const router = express.Router();
const BASE_URL = process.env.BASE_URL || 'https://gorillazmotorbikes.com';
const CODE_RE = /^\d{6}$/;

// Genera una sesión al abrir la presentación en el PC (poco frecuente: una vez
// por sesión de clase, no por slide).
const startLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// El celular manda un tap por slide como mucho cada pocos segundos.
const navLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

// El PC hace polling cada ~1s mientras dura la presentación.
const pollLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
});

// Código de 6 dígitos: poca entropía, así que se frena el adivinado con un
// throttle global persistido (mismo mecanismo que el PIN del taller/liquidador).
const JOIN_THROTTLE_KEY = 'presentation_control_join';
const JOIN_THROTTLE_LIMIT = 30;
const JOIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;

router.get('/clases/:course/:topic', requireAuth, requireAdmin, (req, res) => {
  const { course, topic } = req.params;
  const courseObj = classesData[course];
  if (!courseObj) return res.status(404).render('404');
  const topicObj = (courseObj.topics || {})[topic];
  if (!topicObj) return res.status(404).render('404');
  res.render('classes/presentation', { courseKey: course, courseTitle: courseObj.title, topicKey: topic, topicTitle: topicObj.title, slides: topicObj.slides || [], bodyClass: 'is-presentation' });
});

// El PC arranca una sesión de control remoto para la presentación que tiene abierta.
router.post('/clases/:course/:topic/control/iniciar', startLimiter, async (req, res) => {
  const { course, topic } = req.params;
  const courseObj = classesData[course];
  const topicObj = courseObj && (courseObj.topics || {})[topic];
  if (!topicObj) return res.status(404).json({ ok: false, error: 'Tema no encontrado' });
  const slideCount = (topicObj.slides || []).length || 1;
  const code = await createPresentationSession(course, topic, slideCount);
  res.json({ ok: true, code, joinUrl: `${BASE_URL}/control/${code}` });
});

// QR para escanear desde el celular y aterrizar directo en /control/:code.
router.get('/clases/control/:code/qr.png', startLimiter, async (req, res) => {
  const { code } = req.params;
  if (!CODE_RE.test(code)) return res.status(400).end();
  const png = await QRCode.toBuffer(`${BASE_URL}/control/${code}`, { type: 'png', errorCorrectionLevel: 'M', width: 320, margin: 1 });
  res.setHeader('Content-Type', 'image/png');
  res.setHeader('Cache-Control', 'no-store');
  res.send(png);
});

// Formulario de ingreso manual del código (celular).
router.get('/control', navLimiter, async (req, res) => {
  const codeQS = String(req.query.code || '').trim();
  if (!CODE_RE.test(codeQS)) {
    return res.render('control-join', { error: codeQS ? 'El código debe tener 6 dígitos.' : null });
  }
  if (await isThrottleLocked(JOIN_THROTTLE_KEY, JOIN_THROTTLE_LIMIT, JOIN_THROTTLE_WINDOW_MS)) {
    return res.render('control-join', { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
  }
  const session = await getPresentationSession(codeQS);
  if (!session) {
    await recordThrottleFailure(JOIN_THROTTLE_KEY, JOIN_THROTTLE_WINDOW_MS);
    return res.render('control-join', { error: 'Código inválido o expirado.' });
  }
  res.redirect(`/control/${codeQS}`);
});

// Pantalla de control (celular): botones grandes de atrás/siguiente.
router.get('/control/:code', navLimiter, async (req, res) => {
  const { code } = req.params;
  if (!CODE_RE.test(code)) return res.render('control-join', { error: 'El código debe tener 6 dígitos.' });
  if (await isThrottleLocked(JOIN_THROTTLE_KEY, JOIN_THROTTLE_LIMIT, JOIN_THROTTLE_WINDOW_MS)) {
    return res.render('control-join', { error: 'Demasiados intentos. Espera unos minutos e inténtalo de nuevo.' });
  }
  const session = await getPresentationSession(code);
  if (!session) {
    await recordThrottleFailure(JOIN_THROTTLE_KEY, JOIN_THROTTLE_WINDOW_MS);
    return res.render('control-join', { error: 'Código inválido o expirado.' });
  }
  const courseObj = classesData[session.course];
  const topicObj = courseObj && (courseObj.topics || {})[session.topic];
  res.render('classes/control', {
    code,
    courseTitle: courseObj ? courseObj.title : '',
    topicTitle: topicObj ? topicObj.title : '',
    slideIndex: session.slideIndex,
    slideCount: session.slideCount,
    bodyClass: 'is-presentation',
  });
});

// El celular envía el comando; el servidor manda en el índice compartido.
router.post('/api/presentacion/:code/nav', navLimiter, async (req, res) => {
  const { code } = req.params;
  const dir = req.body && Number(req.body.dir) === -1 ? -1 : 1;
  if (!CODE_RE.test(code)) return res.status(400).json({ ok: false, error: 'Código inválido' });
  const session = await getPresentationSession(code);
  if (!session) return res.status(404).json({ ok: false, error: 'Sesión expirada' });
  const result = await setPresentationSlideIndex(code, session.slideIndex + dir);
  if (!result) return res.status(404).json({ ok: false, error: 'Sesión expirada' });
  res.json({ ok: true, index: result.slideIndex, total: result.slideCount });
});

// El celular también puede fijar un índice absoluto (usado al recibir el estado
// actual al cargar la pantalla de control por primera vez no aplica; solo lo usa
// el PC para reflejar sus propios clics/teclado en la sesión compartida).
router.post('/api/presentacion/:code/set', navLimiter, async (req, res) => {
  const { code } = req.params;
  const index = Number(req.body && req.body.index);
  if (!CODE_RE.test(code) || !Number.isFinite(index)) return res.status(400).json({ ok: false, error: 'Datos inválidos' });
  const result = await setPresentationSlideIndex(code, index);
  if (!result) return res.status(404).json({ ok: false, error: 'Sesión expirada' });
  res.json({ ok: true, index: result.slideIndex, total: result.slideCount });
});

// El PC hace polling de esto para detectar cambios hechos desde el celular.
router.get('/api/presentacion/:code/estado', pollLimiter, async (req, res) => {
  const { code } = req.params;
  if (!CODE_RE.test(code)) return res.status(400).json({ ok: false, error: 'Código inválido' });
  const session = await getPresentationSession(code);
  if (!session) return res.status(404).json({ ok: false, error: 'Sesión expirada' });
  res.json({ ok: true, index: session.slideIndex, total: session.slideCount });
});

module.exports = router;
