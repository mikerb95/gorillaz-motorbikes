'use strict';
// Reconstruye una conversación para pintarla en el panel a partir del
// historial que se guarda para la API (solo por anexión). Así no hace falta
// una segunda copia "para la pantalla" que pueda desalinearse.
//
// Un turno empieza con cada pregunta: un mensaje de usuario de texto, o el
// rechazo de una propuesta con indicaciones ("cámbiale el precio"), que viaja
// como tool_result y lleva el prefijo PREFIJO_CAMBIOS.
//
// Los avisos internos de la guardia de cifras (PREFIJO_GUARDIA) no abren
// turno: borran la respuesta que la guardia rechazó para que se vea la nueva.
// Si la guardia la rechaza dos veces, PREFIJO_BLOQUEO deja el texto de respaldo.
//
// Módulo PURO.

const PREFIJO_CAMBIOS = 'La persona no aprobó la propuesta y pidió cambios: ';
const PREFIJO_GUARDIA = '[Revisión automática] ';
const PREFIJO_BLOQUEO = '[Respuesta retirada] ';
const RESPALDO =
  'Preferí no darte esa respuesta porque traía cifras que no pude respaldar con los datos del panel. Pregúntame de nuevo indicando la orden o el producto.';

/** Lo que recibe el modelo cuando no se aprueba. Con indicación, `turnosDe` la recupera para pintarla. */
function textoRechazo(comentario) {
  return comentario
    ? `${PREFIJO_CAMBIOS}"${comentario}". Ajusta la propuesta según su indicación y vuelve a proponer si corresponde.`
    : 'La persona no aprobó la propuesta. No la repitas igual: pregúntale qué quiere cambiar.';
}

function indicacion(bloques) {
  for (const b of bloques) {
    if (b.type !== 'tool_result' || !b.is_error || typeof b.content !== 'string') continue;
    if (!b.content.startsWith(PREFIJO_CAMBIOS)) continue;
    const resto = b.content.slice(PREFIJO_CAMBIOS.length);
    const m = resto.match(/^"([\s\S]*)"\./);
    return m ? m[1] : resto;
  }
  return null;
}

function textoUsuario(m) {
  if (typeof m.content === 'string') return m.content;
  const t = m.content.find((b) => b.type === 'text' && b.text);
  return t ? t.text : null;
}

/** [{ pregunta, respuesta, pasos: [nombres de herramienta] }] */
function turnosDe(mensajes) {
  const turnos = [];
  let actual = null;
  const abrir = (pregunta) => {
    actual = { pregunta, respuesta: '', pasos: [] };
    turnos.push(actual);
  };

  for (const m of mensajes || []) {
    if (m.role === 'user') {
      const texto = textoUsuario(m);
      if (texto && texto.startsWith(PREFIJO_GUARDIA)) {
        if (actual) actual.respuesta = '';
        continue;
      }
      if (texto && texto.startsWith(PREFIJO_BLOQUEO)) {
        if (actual) actual.respuesta = RESPALDO;
        continue;
      }
      if (typeof m.content === 'string') abrir(m.content);
      else {
        const conResultado = m.content.some((b) => b.type === 'tool_result');
        const cambio = indicacion(m.content);
        if (texto && !conResultado) abrir(texto);
        else if (cambio) abrir(cambio);
      }
      continue;
    }
    if (!actual || typeof m.content === 'string') continue;
    for (const b of m.content) {
      if (b.type === 'text' && b.text && b.text.trim()) {
        actual.respuesta = actual.respuesta ? `${actual.respuesta}\n\n${b.text.trim()}` : b.text.trim();
      }
      if (b.type === 'tool_use' && b.name && !actual.pasos.includes(b.name)) actual.pasos.push(b.name);
    }
  }
  return turnos;
}

const contarTurnos = (mensajes) => turnosDe(mensajes).length;

module.exports = {
  PREFIJO_CAMBIOS, PREFIJO_GUARDIA, PREFIJO_BLOQUEO, RESPALDO,
  textoRechazo, turnosDe, contarTurnos,
};
