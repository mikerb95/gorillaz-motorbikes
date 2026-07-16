'use strict';
// Reordenamiento de ítems arrastrando (estilo playlist). Funciona con mouse y
// con toque (móvil/tablet KDS), sin librerías externas por la CSP.
//
//   window.ItemReorder(container, {
//     item:   'tr',          // selector de cada elemento reordenable
//     handle: '.it-drag',    // selector del asa dentro del elemento (opcional)
//     onChange: fn           // callback tras soltar si el orden cambió (opcional)
//   });
//
// Usa delegación de eventos, así que sirve aunque los elementos se creen o
// eliminen dinámicamente después de inicializar. Reordena solo el DOM: quien
// llama decide cómo persistirlo (al enviar un form, un fetch en onChange, etc.).
(function () {
  function ItemReorder(container, opts) {
    if (!container) return;
    opts = opts || {};
    var itemSel   = opts.item || 'li';
    var handleSel = opts.handle || null;
    var onChange  = typeof opts.onChange === 'function' ? opts.onChange : null;

    var dragEl = null;
    var moved  = false;

    function items() {
      return Array.prototype.slice.call(container.children)
        .filter(function (el) { return el.matches && el.matches(itemSel); });
    }

    function targetBefore(y) {
      // Primer elemento cuyo punto medio queda por debajo del cursor.
      var list = items().filter(function (el) { return el !== dragEl; });
      for (var i = 0; i < list.length; i++) {
        var box = list[i].getBoundingClientRect();
        if (y < box.top + box.height / 2) return list[i];
      }
      return null;
    }

    function pointY(e) {
      return e.touches && e.touches[0] ? e.touches[0].clientY : e.clientY;
    }

    function onMove(e) {
      if (!dragEl) return;
      var before = targetBefore(pointY(e));
      if (before) { if (dragEl.nextSibling !== before) { container.insertBefore(dragEl, before); moved = true; } }
      else if (dragEl !== container.lastElementChild) { container.appendChild(dragEl); moved = true; }
      if (e.cancelable) e.preventDefault();
    }

    function onUp() {
      if (dragEl) { dragEl.style.opacity = ''; dragEl.classList.remove('reorder-dragging'); }
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onUp);
      document.removeEventListener('touchcancel', onUp);
      var didMove = moved;
      dragEl = null;
      moved = false;
      if (didMove && onChange) onChange();
    }

    function start(el, e) {
      dragEl = el;
      moved = false;
      el.style.opacity = '0.55';
      el.classList.add('reorder-dragging');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
      document.addEventListener('touchmove', onMove, { passive: false });
      document.addEventListener('touchend', onUp);
      document.addEventListener('touchcancel', onUp);
      if (e.cancelable) e.preventDefault();
    }

    function handleFrom(e) {
      var t = e.target;
      if (handleSel) {
        var h = t.closest(handleSel);
        if (!h || !container.contains(h)) return null;
      }
      var el = t.closest(itemSel);
      return el && container.contains(el) ? el : null;
    }

    container.addEventListener('mousedown', function (e) {
      if (e.button !== 0) return;
      var el = handleFrom(e);
      if (el) start(el, e);
    });
    container.addEventListener('touchstart', function (e) {
      var el = handleFrom(e);
      if (el) start(el, e);
    }, { passive: false });
  }

  window.ItemReorder = ItemReorder;
})();
