'use strict';
// Motor del asesor con IA: conecta el bucle (bucle.js) con la API de Claude y
// el tope diario. Solo servidor.
//
// Haiku 4.5: respuestas cortas a dudas de clientes, con los precios fuera del
// modelo, no necesitan más, y un endpoint público conviene que cueste lo
// mínimo por pregunta.
//
// Sin transmisión palabra a palabra: la guardia de cifras revisa la respuesta
// COMPLETA antes de mostrarla, así que transmitirla enseñaría justo lo que la
// guardia podría rechazar. El efecto de "escribiendo" lo hace el navegador.

const { atender } = require('./bucle');
const { costoUsd, MODELO } = require('./costo');
const { fuentesDelSitio } = require('./conocimiento');
const { definiciones } = require('./herramientas');
const { presupuestoRestante, sumarGasto } = require('./presupuesto');
const { systemPrompt } = require('./prompt');

class AsesorNoDisponible extends Error {
  constructor(motivo) {
    super(motivo);
    this.name = 'AsesorNoDisponible';
  }
}

function clave() {
  return (process.env.ANTHROPIC_API_KEY || '').trim();
}

/** ¿Puede responder ahora? Falla cerrado: si la base no contesta, no. */
async function disponible() {
  if (!clave()) return false;
  try {
    return (await presupuestoRestante()) > 0;
  } catch {
    return false;
  }
}

let api = null;
function cliente() {
  if (!api) {
    const Anthropic = require('@anthropic-ai/sdk');
    // Dos reintentos del SDK por defecto multiplicarían la espera de alguien
    // que está mirando el chat; uno basta, y con 25 s de tope por llamada.
    api = new (Anthropic.default || Anthropic)({ apiKey: clave(), maxRetries: 1, timeout: 25_000 });
  }
  return api;
}

async function responder(e) {
  if (!clave()) throw new AsesorNoDisponible('sin_clave');
  let restante = 0;
  try {
    restante = await presupuestoRestante();
  } catch {
    restante = 0;
  }
  if (restante <= 0) throw new AsesorNoDisponible('sin_presupuesto');

  const fuentes = fuentesDelSitio();
  const tools = definiciones().map((d, i, todas) =>
    i === todas.length - 1 ? { ...d, cache_control: { type: 'ephemeral' } } : d
  );
  const system = [{ type: 'text', text: systemPrompt(fuentes, e.pagina), cache_control: { type: 'ephemeral' } }];

  const r = await atender(e, fuentes, {
    llamarModelo: (messages) =>
      cliente().messages.create({
        model: MODELO,
        // Respuestas de 2 a 5 frases; el techo evita que una respuesta
        // desbocada cueste diez veces lo normal.
        max_tokens: 700,
        system,
        tools,
        messages,
      }),
  });

  // Si anotar el gasto falla, la respuesta ya está pagada: se entrega igual.
  await sumarGasto(costoUsd(r.uso)).catch((err) => console.error('[asesor/gasto]', err.message));
  return r;
}

module.exports = { AsesorNoDisponible, disponible, responder };
