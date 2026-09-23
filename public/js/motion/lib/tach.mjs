// Tacómetro de niveles del Club (sin DOM).
//
// Los niveles del club (Prospecto, Miembro, Rider, Gorilla, Gorilla Legend) y
// sus puntos mínimos vienen de la configuración real (helpers/score.js). Aquí
// se convierten en un dial: los puntos son las "revoluciones" y el último
// nivel es la zona roja. Si el admin cambia los umbrales, el dial se redibuja
// solo, sin tocar este archivo.

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/** Niveles ordenados de menor a mayor con su tramo [min, max). */
export function levelBands(levels, dialMax) {
  const sorted = [...levels].filter((l) => Number.isFinite(+l.min)).sort((a, b) => a.min - b.min);
  return sorted.map((l, i) => ({
    name: l.name,
    min: +l.min,
    max: i + 1 < sorted.length ? +sorted[i + 1].min : dialMax,
  }));
}

/**
 * Tope del dial: un tercio por encima del último umbral, redondeado a 100,
 * para que la zona roja se vea como zona y no como una raya.
 */
export function dialMaxFor(levels) {
  const top = Math.max(0, ...levels.map((l) => +l.min || 0));
  return Math.max(100, Math.ceil((top * 4) / 3 / 100) * 100);
}

/** Ángulo (grados, 0 = arriba, sentido horario) para una cantidad de puntos. */
export function pointsToAngle(points, dialMax, startDeg = -132, endDeg = 132) {
  const t = clamp(points / dialMax, 0, 1);
  return startDeg + (endDeg - startDeg) * t;
}

/** Nivel al que corresponden `points` puntos. */
export function levelAt(points, levels) {
  const sorted = [...levels].sort((a, b) => b.min - a.min);
  return sorted.find((l) => points >= l.min) || sorted[sorted.length - 1] || null;
}

/** Punto (x, y) sobre un círculo de radio r para un ángulo del dial. */
export function polar(cx, cy, r, deg) {
  const rad = (deg * Math.PI) / 180;
  return { x: cx + r * Math.sin(rad), y: cy - r * Math.cos(rad) };
}

/** Trazo SVG de un arco del dial entre dos ángulos. */
export function arcPath(cx, cy, r, fromDeg, toDeg) {
  const a = polar(cx, cy, r, fromDeg);
  const b = polar(cx, cy, r, toDeg);
  const large = Math.abs(toDeg - fromDeg) > 180 ? 1 : 0;
  const f = (n) => Math.round(n * 100) / 100;
  return `M${f(a.x)} ${f(a.y)}A${r} ${r} 0 ${large} 1 ${f(b.x)} ${f(b.y)}`;
}
