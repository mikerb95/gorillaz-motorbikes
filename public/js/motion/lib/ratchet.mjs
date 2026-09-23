// Avance "a golpes de trinquete" para la sección de servicios (sin DOM).
//
// En escritorio el scroll recorre los servicios uno por uno. En vez de un
// avance continuo (que deja la moto a medio camino entre dos servicios), el
// progreso se reparte en paradas: el índice cambia en seco y la cabeza de la
// llave de trinquete gira un diente con un clic al final de cada tramo, como
// la herramienta real.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Índice del servicio activo para un progreso 0..1 de la sección fijada. */
export function detentIndex(progress, count) {
  if (count <= 1) return 0;
  return clamp(Math.round(clamp(progress, 0, 1) * (count - 1)), 0, count - 1);
}

/** Progreso 0..1 que corresponde a la parada `index`. */
export function detentProgress(index, count) {
  if (count <= 1) return 0;
  return clamp(index, 0, count - 1) / (count - 1);
}

/**
 * Ángulo (grados) de la cabeza del trinquete. Entre dos paradas la cabeza
 * queda quieta durante el 70 % del tramo y gira un diente de golpe en el
 * último 30 %: es el "clic" que se siente al apretar una tuerca.
 */
export function ratchetAngle(progress, count, teeth = 24) {
  if (count <= 1) return 0;
  const phase = clamp(progress, 0, 1) * (count - 1);
  const base = Math.floor(phase);
  const frac = phase - base;
  const k = frac < 0.7 ? 0 : (frac - 0.7) / 0.3;
  const eased = k * k * (3 - 2 * k);
  return ((base + eased) * 360) / teeth;
}
