// Vuelo de una herramienta del tablero a su ficha (sin DOM).
//
// Una herramienta no se desliza en línea recta: se descuelga (sube), viaja en
// arco y baja a su lugar, girando un poco mientras va en la mano. Aquí solo
// está la geometría; el componente decide cuándo y con qué easing.

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;

/** Centro y tamaño de un rectángulo tipo getBoundingClientRect. */
export function rectCenter(r) {
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width, h: r.height };
}

/**
 * Cuadro del vuelo en el instante t (0..1) desde el rectángulo `from` hasta
 * `to`. El punto de control del arco queda en el medio, levantado `lift` px
 * por encima del más alto de los dos extremos. Devuelve el centro, la escala
 * relativa al tamaño de destino y la rotación en grados.
 */
export function flightFrame(t, from, to, { lift = 120, tilt = -14 } = {}) {
  const k = clamp01(t);
  const a = rectCenter(from);
  const b = rectCenter(to);
  const cx = (a.x + b.x) / 2;
  const cy = Math.min(a.y, b.y) - lift;
  const u = 1 - k;
  const x = u * u * a.x + 2 * u * k * cx + k * k * b.x;
  const y = u * u * a.y + 2 * u * k * cy + k * k * b.y;
  const scale = lerp(a.w / b.w, 1, k);
  // Gira al descolgarse y se endereza al llegar (una campana, no una rampa).
  const rotation = tilt * Math.sin(Math.PI * k);
  return { x, y, scale, rotation };
}
