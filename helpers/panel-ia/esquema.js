'use strict';
// Validador mínimo de JSON Schema para las entradas de las herramientas del
// asistente. El repo no usa zod y las herramientas solo necesitan lo básico:
// object con required y sin campos extra, string (maxLength, enum, pattern),
// integer/number (minimum, maximum), boolean y array (items, minItems, maxItems).
//
// Valida lo que el modelo manda ANTES de ejecutar nada: un campo de más o un
// tipo equivocado devuelve el error al modelo para que lo corrija.
//
// Módulo PURO.

function validar(esquema, valor, ruta = 'entrada') {
  const t = esquema.type;
  if (t === 'object') {
    if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return `${ruta} debe ser un objeto.`;
    const props = esquema.properties || {};
    for (const k of esquema.required || []) {
      if (valor[k] === undefined || valor[k] === null) return `Falta ${ruta === 'entrada' ? k : `${ruta}.${k}`}.`;
    }
    for (const k of Object.keys(valor)) {
      if (!props[k]) {
        if (esquema.additionalProperties === false) return `Campo no permitido: ${k}.`;
        continue;
      }
      if (valor[k] === null && !(esquema.required || []).includes(k)) continue;
      const e = validar(props[k], valor[k], ruta === 'entrada' ? k : `${ruta}.${k}`);
      if (e) return e;
    }
    if (esquema.minProperties && Object.keys(valor).filter((k) => valor[k] !== undefined && valor[k] !== null).length < esquema.minProperties) {
      return esquema.mensajeMinProperties || `${ruta} necesita al menos ${esquema.minProperties} campo(s).`;
    }
    return null;
  }
  if (t === 'array') {
    if (!Array.isArray(valor)) return `${ruta} debe ser una lista.`;
    if (esquema.minItems !== undefined && valor.length < esquema.minItems) return `${ruta} necesita al menos ${esquema.minItems} elemento(s).`;
    if (esquema.maxItems !== undefined && valor.length > esquema.maxItems) return `${ruta} admite máximo ${esquema.maxItems} elementos.`;
    for (let i = 0; i < valor.length; i++) {
      const e = validar(esquema.items, valor[i], `${ruta}[${i}]`);
      if (e) return e;
    }
    return null;
  }
  if (t === 'string') {
    if (typeof valor !== 'string') return `${ruta} debe ser texto.`;
    if (esquema.minLength !== undefined && valor.trim().length < esquema.minLength) return `${ruta} no puede ir vacío.`;
    if (esquema.maxLength !== undefined && valor.length > esquema.maxLength) return `${ruta} admite máximo ${esquema.maxLength} caracteres.`;
    if (esquema.enum && !esquema.enum.includes(valor)) return `${ruta} debe ser uno de: ${esquema.enum.join(', ')}.`;
    if (esquema.pattern && !new RegExp(esquema.pattern).test(valor)) return `${ruta} no tiene el formato esperado.`;
    return null;
  }
  if (t === 'integer' || t === 'number') {
    if (typeof valor !== 'number' || !Number.isFinite(valor)) return `${ruta} debe ser un número.`;
    if (t === 'integer' && !Number.isInteger(valor)) return `${ruta} debe ser un número entero.`;
    if (esquema.minimum !== undefined && valor < esquema.minimum) return `${ruta} debe ser mayor o igual a ${esquema.minimum}.`;
    if (esquema.maximum !== undefined && valor > esquema.maximum) return `${ruta} debe ser menor o igual a ${esquema.maximum}.`;
    return null;
  }
  if (t === 'boolean') return typeof valor === 'boolean' ? null : `${ruta} debe ser verdadero o falso.`;
  return null;
}

/** Quita las claves propias del validador que la API no conoce. */
function paraApi(esquema) {
  if (!esquema || typeof esquema !== 'object') return esquema;
  const { mensajeMinProperties, ...resto } = esquema;
  if (resto.properties) {
    resto.properties = Object.fromEntries(Object.entries(resto.properties).map(([k, v]) => [k, paraApi(v)]));
  }
  if (resto.items) resto.items = paraApi(resto.items);
  return resto;
}

module.exports = { validar, paraApi };
