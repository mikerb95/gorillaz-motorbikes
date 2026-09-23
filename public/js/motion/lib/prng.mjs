// Aleatoriedad con semilla para el motion.
//
// Los "accidentes" visuales (rotación de un sello, desgaste de la cortina,
// salpicaduras de tinta) tienen que ser iguales en cada visita y en cada
// captura: si cambiaran al recargar, la página se vería distinta en las pruebas
// y el diseño no se podría revisar. Por eso nunca usamos Math.random en el
// motion: todo sale de una semilla fija o derivada de un texto.

/** FNV-1a de 32 bits: convierte un texto (p. ej. un slug) en una semilla. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: generador pequeño y rápido, suficiente para decidir formas. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Número en [min, max) a partir de un generador. */
export function between(rand, min, max) {
  return min + (max - min) * rand();
}
