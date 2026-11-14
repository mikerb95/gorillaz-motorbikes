'use strict';
// Asistente con IA del panel admin (helpers/panel-ia). La caja vive en la
// pantalla principal (/admin). Solo administradores: el rol sale de la sesión,
// nunca del cuerpo de la petición. Las respuestas que llaman al modelo van por
// SSE; si el navegador se desconecta, la conversación termina igual en el
// servidor y queda en "Recientes".

const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const motor = require('../helpers/panel-ia/motor');
const almacen = require('../helpers/panel-ia/almacen');
const { turnosDe, sinRayas } = require('../helpers/panel-ia/turnos');
const { buscarEnMenu } = require('../helpers/panel-ia/menu');
const { fmtCOP } = require('../helpers/money');

const router = express.Router();
const guard = [requireAuth, requireAdmin];

const MAX_PREGUNTA = 1500;

// Freno a scripts o clics repetidos; el gasto lo frena el tope diario.
const preguntaLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 40,
  keyGenerator: (req) => `asistente:${req.userId || 'anon'}`,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiadas preguntas seguidas. Espera un par de minutos.' },
});

const usuarioDe = (res) => res.locals.user;

/** Abre la transmisión SSE. Si el navegador se va, `enviar` deja de escribir pero la tarea sigue. */
function abrirSse(res) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Accel-Buffering': 'no',
    Connection: 'keep-alive',
  });
  res.flushHeaders?.();
  let abierto = true;
  res.on('close', () => { abierto = false; });
  const enviar = (evento) => {
    if (!abierto) return;
    try {
      res.write(`data: ${JSON.stringify(evento)}\n\n`);
    } catch {
      abierto = false;
    }
  };
  const cerrar = () => {
    if (abierto) {
      abierto = false;
      res.end();
    }
  };
  return { enviar, cerrar };
}

async function correr(res, tarea) {
  const { enviar, cerrar } = abrirSse(res);
  try {
    await tarea(enviar);
  } catch (err) {
    if (err instanceof motor.AsistenteNoDisponible) {
      enviar({ tipo: 'error', motivo: err.motivo, mensaje: err.message });
    } else {
      console.error('[panel-ia]', err);
      enviar({ tipo: 'error', motivo: 'fallo', mensaje: 'Algo falló en el servidor. Intenta de nuevo.' });
    }
  } finally {
    cerrar();
  }
}

// Estado de la caja: ¿hay IA disponible para este admin?
router.get('/estado', guard, async (req, res) => {
  res.set('Cache-Control', 'no-store').json(await motor.estado(usuarioDe(res)));
});

router.post('/', guard, preguntaLimiter, async (req, res) => {
  const pregunta = typeof req.body.pregunta === 'string' ? req.body.pregunta.trim() : '';
  const id = typeof req.body.id === 'string' && req.body.id ? req.body.id : null;
  if (!pregunta || pregunta.length > MAX_PREGUNTA) {
    return res.status(400).json({ error: `Escribe una pregunta de máximo ${MAX_PREGUNTA} caracteres.` });
  }
  await correr(res, (enviar) => motor.preguntar({ usuario: usuarioDe(res), pregunta, id }, enviar));
});

router.post('/decision', guard, async (req, res) => {
  const id = typeof req.body.id === 'string' ? req.body.id : '';
  // Solo un `true` explícito aprueba; cualquier otra cosa descarta.
  const aprobado = req.body.aprobado === true;
  if (!id) return res.status(400).json({ error: 'Falta la conversación.' });
  await correr(res, (enviar) => motor.decidirPropuesta({ usuario: usuarioDe(res), id, aprobado }, enviar));
});

// Retomar una conversación (?c=<id>). Ajena = solo lectura.
router.get('/conversacion/:id', guard, async (req, res) => {
  const c = await almacen.obtener(req.params.id);
  if (!c) return res.status(404).json({ error: 'No encontré esa conversación.' });
  const propia = c.usuarioId === usuarioDe(res).id;
  res.set('Cache-Control', 'no-store').json({
    id: c.id,
    estado: c.estado,
    soloLectura: !propia,
    autor: c.usuarioNombre,
    turnos: turnosDe(c.mensajes),
    propuesta: c.estado === 'esperando_aprobacion' && c.propuesta
      ? { origen: c.propuesta.origen, motivo: c.propuesta.motivo, herramienta: c.propuesta.herramienta, vista: c.propuesta.vista }
      : null,
    error: c.error ? sinRayas(c.error) : null,
  });
});

router.get('/recientes', guard, async (req, res) => {
  const todas = req.query.todas === '1';
  res.set('Cache-Control', 'no-store').json({ recientes: await almacen.recientes(usuarioDe(res).id, { todas }) });
});

// Buscador SIN IA (sirve aunque falte la clave o se acabe el tope): secciones
// del menú, órdenes por placa/consecutivo y productos por nombre.
router.get('/buscar', guard, async (req, res) => {
  const q = String(req.query.q || '').trim().slice(0, 60);
  if (q.length < 2) return res.json({ resultados: [] });
  const { db } = require('../db');
  const like = `%${q.toUpperCase().replace(/\s/g, '').replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const likeNombre = `%${q.toUpperCase().replace(/[\\%_]/g, (c) => '\\' + c)}%`;
  const [ordenes, productos] = await Promise.all([
    db.execute({
      sql: `SELECT id, label, motorcycle, status, total FROM service_orders
            WHERE UPPER(REPLACE(COALESCE(motorcycle,''), ' ', '')) LIKE ? ESCAPE '\\' OR UPPER(label) LIKE ? ESCAPE '\\'
            ORDER BY created_at DESC LIMIT 5`,
      args: [like, likeNombre],
    }),
    db.execute({
      sql: `SELECT id, name, brand, price FROM products
            WHERE UPPER(name) LIKE ? ESCAPE '\\' OR UPPER(brand) LIKE ? ESCAPE '\\' OR UPPER(sku) LIKE ? ESCAPE '\\'
            ORDER BY name COLLATE NOCASE LIMIT 5`,
      args: [likeNombre, likeNombre, likeNombre],
    }),
  ]);
  const resultados = [
    ...buscarEnMenu(q, 4).map((s) => ({ tipo: 'Sección', titulo: s.etiqueta, detalle: null, enlace: s.enlace })),
    ...ordenes.rows.map((o) => ({ tipo: 'Orden', titulo: o.label, detalle: [o.motorcycle, fmtCOP(o.total)].filter(Boolean).join(' · '), enlace: `/admin/ordenes-servicio/${o.id}` })),
    ...productos.rows.map((p) => ({ tipo: 'Producto', titulo: p.name, detalle: [p.brand, fmtCOP(p.price)].filter(Boolean).join(' · '), enlace: `/admin/tienda/${p.id}/editar` })),
  ];
  res.set('Cache-Control', 'no-store').json({ resultados });
});

router.get('/consumo', guard, async (req, res) => {
  try {
    res.set('Cache-Control', 'no-store').json(await almacen.resumenConsumo(usuarioDe(res).id));
  } catch (err) {
    console.error('[panel-ia] consumo:', err.message);
    res.status(500).json({ error: 'No se pudo leer el consumo.' });
  }
});

router.post('/topes', guard, async (req, res) => {
  const r = await almacen.guardarTopes(req.body || {});
  if (!r.ok) return res.status(400).json({ error: r.error });
  const { logAdminAction } = require('../db');
  const u = usuarioDe(res);
  await logAdminAction(u.id, u.name, 'asistente:topes', 'settings', 'asistente_topes', JSON.stringify(r.topes)).catch(() => {});
  res.json(r);
});

module.exports = router;
