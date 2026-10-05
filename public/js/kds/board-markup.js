// Marcado del tablero de órdenes del KDS, compartido por servidor y navegador.
//
// El servidor pinta el tablero con esta función (así se ve completo sin JS) y
// el navegador la usa para repintarlo cuando llegan órdenes nuevas. Una sola
// plantilla evita que las dos versiones terminen mostrando cosas distintas.
// Placa, etiqueta y mecánico son datos de usuario: todo pasa por escapeHtml.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.KdsBoardMarkup = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ESC[c]; });
  }

  /** Tiempo desde el ingreso ("45 min", "1h 5min"). */
  function elapsedLabel(ms) {
    var mins = Math.max(0, Math.floor(ms / 60000));
    if (mins < 60) return mins + ' min';
    var hrs = Math.floor(mins / 60);
    return hrs + 'h ' + (mins % 60) + 'min';
  }

  function sinceLabel(iso, now) {
    var t = new Date(iso).getTime();
    return isNaN(t) ? '' : elapsedLabel(now - t);
  }

  /**
   * Placa como se lee en la lámina: "ABC12D" → "ABC 12D" (moto), "ABC123" →
   * "ABC 123" (carro). Cualquier otro formato se deja tal cual.
   */
  function formatPlate(raw) {
    var p = String(raw == null ? '' : raw).trim().toUpperCase().replace(/\s+/g, '');
    var m = p.match(/^([A-Z]{3})(\d{2}[A-Z]|\d{3})$/);
    return m ? m[1] + ' ' + m[2] : p;
  }

  function plural(n, one, many) { return n + ' ' + (Number(n) === 1 ? one : many); }

  // Tarjeta de orden: la placa amarilla manda (es lo que se busca con la
  // mirada), el tiempo en taller a la derecha y abajo quién la tiene.
  function cardMarkup(o, now) {
    var id = String(o.id);
    var plate = formatPlate(o.motorcycle);
    return '<a class="kds-card st-' + escapeHtml(o.status) + '" href="/kds/orden/' + escapeHtml(encodeURIComponent(id)) + '"' +
      ' data-flip-id="' + escapeHtml(id) + '" data-created="' + escapeHtml(o.createdAt) + '">' +
      '<div class="kds-card-top">' +
        (plate
          ? '<span class="kds-plate">' + escapeHtml(plate) + '</span>'
          : '<span class="kds-plate is-empty">Sin placa</span>') +
        '<span class="kds-card-time"><small>En taller</small><span data-elapsed>' + escapeHtml(sinceLabel(o.createdAt, now)) + '</span></span>' +
      '</div>' +
      '<div class="kds-card-meta">' +
        (o.mechanic
          ? '<span class="kds-card-who">' + escapeHtml(o.mechanic) + '</span>'
          : '<span class="kds-card-who is-none">Sin asignar</span>') +
        '<span>' + escapeHtml(plural(o.itemCount || 0, 'ítem', 'ítems')) + '</span>' +
        '<span class="kds-card-id">' + escapeHtml(o.label) + '</span>' +
      '</div>' +
      '</a>';
  }

  /** Columnas del tablero, una por estado, con sus tarjetas. */
  function boardMarkup(orders, statuses, now) {
    return (statuses || []).map(function (st) {
      var inCol = (orders || []).filter(function (o) { return o.status === st.v; });
      return '<div class="kds-col" data-col="' + escapeHtml(st.v) + '">' +
        '<h2><span>' + escapeHtml(st.l) + '</span><span data-col-count>' + inCol.length + '</span></h2>' +
        (inCol.length
          ? inCol.map(function (o) { return cardMarkup(o, now); }).join('')
          : '<div class="kds-empty">Sin órdenes</div>') +
        '</div>';
    }).join('');
  }

  return { escapeHtml: escapeHtml, elapsedLabel: elapsedLabel, sinceLabel: sinceLabel, formatPlate: formatPlate, boardMarkup: boardMarkup };
});
