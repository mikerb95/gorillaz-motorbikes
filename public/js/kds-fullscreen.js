// Mantiene la pantalla completa del KDS activa a través de la navegación.
// La Fullscreen API se reinicia en cada carga de página (no hay SPA aquí),
// así que la preferencia se guarda en localStorage y se reintenta en cada
// página de /kds hasta que el usuario vuelva a presionar el toggle.
(function () {
  'use strict';

  var KEY = 'kdsFullscreenEnabled';
  var reentryArmed = false;

  function isEnabled() {
    try { return localStorage.getItem(KEY) === '1'; } catch (e) { return false; }
  }

  function setEnabled(v) {
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch (e) {}
  }

  function isStandalone() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function enterFullscreen() {
    var el = document.documentElement;
    // Pedir fullscreen sobre una PWA ya instalada (standalone) es redundante
    // -- el navegador ya está oculto -- y en algunos WebViews (p. ej. EMUI de
    // Huawei) esa combinación provoca que la app parpadee y se cierre.
    if (isStandalone() || document.fullscreenElement || !el.requestFullscreen) return;
    el.requestFullscreen().catch(function () {});
  }

  // Sin un gesto del usuario, requestFullscreen() puede fallar silenciosamente
  // al cargar la página. Si eso pasa, el siguiente toque en la pantalla
  // (que sí cuenta como gesto) reintenta una sola vez.
  function armReentry() {
    if (reentryArmed) return;
    reentryArmed = true;
    document.addEventListener('click', function onClick() {
      reentryArmed = false;
      document.removeEventListener('click', onClick, true);
      if (isEnabled()) enterFullscreen();
    }, { capture: true });
  }

  function toggle(e) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    if (document.fullscreenElement) {
      setEnabled(false);
      document.exitFullscreen().catch(function () {});
    } else {
      setEnabled(true);
      enterFullscreen();
    }
  }

  if (isEnabled()) {
    enterFullscreen();
    armReentry();
  }

  document.addEventListener('fullscreenchange', function () {
    if (!document.fullscreenElement && isEnabled()) armReentry();
  });

  window.KdsFullscreen = { toggle: toggle, isEnabled: isEnabled };
})();
