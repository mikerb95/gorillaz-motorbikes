'use strict';
// Motor del asistente: une el bucle (bucle.js) con la API de Claude, las
// herramientas, las escrituras, los topes y el registro de consumo. Solo
// servidor. Lo usan dos pantallas:
//  - la caja del panel admin (/admin), rol 'admin';
//  - la página de voz del mecánico (/taller/voz), rol 'mecanico'.
//
// Claude Sonnet 5.5 con thinking adaptativo y effort 'medium' (encadena bien
// varias herramientas sin el costo de Opus). System prompt y herramientas con
// cache_control: se pagan completos una vez y luego a precio de caché (hay
// una entrada de caché por rol, porque cada rol recibe otras herramientas).
//
// El rol se comprueba dos veces: el modelo solo recibe las herramientas del
// rol, y el servidor vuelve a mirarlo al validar, al ejecutar y al APROBAR
// (releyendo de la base a quien hace clic).

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

const TODAS = [...HERRAMIENTAS, ...ESCRITURAS];
const porNombre = new Map(TODAS.map((h) => [h.nombre, h]));
const esEscritura = new Set(ESCRITURAS.map((e) => e.nombre));

/** Qué herramientas recibe cada rol. Lo que no está aquí, el rol no lo ve ni lo puede ejecutar. */
const PERMISOS = {
  admin: [
    'resumen_ordenes', 'buscar_ordenes', 'ver_orden', 'buscar_productos', 'ver_producto',
    'listar_mecanicos', 'catalogo_servicios', 'citas_de_hoy', 'buscar_en_panel',
    'crear_orden_servicio', 'editar_items_orden', 'cambiar_estado_orden', 'asignar_orden', 'comentar_orden',
    'editar_precio_producto', 'ajustar_stock_producto',
  ],
  mecanico: [
    'resumen_ordenes', 'buscar_ordenes', 'ver_orden', 'buscar_productos',
    'listar_mecanicos', 'catalogo_servicios', 'citas_de_hoy',
    'crear_orden_servicio', 'agregar_items_orden', 'cambiar_estado_orden', 'comentar_orden',
  ],
};
const ROLES_PERMITIDOS = Object.keys(PERMISOS);

const ACCIONES = {
  crear_orden_servicio: 'crear_orden_servicio: orden nueva con sus ítems (nombre, tipo, precio, cantidad), placa, moto, teléfono, mecánico y fecha estimada.',
  editar_items_orden: 'editar_items_orden: cambiar nombre, precio o cantidad de ítems, agregar o quitar ítems de una orden sin factura.',
  agregar_items_orden: 'agregar_items_orden: sumar partes o trabajos (con el precio que diga la persona) a una orden sin factura. No cambia ni quita los que ya están.',
  cambiar_estado_orden: 'cambiar_estado_orden: ingreso a taller, trabajo en curso, en pausa o trabajo completo (genera la proforma). Nunca entregado.',
  asignar_orden: 'asignar_orden: mecánico asignado y fecha estimada.',
  comentar_orden: 'comentar_orden: comentario en la línea de tiempo de una orden.',
  editar_precio_producto: 'editar_precio_producto: precio, descuento %, descuento club % o precio de instalación de un producto de la tienda, o el precio de una variante.',
  ajustar_stock_producto: 'ajustar_stock_producto: stock exacto de un producto o variante.',
};
const accionesDe = (rol) => (PERMISOS[rol] || []).filter((n) => esEscritura.has(n)).map((n) => ACCIONES[n]);

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

function definiciones(rol = 'admin') {
  const propias = TODAS.filter((h) => (PERMISOS[rol] || []).includes(h.nombre));
  return propias.map((h, i) => ({
    name: h.nombre,
    description: h.descripcion,
    input_schema: paraApi(h.esquema),
    ...(i === propias.length - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
  }));
}

function puede(rol, nombre) {
  return !!PERMISOS[rol] && PERMISOS[rol].includes(nombre) && porNombre.has(nombre);
}

/**
 * El mecánico no entra al panel admin: los enlaces de órdenes pasan a su
 * portal y los demás enlaces del admin se quitan.
 */
function enlacesPara(rol, valor) {
  if (rol === 'admin' || valor === null || typeof valor !== 'object') return valor;
  if (Array.isArray(valor)) return valor.map((v) => enlacesPara(rol, v));
  const out = {};
  for (const [k, v] of Object.entries(valor)) {
    if (k === 'enlace' && typeof v === 'string') {
      const m = v.match(/^\/admin\/ordenes-servicio\/([\w-]+)$/);
      out[k] = m ? `/taller/orden/${m[1]}` : null;
    } else {
      out[k] = enlacesPara(rol, v);
    }
  }
  return out;
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

/**
 * Quien pregunta o decide, normalizado. El rol sale de la sesión, nunca del
 * cuerpo de la petición. Un admin es un usuario del sitio; un mecánico, un
 * empleado del taller (id con prefijo 'emp:' para no chocar con usuarios).
 */
function actorAdmin(user) {
  return { id: user.id, nombre: user.name || 'Admin', rol: user.role === 'admin' ? 'admin' : 'ninguno' };
}
function actorMecanico(emp) {
  return { id: `emp:${emp.id}`, nombre: emp.name || 'Mecánico', rol: emp.active === false ? 'ninguno' : 'mecanico', empleadoId: emp.id };
}

/** Relee al actor desde la base: el rol pudo cambiar desde que se propuso. */
async function actorActual(actor) {
  const dbm = require('../../db');
  if (actor.empleadoId) {
    const emp = await dbm.getEmployeeById(actor.empleadoId);
    return emp && emp.active ? actorMecanico(emp) : null;
  }
  const u = await dbm.getUserById(actor.id);
  return u && u.role === 'admin' ? actorAdmin(u) : null;
}

function dependencias(ctx, conversacionId, emitir) {
  const { hoyCO } = require('../datetime');
  const rol = ctx.usuario.rol;
  const system = [{ type: 'text', text: systemPrompt(hoyCO(), accionesDe(rol), rol), cache_control: { type: 'ephemeral' } }];
  const tools = definiciones(rol);
  const llamar = modeloFalsoActivo() ? require('./modelo-falso').llamar : llamadaReal(system, tools);
  return {
    herramientasAprobacion: (PERMISOS[rol] || []).filter((n) => esEscritura.has(n)),
    async llamarModelo(mensajes) {
      const msg = await llamar(mensajes);
      // Por llamada, no al final: si la función muere, lo pagado cuenta.
      await almacen
        .registrarConsumo({ usuarioId: ctx.usuario.id, conversacionId, modelo: modeloFalsoActivo() ? 'simulado' : MODELO, usage: msg.usage })
        .catch((err) => console.error('[panel-ia] no se pudo registrar el consumo:', err.message));
      return msg;
    },
    validar(nombre, entrada) {
      if (!puede(rol, nombre)) return 'Sin permiso para esa herramienta.';
      return validarEsquema(porNombre.get(nombre).esquema, entrada ?? {});
    },
    async ejecutar(nombre, entrada, extra) {
      if (!puede(rol, nombre)) return { ok: false, error: 'Sin permiso para esa herramienta.' };
      const h = porNombre.get(nombre);
      let r;
      if (esEscritura.has(nombre)) {
        // Una escritura solo llega aquí desde decidir() tras un clic en Aprobar.
        if (!extra || !extra.aprobada) return { ok: false, error: 'Las escrituras necesitan aprobación.' };
        r = await ejecutarAprobada(h, entrada, ctx, extra);
      } else {
        try {
          r = await h.ejecutar(entrada ?? {}, ctx);
        } catch (err) {
          console.error(`[panel-ia] ${nombre} falló:`, err);
          r = { ok: false, error: 'La consulta falló; intenta de nuevo o revisa el panel.' };
        }
      }
      return r.ok ? { ok: true, datos: enlacesPara(rol, r.datos) } : r;
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
async function estado(actor) {
  if (!ROLES_PERMITIDOS.includes(actor.rol)) return { disponible: false, motivo: 'sin_permiso' };
  if (!clave() && !modeloFalsoActivo()) return { disponible: false, motivo: 'sin_clave' };
  try {
    const r = modeloFalsoActivo() ? 1 : await almacen.presupuestoRestante(actor.id);
    return r > 0 ? { disponible: true } : { disponible: false, motivo: 'sin_presupuesto' };
  } catch {
    return { disponible: false, motivo: 'sin_presupuesto' };
  }
}

async function exigirDisponible(actor) {
  const s = await estado(actor);
  if (s.disponible) return;
  const mensajes = {
    sin_permiso: 'No tienes permiso para usar el asistente.',
    sin_clave: 'El asistente no tiene clave de API configurada. Por ahora no puede responder.',
    sin_presupuesto: 'Se alcanzó el tope de gasto de hoy (o no se pudo comprobar). Mañana vuelve a estar disponible.',
  };
  throw new AsistenteNoDisponible(s.motivo, mensajes[s.motivo]);
}

/**
 * Pregunta nueva (sin id) o seguimiento (con id). Con una propuesta abierta,
 * el texto cuenta como "pedir cambios": rechazo con indicación.
 */
async function preguntar({ actor, pregunta, id }, emitir) {
  await exigirDisponible(actor);
  const ctx = { usuario: actor };
  if (!id) {
    const e = nuevaEjecucion(require('crypto').randomUUID(), pregunta);
    await almacen.crear(e, actor);
    emitir({ tipo: 'conversacion', id: e.id });
    return avanzar(e, dependencias(ctx, e.id, emitir));
  }
  const previa = await almacen.obtener(id);
  if (!previa || previa.usuarioId !== actor.id) throw new AsistenteNoDisponible('no_encontrada', 'Esa conversación no existe o no es tuya.');
  if (previa.estado === 'fallida') throw new AsistenteNoDisponible('nueva', 'Esa conversación terminó con un error. Empieza una nueva.');
  if (contarTurnos(previa.mensajes) >= almacen.MAX_TURNOS) throw new AsistenteNoDisponible('nueva', 'Esta conversación ya es muy larga. Empieza una nueva para seguir.');
  const e = await almacen.reclamar(id, ['terminada', 'esperando_aprobacion'], actor.id);
  if (!e) throw new AsistenteNoDisponible('ocupada', 'La conversación está ocupada en otra pestaña. Recarga la página.');
  emitir({ tipo: 'conversacion', id: e.id });
  const deps = dependencias(ctx, e.id, emitir);
  if (previa.estado === 'esperando_aprobacion' && e.propuesta) {
    await almacen.auditar({
      conversacionId: e.id, herramienta: e.propuesta.herramienta, pidioId: e.usuarioId, decidio: actor,
      decision: 'rechazada_con_cambios', entrada: e.propuesta.entrada, vista: e.propuesta.vista, resultado: null,
    }).catch((err) => console.error('[panel-ia] auditoría:', err.message));
    return decidir(e, false, deps, pregunta);
  }
  e.mensajes.push({ role: 'user', content: pregunta });
  return avanzar(e, deps);
}

/** Aprobar o descartar la propuesta pendiente. Solo el dueño, y con su rol ACTUAL. */
async function decidirPropuesta({ actor, id, aprobado }, emitir) {
  const actual = await actorActual(actor);
  if (!actual || !ROLES_PERMITIDOS.includes(actual.rol)) throw new AsistenteNoDisponible('sin_permiso', 'Ya no tienes permiso para aprobar cambios.');
  if (aprobado) await exigirDisponible(actual);
  const e = await almacen.reclamar(id, ['esperando_aprobacion'], actual.id);
  if (!e || !e.propuesta) throw new AsistenteNoDisponible('decidida', 'Esa propuesta ya se decidió (quizás en otra pestaña).');
  const ctx = { usuario: actual };
  const propuesta = e.propuesta;
  e.decision = { aprobado, por: actual.nombre, fecha: new Date().toISOString(), herramienta: propuesta.herramienta };
  const deps = dependencias(ctx, e.id, emitir);
  // Descartar no exige presupuesto: la decisión se guarda igual y, si no
  // queda tope, el bucle termina sin volver a llamar al modelo.
  const r = await decidir(e, aprobado, deps);
  await almacen.auditar({
    conversacionId: e.id, herramienta: propuesta.herramienta, pidioId: e.usuarioId, decidio: actual,
    decision: aprobado ? 'aprobada' : 'rechazada', entrada: propuesta.entrada, vista: propuesta.vista,
    resultado: r.resultadoDecision || null,
  }).catch((err) => console.error('[panel-ia] auditoría:', err.message));
  if (aprobado && r.resultadoDecision && r.resultadoDecision.ok) {
    const { logAdminAction } = require('../../db');
    await logAdminAction(actual.id, actual.nombre, `asistente:${propuesta.herramienta}`, 'asistente', e.id, propuesta.origen).catch(() => {});
  }
  return r;
}

module.exports = {
  AsistenteNoDisponible, PERMISOS, ROLES_PERMITIDOS, ACCIONES, accionesDe,
  actorAdmin, actorMecanico, definiciones, puede, enlacesPara, estado, preguntar, decidirPropuesta, dependencias, modeloFalsoActivo,
};
