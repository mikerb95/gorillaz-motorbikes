// Geometría y coreografía de la cortina metálica del hero (sin DOM).
//
// La cortina no sube con una curva de easing genérica: imita a alguien que
// abre el local por la mañana. Primero suelta el candado (un saltico), empuja
// hasta la altura del pecho, se detiene un instante para cambiar el agarre y
// la segunda empujada la manda arriba, donde el resorte del tambor la frena con
// un pequeño rebote. Ese ritmo de "dos empujones" es lo que hace que se lea
// como una cortina real y no como un telón de teatro.

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const lerp = (a, b, t) => a + (b - a) * t;

export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutQuart = (t) => 1 - Math.pow(1 - t, 4);
export const easeInOutSine = (t) => -(Math.cos(Math.PI * t) - 1) / 2;
const linear = (t) => t;

/**
 * Tramos de la apertura: [inicio t, fin t, valor inicial, valor final, easing].
 * `open` es la fracción abierta (0 = cerrada hasta el piso, 1 = arriba).
 * Los tramos son continuos: cada uno empieza donde terminó el anterior.
 */
export const OPENING_SEGMENTS = [
  [0.0, 0.05, 0.0, 0.03, easeOutCubic], // se suelta el candado: sube un poco
  [0.05, 0.11, 0.03, 0.018, easeInOutSine], // y se asienta
  [0.11, 0.43, 0.018, 0.47, easeOutCubic], // primer empujón, hasta el pecho
  [0.43, 0.53, 0.47, 0.445, easeInOutSine], // cambio de agarre: cede un poco
  [0.53, 0.9, 0.445, 1.014, easeOutQuart], // segundo empujón + resorte
  [0.9, 1.0, 1.014, 1.0, easeInOutSine], // tope: rebote y reposo
];

/** Fracción abierta para un tiempo normalizado t en [0, 1]. */
export function openingCurve(t) {
  const x = clamp01(t);
  for (const [t0, t1, v0, v1, ease] of OPENING_SEGMENTS) {
    if (x <= t1) {
      const local = t1 === t0 ? 1 : (x - t0) / (t1 - t0);
      return lerp(v0, v1, (ease || linear)(clamp01(local)));
    }
  }
  return 1;
}

/**
 * Medidas de la cortina en píxeles CSS para un hero de `height` de alto.
 * - housing: borde inferior de la caja del tambor. Queda por debajo de la
 *   navbar fija para que la caja se vea y no quede tapada.
 * - lip: cuánto cuelga el perfil inferior bajo la caja cuando está abierta
 *   (una cortina abierta de verdad deja ver su barra de abajo).
 * - slat: alto de cada lámina; se ajusta al viewport para que siempre haya
 *   ~20 láminas y la cortina no parezca de juguete en móvil ni de bodega en 4K.
 */
export function shutterLayout({ height, headerOffset = 0 }) {
  const housing = Math.round(headerOffset + Math.max(18, height * 0.035));
  const slat = Math.round(Math.min(40, Math.max(22, (height - housing) / 21)));
  const rail = Math.round(slat * 1.35);
  const lip = rail;
  return { housing, slat, rail, lip };
}

/**
 * Posición (px desde arriba del hero) del borde inferior de la cortina.
 * `retract` (0..1) sube también el labio que cuelga: se usa con el scroll,
 * cuando la cortina termina de meterse en su caja.
 */
export function shutterEdge(open, { height, housing, lip }, retract = 0) {
  const top = housing + lip * (1 - clamp01(retract));
  return lerp(height, top, open);
}

/**
 * Cuánto del bloque de texto queda tapado por la cortina, en px desde el
 * borde superior del bloque. El texto vive "detrás" de la cortina: aparece a
 * medida que el borde inferior pasa sobre él.
 */
export function textClipTop(edge, contentTop, contentHeight) {
  return Math.min(contentHeight, Math.max(0, edge - contentTop));
}
