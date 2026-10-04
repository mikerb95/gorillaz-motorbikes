// Transición de vista entre /servicios y la ficha ampliada /servicios/<slug>.
//
// "Ver detalle" no cambia de página a secas: la ficha que tocaste crece hasta
// ocupar la página nueva. El retazo de tablero se agranda, la herramienta viaja
// (y se ladea en la mano, como en el vuelo del tablero) hasta su sitio y el
// título se acomoda. Al volver, el mismo gesto al revés. Entre dos fichas
// ampliadas, la herramienta nueva sale de su gancho del tablero de abajo y la
// anterior vuelve a colgarse en el suyo.
//
// Los nombres de transición se ponen solo en la ficha implicada y solo durante
// el cambio de página: once fichas con el mismo nombre anularían la transición.
// Los estilos de la animación están en servicios.css (::view-transition-*).
//
// Es un script clásico, no un módulo, y va antes del contenido: `pagereveal` se
// dispara antes del primer pintado y un módulo diferido podría llegar tarde.
// Sin soporte de transiciones entre documentos, la navegación es la normal.
(function () {
  'use strict';
  var w = window;
  // detail.mjs espera a que termine la transición de entrada para imprimir las
  // cintas; sin soporte (o sin transición) la promesa resuelve null.
  if (!('onpagereveal' in w) || !('onpageswap' in w) || !w.navigation) {
    w.__svRevealed = Promise.resolve(null);
    return;
  }

  var DETAIL = /^\/servicios\/([a-z0-9-]+)\/?$/;
  var NOT_DETAIL = { agendar: 1, agenda: 1 };

  function parse(url) {
    try {
      var u = new URL(url, location.href);
      if (u.origin !== location.origin) return null;
      if (/^\/servicios\/?$/.test(u.pathname)) return { board: true };
      var m = u.pathname.match(DETAIL);
      if (m && !NOT_DETAIL[m[1]]) return { slug: m[1] };
    } catch (e) {}
    return null;
  }

  var here = parse(location.href) || {};

  // De dónde viene y a dónde va cada cambio de página. La URL de las otras
  // entradas del historial llega null con Referrer-Policy no-referrer (helmet),
  // así que cada página deja su ruta en el estado de su propia entrada.
  try {
    var st = w.navigation.currentEntry.getState();
    if (!st || typeof st !== 'object' || st.svPath !== location.pathname) {
      w.navigation.updateCurrentEntry({ state: Object.assign({}, st && typeof st === 'object' ? st : {}, { svPath: location.pathname }) });
    }
  } catch (e) {}
  function where(entry) {
    if (!entry) return null;
    if (entry.url) return parse(entry.url);
    try {
      var s = entry.getState();
      return s && s.svPath ? parse(s.svPath) : null;
    } catch (e) { return null; }
  }

  function name(el, n) {
    if (!el) return;
    el.style.viewTransitionName = n;
    el.setAttribute('data-vt', '');
  }
  function clear() {
    var named = document.querySelectorAll('[data-vt]');
    for (var i = 0; i < named.length; i++) {
      named[i].style.viewTransitionName = '';
      named[i].removeAttribute('data-vt');
    }
  }
  function visible(el) {
    return el && parseFloat(getComputedStyle(el).opacity) > 0.5;
  }
  function slotTool(slug) {
    return document.querySelector('.sv-board .sv-slot[data-slug="' + slug + '"] .sv-tool');
  }

  // La ficha de `slug` en esta página: la de la lista o la ampliada.
  function nameCard(slug) {
    var card = document.querySelector(here.board ? '.sv-card[data-slug="' + slug + '"]' : '.sv-detail[data-slug="' + slug + '"]');
    if (!card) return false;
    var panel = card.querySelector('.sv-card-tool');
    var tool = panel && panel.querySelector('.sv-tool');
    // En escritorio, /servicios solo muestra la herramienta en la ficha que la
    // trajo del tablero; si no está ahí, sigue colgada en su gancho.
    if (here.board && !visible(tool)) tool = slotTool(slug);
    name(card, 'sv-card');
    name(panel, 'sv-board');
    name(tool, 'sv-tool');
    name(card.querySelector('.sv-card-title'), 'sv-title');
    return true;
  }

  // Ficha ampliada de `open` que se cambia por la de `next` (o al revés).
  function nameSwap(open, next, nextIsHere) {
    // La ficha y su retazo se quedan en su sitio; cambia la herramienta.
    var card = document.querySelector('.sv-detail');
    if (!card) return;
    name(card, 'sv-card');
    name(card.querySelector('.sv-card-tool'), 'sv-board');
    name(card.querySelector('.sv-card-title'), 'sv-title');
    var big = card.querySelector('.sv-card-tool .sv-tool');
    if (nextIsHere) {
      // Página nueva: la herramienta grande llegó del tablero y la anterior
      // vuelve a su gancho.
      name(big, 'sv-tool');
      name(slotTool(open), 'sv-tool-back');
    } else {
      name(slotTool(next), 'sv-tool');
      name(big, 'sv-tool-back');
    }
  }

  // Página que se va.
  w.addEventListener('pageswap', function (e) {
    clear();
    if (!e.viewTransition || !e.activation) return;
    var to = where(e.activation.entry);
    if (!to) return;
    if (here.board && to.slug) {
      if (!nameCard(to.slug)) e.viewTransition.skipTransition();
    } else if (here.slug && to.board) {
      nameCard(here.slug);
      // /servicios sabrá que esta ficha vuelve abierta (tool-board.mjs).
      try { sessionStorage.setItem('sv-return', here.slug); } catch (err) {}
    } else if (here.slug && to.slug && to.slug !== here.slug) {
      nameSwap(here.slug, to.slug, false);
    } else {
      e.viewTransition.skipTransition();
    }
  });

  // Página que llega.
  var settle;
  w.__svRevealed = new Promise(function (resolve) { settle = resolve; });
  w.addEventListener('pagereveal', function (e) {
    clear(); // por si la página vuelve del bfcache con nombres puestos
    var vt = e.viewTransition;
    var from = vt && w.navigation.activation ? where(w.navigation.activation.from) : null;
    if (vt && from) {
      if (here.slug && from.board) nameCard(here.slug);
      else if (here.board && from.slug) nameCard(from.slug);
      else if (here.slug && from.slug && from.slug !== here.slug) nameSwap(from.slug, here.slug, true);
      vt.finished.then(clear, clear);
    }
    settle(vt || null);
  });
})();
