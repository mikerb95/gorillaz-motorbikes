// Token CSRF vigente en pantallas del KDS que quedan abiertas todo el día.
//
// La cookie _csrf dura una hora y cada página trae el token escrito en sus
// formularios. Una pestaña abierta desde la mañana terminaba enviando un
// token vencido (403) al usar el control del TV, una cotización o un PIN.
// Este latido pide /kds/csrf cada pocos minutos: el servidor renueva la
// cookie (mismo token, una hora más) o emite uno nuevo si ya había vencido,
// y aquí se copia a todos los campos _csrf de la página.
(function () {
  'use strict';
  if (window.KdsCsrf) return;

  var BEAT_MS = 5 * 60 * 1000;

  function fields() { return document.querySelectorAll('input[name="_csrf"]'); }

  function token() {
    var f = fields()[0];
    return f ? f.value : '';
  }

  function apply(t) {
    fields().forEach(function (f) { f.value = t; });
    document.querySelectorAll('[data-csrf]').forEach(function (el) { el.setAttribute('data-csrf', t); });
  }

  function refresh() {
    return fetch('/kds/csrf', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' } })
      .then(function (r) { if (!r.ok) throw new Error('csrf ' + r.status); return r.json(); })
      .then(function (data) {
        if (!data || !data.token) throw new Error('csrf sin token');
        apply(data.token);
        return data.token;
      });
  }

  function beat() { if (!document.hidden) refresh().catch(function () { /* sin red: próximo latido */ }); }
  setInterval(beat, BEAT_MS);
  // Al volver a la pestaña (o al prender la pantalla) se renueva enseguida.
  document.addEventListener('visibilitychange', beat);

  window.KdsCsrf = { token: token, refresh: refresh };
})();
