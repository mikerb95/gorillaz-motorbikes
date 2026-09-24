// Rotuladora (cinta Dymo) de /servicios (sin DOM).
//
// Una rotuladora de cinta imprime letra por letra: cada letra es un apretón
// del gatillo y la cinta avanza a saltos. Por eso la cinta no crece con un
// easing suave sino en escalones, uno por carácter (espacios incluidos: el
// espacio también es un apretón).

/** Cuántos saltos da la cinta para este texto. */
export function feedSteps(text) {
  return Math.max(1, [...String(text || '').trim()].length);
}

/** Duración de la impresión: rápida pero con un tope, para textos largos. */
export function feedDuration(text, { perChar = 0.034, min = 0.22, max = 0.95 } = {}) {
  return Math.min(max, Math.max(min, feedSteps(text) * perChar));
}

/**
 * Programa de impresión de varias cintas seguidas: cuándo empieza cada una
 * (la siguiente arranca cuando la anterior se corta, con una pausa de corte).
 */
export function printSchedule(texts, { gap = 0.12, ...opts } = {}) {
  let at = 0;
  return texts.map((t) => {
    const d = feedDuration(t, opts);
    const slot = { at: Math.round(at * 1000) / 1000, duration: d, steps: feedSteps(t) };
    at += d + gap;
    return slot;
  });
}
