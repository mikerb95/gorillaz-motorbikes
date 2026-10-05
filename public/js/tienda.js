// Tienda: agregar/comprar desde tarjetas y ficha, variantes, galería, barra de
// compra fija en móvil y totales en vivo del checkout. Sin dependencias.
(function () {
  'use strict';

  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || '';
  var fmt = function (n) { return '$ ' + Math.round(n || 0).toLocaleString('es-CO') + ' COP'; };
  var track = function (name, data) { if (window.gzTrack) window.gzTrack(name, data); };

  function postJSON(url, body) {
    body._csrf = csrf;
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'X-CSRF-Token': csrf, 'X-Requested-With': 'fetch' },
      body: JSON.stringify(body),
    }).then(function (r) { return r.json(); });
  }

  function setCartCount(n) {
    document.querySelectorAll('[data-count="cart"]').forEach(function (b) { b.textContent = n; });
  }

  function toast(msg, isError) {
    if (typeof window.showToast === 'function') return window.showToast(msg, isError);
    alertLive(msg);
  }
  function alertLive(msg) {
    var el = document.getElementById('tn-live');
    if (!el) { el = document.createElement('p'); el.id = 'tn-live'; el.className = 'sr-only'; el.setAttribute('aria-live', 'polite'); document.body.appendChild(el); }
    el.textContent = msg;
  }

  function addToCart(payload, meta) {
    return postJSON('/cart/add', payload).then(function (data) {
      if (!data.ok) { toast(data.message || 'No se pudo agregar', true); return data; }
      setCartCount(data.cartCount);
      track('add_to_cart', { currency: 'COP', items: [{ item_id: payload.id, item_name: meta.name, quantity: Number(payload.qty) || 1 }] });
      if (data.redirect) { window.location.href = data.redirect; return data; }
      if (typeof window.openCartDrawer === 'function') {
        window.openCartDrawer({ name: meta.name, image: meta.image, price: meta.price, count: data.cartCount });
      } else {
        toast(data.message);
      }
      return data;
    }).catch(function () { toast('Error de conexión. Intenta de nuevo.', true); });
  }

  // ── Tarjetas ─────────────────────────────────────────────────────────
  document.addEventListener('click', function (e) {
    var buy = e.target.closest('[data-buy]');
    var add = e.target.closest('[data-add]');
    if (!buy && !add) return;
    e.preventDefault();
    var btn = buy || add;
    btn.disabled = true;
    var card = btn.closest('.tn-card, .lp-product');
    var addBtn = card && card.querySelector('[data-add]');
    var meta = { name: addBtn ? addBtn.dataset.name : '', image: addBtn ? addBtn.dataset.image : '', price: addBtn ? addBtn.dataset.price : '' };
    addToCart({ id: buy ? buy.dataset.buy : add.dataset.add, qty: 1, buyNow: !!buy }, meta)
      .finally(function () { btn.disabled = false; });
  });

  // Selects que se envían solos ("Mi moto").
  document.querySelectorAll('[data-autosubmit]').forEach(function (s) {
    s.addEventListener('change', function () { s.form.submit(); });
  });

  // ── Ficha: galería ───────────────────────────────────────────────────
  var mainImg = document.querySelector('[data-gallery-main]');
  document.querySelectorAll('.tn-thumb').forEach(function (t) {
    t.addEventListener('click', function () {
      if (!mainImg) return;
      mainImg.src = t.dataset.src;
      mainImg.alt = t.dataset.alt || '';
      document.querySelectorAll('.tn-thumb').forEach(function (x) { x.classList.toggle('is-active', x === t); });
    });
  });

  // ── Ficha: variantes, cantidad y compra ──────────────────────────────
  var form = document.querySelector('[data-buy-form]');
  if (form) {
    var variantsEl = form.querySelector('[data-variants]');
    var variants = variantsEl ? JSON.parse(variantsEl.textContent) : [];
    var variantInput = form.querySelector('[data-variant-input]');
    var qty = form.querySelector('input[name="qty"]');
    var priceNow = document.querySelector('[data-price-now]');
    var priceWas = document.querySelector('[data-price-was]');
    var stockEl = document.querySelector('[data-stock]');
    var hint = form.querySelector('[data-variant-hint]');
    var needColor = !!form.querySelector('input[name="opt_color"]');
    var needSize = !!form.querySelector('input[name="opt_size"]');

    function chosen() {
      if (!variants.length) return null;
      var c = (form.querySelector('input[name="opt_color"]:checked') || {}).value || '';
      var s = (form.querySelector('input[name="opt_size"]:checked') || {}).value || '';
      if ((needColor && !c) || (needSize && !s)) return undefined;
      return variants.find(function (v) { return (!needColor || v.color === c) && (!needSize || v.size === s); }) || false;
    }

    function syncVariant() {
      var v = chosen();
      // Opciones sin existencia: se marcan para no elegir combinaciones agotadas.
      form.querySelectorAll('input[name="opt_size"]').forEach(function (inp) {
        var c = (form.querySelector('input[name="opt_color"]:checked') || {}).value;
        var exists = variants.some(function (x) { return x.size === inp.value && (!needColor || !c || x.color === c) && (x.stock === null || x.stock > 0); });
        inp.closest('.tn-opt').classList.toggle('is-out', !exists);
      });
      if (!variants.length) return;
      if (v === undefined) { if (variantInput) variantInput.value = ''; return; }
      if (v === false) { variantInput.value = ''; if (hint) hint.textContent = 'Esa combinación no está disponible.'; return; }
      variantInput.value = v.id;
      if (priceNow) priceNow.textContent = v.finalText;
      if (priceWas) priceWas.textContent = v.final < v.base ? v.baseText : '';
      var out = v.stock === 0;
      if (stockEl) { stockEl.textContent = out ? 'Agotado en esta opción' : (v.stock !== null && v.stock <= 3 ? 'Últimas ' + v.stock + ' unidades' : 'Disponible'); stockEl.classList.toggle('is-out', out); }
      if (hint) hint.textContent = out ? 'Esta opción está agotada.' : 'Opción elegida: ' + [v.color, v.size].filter(Boolean).join(' / ');
      if (qty) qty.max = v.stock === null ? 99 : Math.max(1, v.stock);
      form.querySelectorAll('[data-buy-now],[data-add-cart]').forEach(function (b) { b.disabled = out; });
    }
    form.addEventListener('change', syncVariant);
    syncVariant();

    form.querySelectorAll('[data-qty]').forEach(function (b) {
      b.addEventListener('click', function () {
        var max = parseInt(qty.max, 10) || 99;
        qty.value = Math.max(1, Math.min(max, (parseInt(qty.value, 10) || 1) + parseInt(b.dataset.qty, 10)));
      });
    });

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      if (variants.length && !variantInput.value) {
        if (hint) { hint.textContent = 'Elige ' + (needColor && needSize ? 'color y talla' : needColor ? 'un color' : 'una talla') + ' antes de continuar.'; hint.classList.add('is-error'); }
        var first = form.querySelector('.tn-opts input');
        if (first) first.focus();
        return;
      }
      var buyNow = e.submitter && e.submitter.hasAttribute('data-buy-now');
      var install = form.querySelector('input[name="install"]');
      addToCart({
        id: form.dataset.product,
        variant: variantInput ? variantInput.value : '',
        qty: qty.value,
        install: install && install.checked ? '1' : '',
        buyNow: buyNow,
      }, { name: form.dataset.name, image: form.dataset.image, price: priceNow ? priceNow.textContent : '' });
    });

    // Barra de compra fija en móvil cuando los botones salen de pantalla.
    var sticky = document.querySelector('[data-sticky-buy]');
    var cta = form.querySelector('.tn-cta');
    if (sticky && cta && 'IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        sticky.hidden = entries[0].isIntersecting || entries[0].boundingClientRect.top > 0;
      }).observe(cta);
      sticky.querySelector('[data-sticky-go]').addEventListener('click', function () {
        if (variants.length) { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); return; }
        form.querySelector('[data-buy-now]').click();
      });
    }

    track('view_item', { currency: 'COP', items: [{ item_id: form.dataset.product, item_name: form.dataset.name }] });
  }

  // ── Checkout ─────────────────────────────────────────────────────────
  var co = document.querySelector('[data-checkout]');
  if (co) {
    var showShip = function () {
      var m = (co.querySelector('input[name="delivery_method"]:checked') || {}).value || '';
      co.querySelectorAll('[data-ship]').forEach(function (el) {
        var k = el.dataset.ship;
        el.hidden = !(k === m || (k === 'address' && (m === 'local' || m === 'national')));
      });
    };

    var dateSel = co.querySelector('[data-install-date]');
    var timeSel = co.querySelector('[data-install-time]');
    var fillSlots = function () {
      if (!dateSel || !timeSel) return;
      var opt = dateSel.selectedOptions[0];
      var slots = opt && opt.dataset.slots ? opt.dataset.slots.split(',') : [];
      var cur = timeSel.value || timeSel.dataset.current || '';
      timeSel.innerHTML = '<option value="">A cualquier hora</option>' + slots.map(function (s) {
        return '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + s + '</option>';
      }).join('');
    };

    var t = function (k) { return co.querySelector('[data-t="' + k + '"]'); };
    var couponMsg = co.querySelector('[data-coupon-msg]');
    var quote = function (fromCoupon) {
      var fd = new FormData(co);
      var body = {};
      ['delivery_method', 'delivery_zone', 'coupon', 'customer_email'].forEach(function (k) { body[k] = fd.get(k) || ''; });
      postJSON('/checkout/cotizar', body).then(function (q) {
        if (!q.ok) return;
        var disc = q.discounts.reduce(function (s, d) { return s + d.amount; }, 0);
        t('items').textContent = fmt(q.itemsSubtotal);
        t('discounts-wrap').hidden = !disc;
        t('discounts').textContent = '- ' + fmt(disc);
        var del = t('delivery');
        if (!body.delivery_method) del.textContent = 'Elige un método';
        else if (q.delivery && q.delivery.ok) del.textContent = q.delivery.fee ? fmt(q.delivery.fee) : 'Gratis';
        else del.textContent = (q.delivery && q.delivery.error) || 'Elige la localidad';
        t('total').textContent = fmt(q.total);
        var sav = t('savings');
        if (sav) { sav.hidden = !(q.savings > 0); sav.textContent = 'Ahorras ' + fmt(q.savings); }
        if (couponMsg && (fromCoupon || body.coupon)) {
          couponMsg.textContent = q.couponError ? q.couponError : (q.coupon ? 'Cupón ' + q.coupon + ' aplicado.' : '');
          couponMsg.classList.toggle('is-error', !!q.couponError);
        }
      }).catch(function () {});
    };

    co.addEventListener('change', function (e) {
      if (e.target.name === 'delivery_method') showShip();
      if (e.target === dateSel) fillSlots();
      if (['delivery_method', 'delivery_zone'].indexOf(e.target.name) >= 0) quote();
    });
    var applyBtn = co.querySelector('[data-apply-coupon]');
    if (applyBtn) applyBtn.addEventListener('click', function () { quote(true); });
    showShip();
    fillSlots();
    quote();
    track('begin_checkout', { currency: 'COP' });
  }
})();
