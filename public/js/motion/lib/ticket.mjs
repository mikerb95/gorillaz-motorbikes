// Lógica de la ficha de trabajo del ejemplo "estado de tu moto" (sin DOM).
//
// La ficha recibe un sello por cada etapa real de /mi-orden. Aquí vive solo el
// cálculo: qué sellos ya cayeron para un progreso dado y en qué fase va el que
// está cayendo, y el formato de la placa. Los textos de las etapas están en el
// marcado del servidor (home.ejs); un test comprueba que coinciden con los de
// views/mi-orden.ejs para que el ejemplo nunca muestre un estado que no existe.

const clamp01 = (x) => Math.min(1, Math.max(0, x));

/**
 * Reparte el progreso 0..1 entre: escribir la placa (primer tramo) y un sello
 * por etapa. Devuelve la fracción escrita de la placa, cuántos sellos están
 * completos y la fase 0..1 del sello en curso.
 */
export function ticketState(progress, stages, plateShare = 0.18) {
  const p = clamp01(progress);
  const typed = clamp01(p / plateShare);
  if (stages <= 0) return { typed, stamped: 0, phase: 0 };
  const rest = p <= plateShare ? 0 : (p - plateShare) / (1 - plateShare);
  const pos = rest * stages;
  const stamped = Math.min(stages, Math.floor(pos + 1e-9));
  const phase = stamped >= stages ? 0 : pos - stamped;
  return { typed, stamped, phase };
}

/**
 * Placa de moto colombiana: tres letras, dos números y una letra (ABC12D).
 * Devuelve la placa con el espacio de la lámina ("ABC 12D") o null si no
 * tiene ese formato.
 */
export function formatMotoPlate(raw) {
  const clean = String(raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
  if (!/^[A-Z]{3}[0-9]{2}[A-Z]$/.test(clean)) return null;
  return `${clean.slice(0, 3)} ${clean.slice(3)}`;
}

/** Los primeros `n` caracteres visibles de la placa (para "escribirla"). */
export function typedPlate(plate, fraction) {
  const chars = [...plate];
  const n = Math.round(clamp01(fraction) * chars.length);
  return chars.slice(0, n).join('');
}
