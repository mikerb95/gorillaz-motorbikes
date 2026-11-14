'use strict';
// Bucle del asistente del panel: habla con la API de Claude, ejecuta las
// herramientas de lectura y, cuando el modelo propone una escritura, SE PAUSA.
//
// Por qué un bucle propio y no el Tool Runner del SDK: el runner corre el
// agente de un tirón, y aquí una propuesta puede esperar el clic de una
// persona durante horas. Una función serverless no puede quedarse esperando,
// así que la conversación se guarda (estado `esperando_aprobacion`), la
// función termina, y `decidir()` la retoma en otra petición con el
// `tool_result` que falta.
//
// Reglas de la API que este bucle respeta:
//  - Historial solo por anexión: el `content` de cada respuesta se guarda tal
//    cual (bloques de thinking incluidos). Editar turnos previos invalida el
//    thinking.
//  - Nunca se ejecutan herramientas de un turno cortado (`max_tokens`,
//    `refusal`): su entrada puede estar truncada.
//  - Los tool_result vuelven en el orden de los tool_use del turno.
//
// Guardia de cifras: la respuesta final no puede traer montos de dinero que no
// salgan de una herramienta o de lo que escribió la persona. Si los trae, el
// modelo la rehace una vez; si insiste, se retira y queda el texto de respaldo.
//
// Módulo sin BD ni red: todo lo externo llega por `deps`, para probar cada
// rama con un modelo falso. Adaptado de la skill panel-ia (assets/bucle.ts).

const { costoUsd, sumarUso, USO_CERO } = require('./costo');
const { PREFIJO_GUARDIA, PREFIJO_BLOQUEO, RESPALDO, sinRayas } = require('./turnos');

const MAX_ITERACIONES = 12;

function nuevaEjecucion(id, pregunta) {
  return {
    id,
    estado: 'corriendo',
    pregunta,
    mensajes: [{ role: 'user', content: pregunta }],
    propuesta: null,
    respuesta: null,
    error: null,
    iteraciones: 0,
    uso: { ...USO_CERO },
    costoUsd: 0,
  };
}

const aResultado = (toolUseId, r) =>
  r.ok
    ? { type: 'tool_result', tool_use_id: toolUseId, content: JSON.stringify(r.datos) }
    : { type: 'tool_result', tool_use_id: toolUseId, content: r.error, is_error: true };

const enOrden = (orden, resultados) =>
  orden.map((id) => resultados.find((r) => r.tool_use_id === id)).filter(Boolean);

async function terminar(e, deps, estado, error) {
  e.estado = estado;
  e.error = error;
  e.propuesta = null;
  await deps.guardar(e);
  deps.emitir({ tipo: 'fin', estado, iteraciones: e.iteraciones, costoUsd: e.costoUsd, error, respuesta: e.respuesta });
  return e;
}

const mensajeError = (err) => (err instanceof Error ? err.message : String(err));

/** Hace avanzar una ejecución `corriendo` hasta que termina, falla o se pausa. Nunca lanza. */
async function avanzar(e, deps) {
  let reintentosGuardia = 0;
  let pasos = 0;
  while (true) {
    if (pasos >= MAX_ITERACIONES) {
      return terminar(e, deps, 'fallida', `Se superó el máximo de ${MAX_ITERACIONES} pasos para una pregunta.`);
    }
    let restante;
    try {
      restante = await deps.presupuestoRestante();
    } catch {
      return terminar(e, deps, 'fallida', 'No se pudo comprobar el gasto del día; por seguridad no se sigue gastando.');
    }
    if (!(restante > 0)) return terminar(e, deps, 'fallida', 'Se alcanzó el tope de gasto de hoy. Mañana vuelve a estar disponible.');

    let msg;
    try {
      msg = await deps.llamarModelo(e.mensajes);
    } catch (err) {
      return terminar(e, deps, 'fallida', `La API de Claude falló: ${mensajeError(err)}`);
    }
    pasos++;
    e.iteraciones++;
    e.uso = sumarUso(e.uso, msg.usage);
    e.costoUsd = costoUsd(e.uso);
    e.mensajes.push({ role: 'assistant', content: msg.content });

    const textos = msg.content.filter((b) => b.type === 'text' && b.text && b.text.trim()).map((b) => b.text.trim());

    switch (msg.stop_reason) {
      case 'end_turn':
      case 'stop_sequence': {
        const respuesta = textos.join('\n\n');
        const revision = deps.verificar ? deps.verificar(respuesta, e.mensajes) : { ok: true, inventadas: [] };
        if (!revision.ok) {
          if (reintentosGuardia < 1) {
            reintentosGuardia++;
            const lista = revision.inventadas.map((c) => c.texto).join(', ');
            e.mensajes.push({
              role: 'user',
              content: [{ type: 'text', text: `${PREFIJO_GUARDIA}Tu respuesta trae cifras de dinero que no salen de ninguna herramienta ni de lo que escribió la persona: ${lista}. Rehaz la respuesta citando solo cifras que traigan las herramientas, o di que ese dato no lo tienes.` }],
            });
            await deps.guardar(e);
            continue;
          }
          e.mensajes.push({ role: 'user', content: [{ type: 'text', text: `${PREFIJO_BLOQUEO}La respuesta anterior se retiró por cifras sin respaldo.` }] });
          e.respuesta = RESPALDO;
          deps.emitir({ tipo: 'texto', texto: RESPALDO });
          return terminar(e, deps, 'terminada', null);
        }
        e.respuesta = sinRayas(respuesta) || null;
        if (e.respuesta) deps.emitir({ tipo: 'texto', texto: e.respuesta });
        return terminar(e, deps, 'terminada', null);
      }
      case 'pause_turn':
        await deps.guardar(e);
        continue;
      case 'refusal':
        return terminar(e, deps, 'fallida', 'El modelo declinó continuar con esa petición.');
      case 'max_tokens':
        return terminar(e, deps, 'fallida', 'La respuesta del modelo se cortó por longitud.');
      case 'tool_use':
        break;
      default:
        return terminar(e, deps, 'fallida', `El modelo se detuvo de forma inesperada (${msg.stop_reason}).`);
    }

    // Texto que acompaña a las herramientas ("Busco la orden..."): se muestra
    // como avance, sin cifras de dinero que la guardia no haya visto.
    for (const t of textos) {
      if (!deps.verificar || deps.verificar(t, e.mensajes).ok) deps.emitir({ tipo: 'avance', texto: sinRayas(t) });
    }

    const usos = msg.content.filter((b) => b.type === 'tool_use');
    if (!usos.length) return terminar(e, deps, 'fallida', 'El modelo pidió herramientas sin nombrar ninguna.');

    const aprobacion = new Set(deps.herramientasAprobacion);
    const resultados = [];
    let propuesta = null;
    for (const uso of usos) {
      const invalida = deps.validar(uso.name, uso.input);
      if (invalida) {
        resultados.push(aResultado(uso.id, { ok: false, error: invalida }));
        continue;
      }
      if (aprobacion.has(uso.name)) {
        if (propuesta) {
          resultados.push(aResultado(uso.id, { ok: false, error: 'Propón un cambio a la vez y espera la decisión.' }));
          continue;
        }
        let preparada;
        try {
          preparada = await deps.prepararPropuesta(uso.name, uso.input);
        } catch (err) {
          preparada = { ok: false, error: `No se pudo preparar la propuesta: ${mensajeError(err)}` };
        }
        if (!preparada.ok) {
          resultados.push(aResultado(uso.id, { ok: false, error: preparada.error }));
          continue;
        }
        propuesta = {
          toolUseId: uso.id,
          herramienta: uso.name,
          origen: preparada.origen,
          motivo: preparada.motivo,
          vista: preparada.vista,
          entrada: uso.input,
          resultadosPrevios: [],
          orden: usos.map((u) => u.id),
        };
        continue;
      }
      deps.emitir({ tipo: 'paso', id: uso.id, herramienta: uso.name, entrada: uso.input || {} });
      let r;
      try {
        r = await deps.ejecutar(uso.name, uso.input, { toolUseId: uso.id });
      } catch (err) {
        r = { ok: false, error: `La herramienta falló: ${mensajeError(err)}` };
      }
      resultados.push(aResultado(uso.id, r));
    }

    if (propuesta) {
      propuesta.resultadosPrevios = resultados;
      e.propuesta = propuesta;
      e.estado = 'esperando_aprobacion';
      await deps.guardar(e);
      deps.emitir({
        tipo: 'aprobacion',
        origen: propuesta.origen,
        motivo: propuesta.motivo,
        herramienta: propuesta.herramienta,
        vista: propuesta.vista,
      });
      return e;
    }

    e.mensajes.push({ role: 'user', content: enOrden(usos.map((u) => u.id), resultados) });
    await deps.guardar(e);
  }
}

/**
 * Aplica la decisión sobre la propuesta pendiente y retoma. Quien llama debe
 * haber reclamado la conversación de forma atómica (dos clics no la deciden
 * dos veces) y comprobado el rol ACTUAL de quien decide.
 * `comentario` = la persona escribió otra cosa con la tarjeta abierta.
 * Devuelve la ejecución; `e.resultadoDecision` trae lo que pasó al ejecutar.
 */
async function decidir(e, aprobado, deps, comentario = null) {
  const p = e.propuesta;
  if (!p) throw new Error('La conversación no tiene ninguna propuesta pendiente.');

  let resultado;
  let r = null;
  if (aprobado) {
    try {
      r = await deps.ejecutar(p.herramienta, p.entrada, { toolUseId: p.toolUseId, aprobada: true });
    } catch (err) {
      r = { ok: false, error: `No se pudo guardar: ${mensajeError(err)}` };
    }
    resultado = aResultado(p.toolUseId, r);
  } else {
    resultado = aResultado(p.toolUseId, { ok: false, error: deps.rechazo(comentario) });
  }
  e.resultadoDecision = r;
  deps.emitir({ tipo: 'decision', origen: p.origen, aprobado, herramienta: p.herramienta, ok: r ? r.ok : null, error: r && !r.ok ? r.error : null });

  e.mensajes.push({ role: 'user', content: enOrden(p.orden, [...p.resultadosPrevios, resultado]) });
  e.propuesta = null;
  e.estado = 'corriendo';
  await deps.guardar(e);
  return avanzar(e, deps);
}

module.exports = { MAX_ITERACIONES, nuevaEjecucion, avanzar, decidir };
