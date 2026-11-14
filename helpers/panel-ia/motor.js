'use strict';
// Motor del asistente del panel: une el bucle (bucle.js) con la API de Claude,
// las herramientas, las escrituras, los topes y el registro de consumo. Solo
// servidor.
//
// Claude Sonnet 5.5 con thinking adaptativo y effort 'medium' (encadena bien
// varias herramientas sin el costo de Opus). System prompt y herramientas con
// cache_control: se pagan completos una vez y luego a precio de caché.
//
// El rol se comprueba aquí dos veces: solo un admin recibe herramientas, y al
// APROBAR se vuelve a leer de la base el rol actual de quien hace clic.

const { avanzar, decidir, nuevaEjecucion } = require('./bucle');
const { MODELO } = require('./costo');
const { HERRAMIENTAS } = require('./herramientas');
const { ESCRITURAS, ejecutarAprobada } = require('./escrituras');
const { validar: validarEsquema, paraApi } = require('./esquema');
const { systemPrompt } = require('./prompt');
const { textoRechazo, contarTurnos } = require('./turnos');
const { verificarRespuesta } = require('./guardia');
const almacen = require('./almacen');

class AsistenteNoDisponible extends Error {
  constructor(motivo, mensaje) {
    super(mensaje || motivo);
    this.name = 'AsistenteNoDisponible';
    this.motivo = motivo;
  }
}

const ROLES_PERMITIDOS = ['admin'];
const TODAS = [...HERRAMIENTAS, ...ESCRITURAS];
const porNombre = new Map(TODAS.map((h) => [h.nombre, h]));
const esEscritura = new Set(ESCRITURAS.map((e) => e.nombre));

function clave() {
  return (process.env.ANTHROPIC_API_KEY || '').trim();
}

/**
 * Modelo simulado para Playwright y pruebas manuales sin gastar API. Solo se
 * respeta fuera de producción: en Vercel la variable se ignora.
 */
function modeloFalsoActivo() {
  return process.env.PANEL_IA_MODELO_FALSO === '1' && process.env.NODE_ENV !== 'production' && !process.env.VERCEL;
}

const ACCIONES = [
  'crear_orden_servicio: orden nueva con sus ítems (nombre, tipo, precio, cantidad), placa, moto, teléfono, mecánico y fecha estimada.',
  'editar_items_orden: cambiar nombre, precio o cantidad de ítems, agregar o quitar ítems de una orden sin factura.',
  'cambiar_estado_orden: ingreso a taller, trabajo en curso, en pausa o trabajo completo (genera la proforma). Nunca entregado.',
  'asignar_orden: mecánico asignado y fecha estimada.',
  'comentar_orden: comentario en la línea de tiempo de una orden.',
  'editar_precio_producto: precio, descuento %, descuento club % o precio de instalación de un producto de la tienda, o el precio de una variante.',
  'ajustar_stock_producto: stock exacto de un producto o variante.',
];

function definiciones() {
  return TODAS.map((h, i) => ({
    name: h.nombre,
    description: h.descripcion,
    input_schema: paraApi(h.esquema),
    ...(i === TODAS.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
}

function puede(rol, nombre) {
  return ROLES_PERMITIDOS.includes(rol) && porNombre.has(nombre);
}

let api = null;
function cliente() {
  if (!api) {
    const Anthropic = require('@anthropic-ai/sdk');
    api = new (Anthropic.default || Anthropic)({ apiKey: clave(), maxRetries: 1, timeout: 120_000 });
  }
  return api;
}

function llamadaReal(system, tools) {
  return (messages) =>
    cliente().beta.messages.stream({
      model: MODELO,
      max_tokens: 16000,
      system,
      tools,
      messages,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'medium' },
      // Si un clasificador de seguridad declina por error, la API reintenta
      // sola en el modelo de respaldo dentro de la misma llamada.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    }).finalMessage();
}

/** Contexto de quien pregunta o decide. El rol sale de la sesión, nunca del cuerpo. */
function contextoDe(usuario) {
  return { usuario: { id: usuario.id, nombre: usuario.name || usuario.nombre || 'Admin', rol: usuario.role || usuario.rol } };
}

function dependencias(ctx, conversacionId, emitir) {
  const { hoyCO } = require('../datetime');
  const system = [{ type: 'text', text: systemPrompt(hoyCO(), ACCIONES), cache_control: { type: 'ephemeral' } }];
  const tools = definiciones();
  const llamar = modeloFalsoActivo() ? require('./modelo-falso').llamar : llamadaReal(system, tools);
  return {
    herramientasAprobacion: [...esEscritura],
    async llamarModelo(mensajes) {
      const msg = await llamar(mensajes);
      // Por llamada, no al final: si la función muere, lo pagado cuenta.
      await almacen
        .registrarConsumo({ usuarioId: ctx.usuario.id, conversacionId, modelo: modeloFalsoActivo() ? 'simulado' : MODELO, usage: msg.usage })
        .catch((err) => console.error('[panel-ia] no se pudo registrar el consumo:', err.message));
      return msg;
    },
    validar(nombre, entrada) {
      if (!puede(ctx.usuario.rol, nombre)) return 'Sin permiso para esa herramienta.';
      return validarEsquema(porNombre.get(nombre).esquema, entrada ?? {});
    },
    async ejecutar(nombre, entrada, extra) {
      if (!puede(ctx.usuario.rol, nombre)) return { ok: false, error: 'Sin permiso para esa herramienta.' };
      const h = porNombre.get(nombre);
      if (esEscritura.has(nombre)) {
        // Una escritura solo llega aquí desde decidir() tras un clic en Aprobar.
        if (!extra || !extra.aprobada) return { ok: false, error: 'Las escrituras necesitan aprobación.' };
        return ejecutarAprobada(h, entrada, ctx, extra);
      }
      try {
        return await h.ejecutar(entrada ?? {}, ctx);
      } catch (err) {
        console.error(`[panel-ia] ${nombre} falló:`, err);
        return { ok: false, error: 'La consulta falló; intenta de nuevo o revisa el panel.' };
      }
    },
    prepararPropuesta: (nombre, entrada) => porNombre.get(nombre).preparar(entrada, ctx),
    rechazo: textoRechazo,
    verificar: verificarRespuesta,
    guardar: (e) => almacen.guardar(e),
    emitir,
    presupuestoRestante: () => (modeloFalsoActivo() ? Promise.resolve(1) : almacen.presupuestoRestante(ctx.usuario.id)),
  };
}

/** ¿Puede responder ahora? Falla cerrado. */
async function estado(usuario) {
  if (!clave() && !modeloFalsoActivo()) return { disponible: false, motivo: 'sin_clave' };
  try {
    const r = modeloFalsoActivo() ? 1 : await almacen.presupuestoRestante(usuario.id);
    return r > 0 ? { disponible: true } : { disponible: false, motivo: 'sin_presupuesto' };
  } catch {
    return { disponible: false, motivo: 'sin_presupuesto' };
  }
}

async function exigirDisponible(usuario) {
  if (!ROLES_PERMITIDOS.includes(usuario.role)) throw new AsistenteNoDisponible('sin_permiso', 'Solo los administradores pueden usar el asistente.');
  const s = await estado(usuario);
  if (!s.disponible) {
    throw new AsistenteNoDisponible(s.motivo, s.motivo === 'sin_clave'
      ? 'El asistente no tiene clave de API configurada. Por ahora la caja solo busca.'
      : 'Se alcanzó el tope de gasto de hoy (o no se pudo comprobar). Mañana vuelve a estar disponible.');
  }
}

/**
 * Pregunta nueva (sin id) o seguimiento (con id). Con una propuesta abierta,
 * el texto cuenta como "pedir cambios": rechazo con indicación.
 */
async function preguntar({ usuario, pregunta, id }, emitir) {
  await exigirDisponible(usuario);
  const ctx = contextoDe(usuario);
  if (!id) {
    const e = nuevaEjecucion(require('crypto').randomUUID(), pregunta);
    await almacen.crear(e, ctx.usuario);
    emitir({ tipo: 'conversacion', id: e.id });
    return avanzar(e, dependencias(ctx, e.id, emitir));
  }
  const previa = await almacen.obtener(id);
  if (!previa || previa.usuarioId !== usuario.id) throw new AsistenteNoDisponible('no_encontrada', 'Esa conversación no existe o no es tuya.');
  if (previa.estado === 'fallida') throw new AsistenteNoDisponible('nueva', 'Esa conversación terminó con un error. Empieza una nueva.');
  if (contarTurnos(previa.mensajes) >= almacen.MAX_TURNOS) throw new AsistenteNoDisponible('nueva', 'Esta conversación ya es muy larga. Empieza una nueva para seguir.');
  const e = await almacen.reclamar(id, ['terminada', 'esperando_aprobacion'], usuario.id);
  if (!e) throw new AsistenteNoDisponible('ocupada', 'La conversación está ocupada en otra pestaña. Recarga la página.');
  emitir({ tipo: 'conversacion', id: e.id });
  const deps = dependencias(ctx, e.id, emitir);
  if (previa.estado === 'esperando_aprobacion' && e.propuesta) {
    await almacen.auditar({
      conversacionId: e.id, herramienta: e.propuesta.herramienta, pidioId: e.usuarioId, decidio: ctx.usuario,
      decision: 'rechazada_con_cambios', entrada: e.propuesta.entrada, vista: e.propuesta.vista, resultado: null,
    }).catch((err) => console.error('[panel-ia] auditoría:', err.message));
    return decidir(e, false, deps, pregunta);
  }
  e.mensajes.push({ role: 'user', content: pregunta });
  return avanzar(e, deps);
}

/** Aprobar o descartar la propuesta pendiente. Solo el dueño, y con su rol ACTUAL. */
async function decidirPropuesta({ usuario, id, aprobado }, emitir) {
  const { getUserById } = require('../../db');
  const actual = await getUserById(usuario.id);
  if (!actual || !ROLES_PERMITIDOS.includes(actual.role)) throw new AsistenteNoDisponible('sin_permiso', 'Ya no tienes permiso para aprobar cambios.');
  if (aprobado) await exigirDisponible(actual);
  const e = await almacen.reclamar(id, ['esperando_aprobacion'], actual.id);
  if (!e || !e.propuesta) throw new AsistenteNoDisponible('decidida', 'Esa propuesta ya se decidió (quizás en otra pestaña).');
  const ctx = contextoDe(actual);
  const propuesta = e.propuesta;
  e.decision = { aprobado, por: ctx.usuario.nombre, fecha: new Date().toISOString(), herramienta: propuesta.herramienta };
  const deps = dependencias(ctx, e.id, emitir);
  // Descartar no exige presupuesto: la decisión se guarda igual y, si no
  // queda tope, el bucle termina sin volver a llamar al modelo.
  const r = await decidir(e, aprobado, deps);
  await almacen.auditar({
    conversacionId: e.id, herramienta: propuesta.herramienta, pidioId: e.usuarioId, decidio: ctx.usuario,
    decision: aprobado ? 'aprobada' : 'rechazada', entrada: propuesta.entrada, vista: propuesta.vista,
    resultado: r.resultadoDecision || null,
  }).catch((err) => console.error('[panel-ia] auditoría:', err.message));
  if (aprobado && r.resultadoDecision && r.resultadoDecision.ok) {
    const { logAdminAction } = require('../../db');
    await logAdminAction(ctx.usuario.id, ctx.usuario.nombre, `asistente:${propuesta.herramienta}`, 'asistente', e.id, propuesta.origen).catch(() => {});
  }
  return r;
}

module.exports = {
  AsistenteNoDisponible, ACCIONES, ROLES_PERMITIDOS,
  definiciones, puede, estado, preguntar, decidirPropuesta, dependencias, modeloFalsoActivo,
};
