// Cámara del escenario de la moto (sin DOM).
//
// Cada servicio enfoca una parte de la moto. La cámara es el viewBox del SVG:
// un rectángulo con la proporción del escenario que contiene la parte con
// aire alrededor, sin acercarse tanto que se pixele el trazo ni salirse del
// dibujo (se vería el vacío fuera del arte).

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

/**
 * viewBox [x, y, w, h] para enfocar `focus` dentro de `art`, con la
 * proporción `aspect` (ancho / alto). `pad` es cuánto aire dejar alrededor y
 * `minW` el ancho mínimo (tope de acercamiento).
 */
export function cameraBox(focus, art, aspect, { pad = 1.9, minW = 540 } = {}) {
  const [fx, fy, fw, fh] = focus;
  const [ax, ay, aw, ah] = art;
  let w = Math.max(fw * pad, fh * pad * aspect, minW);
  w = Math.min(w, aw, ah * aspect);
  const h = w / aspect;
  const cx = fx + fw / 2;
  const cy = fy + fh / 2;
  const x = clamp(cx - w / 2, ax, ax + aw - w);
  const y = clamp(cy - h / 2, ay, ay + ah - h);
  const r = (n) => Math.round(n * 10) / 10;
  return [r(x), r(y), r(w), r(h)];
}

/** Texto para el atributo viewBox. */
export const viewBoxString = (box) => box.join(' ');
