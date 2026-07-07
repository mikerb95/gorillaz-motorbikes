(function () {
  'use strict';

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw-kds.js', { scope: '/kds/' }).catch(() => {});
  }

  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  if (isInstalled()) return;

  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
  var deferredPrompt = null;
  var banner = null;

  function buildBanner(onInstall) {
    var el = document.createElement('div');
    el.className = 'kds-pwa-banner';
    el.innerHTML =
      '<span class="kds-pwa-banner-text">' +
      (isIOS
        ? 'Instala el KDS: toca compartir <strong>⬆︎</strong> y luego «Agregar a inicio».'
        : 'Instala el KDS en esta tablet para abrirlo como app.') +
      '</span>' +
      (isIOS ? '' : '<button type="button" class="kds-pwa-banner-btn">Instalar</button>') +
      '<button type="button" class="kds-pwa-banner-close" aria-label="Cerrar">✕</button>';

    document.body.appendChild(el);

    if (!isIOS) {
      el.querySelector('.kds-pwa-banner-btn').addEventListener('click', onInstall);
    }
    el.querySelector('.kds-pwa-banner-close').addEventListener('click', function () {
      el.remove();
      try { sessionStorage.setItem('kdsPwaBannerDismissed', '1'); } catch (e) {}
    });
    return el;
  }

  function showBanner() {
    try {
      if (sessionStorage.getItem('kdsPwaBannerDismissed') === '1') return;
    } catch (e) {}
    if (banner) return;
    banner = buildBanner(function () {
      if (!deferredPrompt) return;
      deferredPrompt.prompt();
      deferredPrompt.userChoice.finally(function () {
        deferredPrompt = null;
        if (banner) { banner.remove(); banner = null; }
      });
    });
  }

  if (isIOS) {
    showBanner();
  } else {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredPrompt = e;
      showBanner();
    });
  }

  window.addEventListener('appinstalled', function () {
    if (banner) { banner.remove(); banner = null; }
  });
})();
