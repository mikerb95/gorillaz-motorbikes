'use strict';
// Roll de productos de la tienda en la pantalla principal del KDS: muestra 2
// ítems a la vez y va rotando. DOM construido con textContent/atributos
// (no innerHTML) porque nombre/imagen vienen del catálogo editable por admin.
(function () {
  document.addEventListener('DOMContentLoaded', function () {
    var root = document.getElementById('kdsProductRoll');
    if (!root) return;

    var products;
    try { products = JSON.parse(root.getAttribute('data-products') || '[]'); }
    catch (e) { products = []; }
    if (!Array.isArray(products) || products.length === 0) { root.style.display = 'none'; return; }

    var container = document.getElementById('kdsProductRollItems');
    var pairs = [];
    for (var i = 0; i < products.length; i += 2) pairs.push(products.slice(i, i + 2));

    var fmt = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

    function buildCard(p) {
      var price = p.discount ? Math.round(p.price * (1 - p.discount / 100)) : p.price;

      var card = document.createElement('div');
      card.className = 'kds-product-roll-card';

      var img = document.createElement('img');
      img.className = 'kds-product-roll-img';
      img.src = p.image || '';
      img.alt = '';
      img.loading = 'lazy';
      card.appendChild(img);

      var info = document.createElement('div');
      info.className = 'kds-product-roll-info';

      var name = document.createElement('div');
      name.className = 'kds-product-roll-name';
      name.textContent = p.name || '';
      info.appendChild(name);

      var priceEl = document.createElement('div');
      priceEl.className = 'kds-product-roll-price';
      priceEl.textContent = fmt.format(price);
      if (p.discount) {
        var badge = document.createElement('span');
        badge.className = 'kds-product-roll-discount';
        badge.textContent = '-' + p.discount + '%';
        priceEl.appendChild(badge);
      }
      info.appendChild(priceEl);

      card.appendChild(info);
      return card;
    }

    var idx = 0;
    function render() {
      container.classList.remove('is-visible');
      setTimeout(function () {
        container.innerHTML = '';
        pairs[idx].forEach(function (p) { container.appendChild(buildCard(p)); });
        container.classList.add('is-visible');
      }, 220);
    }
    render();

    var reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var timer = null;
    function start() {
      if (timer || pairs.length < 2 || reduceMotion) return;
      timer = setInterval(function () {
        idx = (idx + 1) % pairs.length;
        render();
      }, 5000);
    }
    function stop() {
      clearInterval(timer);
      timer = null;
    }
    start();

    // La tablet queda encendida en modo kiosko: no rotar mientras la pestaña
    // no es visible ahorra ciclos y evita saltos al volver a mirarla.
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) stop();
      else start();
    });
  });
})();
