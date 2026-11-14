'use strict';
// Persistencia del asistente del panel: conversaciones, consumo, topes y
// auditoría. Todo contra la base del sitio (Turso / libSQL).
//
//  - Conversación = estado del bucle. `reclamar` es atómico (UPDATE ... WHERE
//    estado IN (...) RETURNING): dos clics o dos pestañas no avanzan ni
//    deciden la misma conversación.
//  - Consumo: una fila por llamada al modelo, registrada al momento (si la
//    función muere a mitad, lo pagado cuenta igual). El gasto del día sale de
//    SUM(costo_usd) por día de Bogotá: una sola fuente para el tope.
//  - Topes: app_settings('asistente_topes'), editables por un admin.
//    FALLAN CERRADO: si no se puede leer el gasto, no se llama al modelo.

const { costoUsd, usoDe } = require('./costo');

const dbc = () => require('../../db').db;

const RETENCION_DIAS = 30;
const MAX_TURNOS = 12;
const TOPES_POR_DEFECTO = Object.freeze({ empresaUsd: 2, usuarioUsd: 1 });
const TOPE_MAXIMO_USD = 50;
const CLAVE_TOPES = 'asistente_topes';

const ahora = () => new Date().toISOString();
const hoyBogota = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(d);
const safeJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };

// ── Conversaciones ─────────────────────────────────────────────────────────

function deFila(r) {
  if (!r) return null;
  return {
    id: r.id,
    usuarioId: r.usuario_id,
    usuarioNombre: r.usuario_nombre,
    estado: r.estado,
    pregunta: r.pregunta,
    mensajes: safeJson(r.mensajes, []),
    propuesta: safeJson(r.propuesta, null),
    decision: safeJson(r.decision, null),
    respuesta: r.respuesta,
    error: r.error,
    iteraciones: Number(r.iteraciones) || 0,
    uso: {
      entrada: Number(r.tokens_entrada) || 0,
      salida: Number(r.tokens_salida) || 0,
      cacheLectura: Number(r.tokens_cache_lectura) || 0,
      cacheEscritura: Number(r.tokens_cache_escritura) || 0,
    },
    costoUsd: Number(r.costo_usd) || 0,
    creada: r.creada,
    actualizada: r.actualizada,
  };
}

async function crear(e, usuario) {
  const t = ahora();
  await dbc().execute({
    sql: `INSERT INTO asistente_conversaciones (id, usuario_id, usuario_nombre, estado, pregunta, mensajes, creada, actualizada)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [e.id, usuario.id, usuario.nombre || '', e.estado, e.pregunta.slice(0, 500), JSON.stringify(e.mensajes), t, t],
  });
}

async function guardar(e) {
  await dbc().execute({
    sql: `UPDATE asistente_conversaciones SET estado = ?, mensajes = ?, propuesta = ?, decision = ?, respuesta = ?, error = ?,
            iteraciones = ?, tokens_entrada = ?, tokens_salida = ?, tokens_cache_lectura = ?, tokens_cache_escritura = ?,
            costo_usd = ?, actualizada = ?
          WHERE id = ?`,
    args: [
      e.estado, JSON.stringify(e.mensajes), e.propuesta ? JSON.stringify(e.propuesta) : null,
      e.decision ? JSON.stringify(e.decision) : null, e.respuesta || null, e.error || null,
      e.iteraciones, e.uso.entrada, e.uso.salida, e.uso.cacheLectura, e.uso.cacheEscritura,
      e.costoUsd, ahora(), e.id,
    ],
  });
}

async function obtener(id) {
  const r = await dbc().execute({ sql: 'SELECT * FROM asistente_conversaciones WHERE id = ?', args: [id] });
  return deFila(r.rows[0]);
}

/**
 * Pasa la conversación a 'corriendo' solo si está en uno de los estados
 * `desde` y es de `usuarioId`. Devuelve la conversación o null si otra
 * petición se adelantó (o no es suya).
 */
async function reclamar(id, desde, usuarioId) {
  const r = await dbc().execute({
    sql: `UPDATE asistente_conversaciones SET estado = 'corriendo', actualizada = ?
          WHERE id = ? AND usuario_id = ? AND estado IN (${desde.map(() => '?').join(',')})
          RETURNING *`,
    args: [ahora(), id, usuarioId, ...desde],
  });
  return deFila(r.rows[0]);
}

/** Últimas conversaciones: las del usuario, o de todos los admins con `todas`. */
async function recientes(usuarioId, { todas = false, limite = 8 } = {}) {
  const r = await dbc().execute({
    sql: `SELECT id, usuario_id, usuario_nombre, estado, pregunta, actualizada FROM asistente_conversaciones
          ${todas ? '' : 'WHERE usuario_id = ?'} ORDER BY actualizada DESC LIMIT ?`,
    args: todas ? [limite] : [usuarioId, limite],
  });
  return r.rows.map((c) => ({
    id: c.id,
    pregunta: c.pregunta,
    estado: c.estado,
    usuarioId: c.usuario_id,
    usuarioNombre: c.usuario_nombre,
    actualizada: c.actualizada,
  }));
}

/** Retención: conversaciones de más de N días. Consumo y auditoría se quedan. */
async function purgarViejas(dias = RETENCION_DIAS) {
  const limite = new Date(Date.now() - dias * 86400000).toISOString();
  const r = await dbc().execute({ sql: 'DELETE FROM asistente_conversaciones WHERE actualizada < ?', args: [limite] });
  return r.rowsAffected ?? 0;
}

// ── Consumo y topes ──────────────────────────────────────────────────────

async function registrarConsumo({ usuarioId, conversacionId, modelo, usage }) {
  const u = usoDe(usage);
  const d = new Date();
  await dbc().execute({
    sql: `INSERT INTO asistente_consumo (fecha, dia, usuario_id, conversacion_id, modelo, tokens_entrada, tokens_salida,
            tokens_cache_lectura, tokens_cache_escritura, costo_usd) VALUES (?,?,?,?,?,?,?,?,?,?)`,
    args: [d.toISOString(), hoyBogota(d), usuarioId, conversacionId, modelo, u.entrada, u.salida, u.cacheLectura, u.cacheEscritura, costoUsd(u)],
  });
}

function leerTopes() {
  const crudo = require('../settings').get(CLAVE_TOPES);
  const n = (v, d) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Math.min(Number(v), TOPE_MAXIMO_USD) : d);
  return {
    empresaUsd: n(crudo && crudo.empresaUsd, TOPES_POR_DEFECTO.empresaUsd),
    usuarioUsd: n(crudo && crudo.usuarioUsd, TOPES_POR_DEFECTO.usuarioUsd),
  };
}

/** Valida y guarda los topes. Devuelve { ok, topes } o { ok: false, error }. */
async function guardarTopes(entrada) {
  const e = Number(entrada.empresaUsd);
  const u = Number(entrada.usuarioUsd);
  if (!Number.isFinite(e) || !Number.isFinite(u) || e < 0 || u < 0 || e > TOPE_MAXIMO_USD || u > TOPE_MAXIMO_USD) {
    return { ok: false, error: `Los topes van entre 0 y ${TOPE_MAXIMO_USD} USD.` };
  }
  const topes = { empresaUsd: Math.round(e * 100) / 100, usuarioUsd: Math.round(u * 100) / 100 };
  await require('../settings').set(CLAVE_TOPES, topes);
  return { ok: true, topes };
}

/** Gasto de hoy (Bogotá): total y del usuario. Lanza si la base no contesta. */
async function gastoDeHoy(usuarioId) {
  const r = await dbc().execute({
    sql: `SELECT COALESCE(SUM(costo_usd), 0) AS total,
                 COALESCE(SUM(CASE WHEN usuario_id = ? THEN costo_usd ELSE 0 END), 0) AS usuario
          FROM asistente_consumo WHERE dia = ?`,
    args: [usuarioId, hoyBogota()],
  });
  return { total: Number(r.rows[0].total) || 0, usuario: Number(r.rows[0].usuario) || 0 };
}

/** USD que quedan hoy para este usuario: mínimo entre el de empresa y el suyo. Lanza si no se puede saber. */
async function presupuestoRestante(usuarioId) {
  const topes = leerTopes();
  const g = await gastoDeHoy(usuarioId);
  return Math.min(topes.empresaUsd - g.total, topes.usuarioUsd - g.usuario);
}

/** Resumen para el panel: topes, gasto de hoy y del mes por usuario. */
async function resumenConsumo(usuarioId) {
  const db = dbc();
  const mes = hoyBogota().slice(0, 7);
  const [hoy, porUsuario] = await Promise.all([
    gastoDeHoy(usuarioId),
    db.execute({
      sql: `SELECT c.usuario_id,
                   (SELECT COALESCE(u.name, '') FROM users u WHERE u.id = c.usuario_id) AS nombre,
                   COUNT(*) AS llamadas, COUNT(DISTINCT c.conversacion_id) AS conversaciones, SUM(c.costo_usd) AS usd
            FROM asistente_consumo c
            WHERE c.dia LIKE ? GROUP BY c.usuario_id ORDER BY usd DESC`,
      args: [`${mes}%`],
    }),
  ]);
  return {
    topes: leerTopes(),
    hoy,
    mes,
    porUsuario: porUsuario.rows.map((r) => ({
      usuarioId: r.usuario_id,
      nombre: r.nombre,
      llamadas: Number(r.llamadas),
      conversaciones: Number(r.conversaciones),
      usd: Number(r.usd) || 0,
    })),
  };
}

// ── Auditoría ────────────────────────────────────────────────────────────

async function auditar({ conversacionId, herramienta, pidioId, decidio, decision, entrada, vista, resultado }) {
  await dbc().execute({
    sql: `INSERT INTO asistente_auditoria (fecha, conversacion_id, herramienta, pidio_usuario_id, decidio_usuario_id, decidio_nombre,
            decision, entrada, vista, resultado, ok) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      ahora(), conversacionId, herramienta, pidioId, decidio.id, decidio.nombre || '', decision,
      JSON.stringify(entrada ?? null), vista ? JSON.stringify(vista) : null,
      resultado ? JSON.stringify(resultado) : null, resultado && resultado.ok ? 1 : 0,
    ],
  });
}

module.exports = {
  RETENCION_DIAS, MAX_TURNOS, TOPES_POR_DEFECTO, TOPE_MAXIMO_USD,
  hoyBogota, crear, guardar, obtener, reclamar, recientes, purgarViejas,
  registrarConsumo, leerTopes, guardarTopes, gastoDeHoy, presupuestoRestante, resumenConsumo,
  auditar,
};
