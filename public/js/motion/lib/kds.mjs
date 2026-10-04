// Lógica del motion del KDS (sin DOM): reloj, odómetro, tablero en vivo.
//
// La pantalla del cliente muestra cuántas motos hay en cada etapa y, cuando
// una avanza, su ficha vuela de una casilla a otra. El servidor solo manda
// conteos (nunca placas), así que aquí se deduce qué ficha "se movió" a partir
// de dos conteos seguidos. Es una lectura plausible, no un registro: dos motos
// que cambian a la vez pueden emparejarse distinto de como pasó en realidad,
// y eso no importa porque las fichas son anónimas.

/** Conteo por etapa, en el orden de `stages` (lista de valores de estado). */
export function stageCounts(orders, stages) {
  const counts = stages.map(() => 0);
  for (const o of orders || []) {
    const i = stages.indexOf(o && o.status);
    if (i !== -1) counts[i]++;
  }
  return counts;
}

/**
 * Qué fichas se mueven entre dos conteos. Cada etapa que pierde motos es un
 * origen y cada una que gana es un destino; se empareja primero hacia delante
 * (lo normal es avanzar: ingreso → en curso → completo) y, si no hay destino
 * más adelante, hacia atrás (de "en pausa" se vuelve a "en curso").
 * Lo que sobra son motos que entran al taller o salen de él (entregadas).
 */
export function planMoves(prev, next) {
  const n = Math.max(prev.length, next.length);
  const loss = [];
  const gain = [];
  for (let i = 0; i < n; i++) {
    const d = (next[i] || 0) - (prev[i] || 0);
    if (d < 0) loss.push({ i, left: -d });
    if (d > 0) gain.push({ i, left: d });
  }
  const moves = [];
  const take = (src, dst) => {
    const k = Math.min(src.left, dst.left);
    for (let j = 0; j < k; j++) moves.push({ from: src.i, to: dst.i });
    src.left -= k;
    dst.left -= k;
  };
  // Hacia delante: cada origen busca el destino más cercano por delante.
  for (const src of loss) {
    for (const dst of gain) if (dst.i > src.i && src.left && dst.left) take(src, dst);
  }
  // Hacia atrás: el destino más cercano por detrás.
  for (const src of loss) {
    for (const dst of gain.slice().reverse()) if (dst.i < src.i && src.left && dst.left) take(src, dst);
  }
  const exits = [];
  const enters = [];
  for (const src of loss) for (let j = 0; j < src.left; j++) exits.push(src.i);
  for (const dst of gain) for (let j = 0; j < dst.left; j++) enters.push(dst.i);
  return { moves, enters, exits };
}

/** Fichas a dibujar en una casilla: hasta `max` y un "+N" con el resto. */
export function tokenLayout(count, max = 8) {
  const c = Math.max(0, Math.floor(count || 0));
  if (c <= max) return { shown: c, extra: 0 };
  return { shown: max - 1, extra: c - (max - 1) };
}

/**
 * Odómetro: cada dígito es una tira "0123456789" repetida dos veces. Devuelve
 * el recorrido en yPercent (sobre la tira de 20) para pasar de `from` a `to`
 * siempre rodando hacia delante: si el dígito nuevo es menor (9 → 0) se rueda
 * hasta la segunda copia y luego se salta, sin que se note, a la primera.
 */
export function rollPath(from, to) {
  const pos = (d) => -d * 5; // 100 / 20 casillas
  const a = ((from % 10) + 10) % 10;
  const b = ((to % 10) + 10) % 10;
  if (b >= a) return { from: pos(a), to: pos(b), reset: null };
  return { from: pos(a), to: pos(b + 10), reset: pos(b) };
}

/** Hora del taller (Bogotá, 12 h) separada en dígitos y "a. m."/"p. m.". */
export function clockParts(date, timeZone = 'America/Bogota') {
  const parts = new Intl.DateTimeFormat('es-CO', {
    timeZone, hour12: true, hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const get = (t) => (parts.find((p) => p.type === t) || {}).value || '';
  const hh = get('hour').padStart(2, '0');
  const mm = get('minute').padStart(2, '0');
  // ICU escribe "a. m." con espacios finos o normales según la versión.
  const ampm = get('dayPeriod').replace(/\s+/g, ' ').trim();
  return { digits: (hh + mm).split('').map(Number), hh, mm, ampm, label: `${hh}:${mm} ${ampm}` };
}

/** Firma de lo que cambia el tablero (sin el tiempo, que se actualiza aparte). */
export function boardSignature(orders) {
  return (orders || [])
    .map((o) => [o.id, o.label, o.motorcycle, o.mechanic, o.status, o.itemCount].join('\u0001'))
    .join('\u0002');
}

/** Ids de las órdenes que cambiaron de estado entre dos lecturas del tablero. */
export function changedStatus(prev, next) {
  const before = new Map((prev || []).map((o) => [o.id, o.status]));
  return (next || []).filter((o) => before.has(o.id) && before.get(o.id) !== o.status).map((o) => o.id);
}
