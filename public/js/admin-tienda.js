// Admin de productos: filas dinámicas (variantes, compatibilidad), fotos con
// reducción a WebP en el navegador antes de subirlas y vista previa de precios.
(function () {
  'use strict';
  var form = document.querySelector('[data-admin-product]');
  if (!form) return;
  var csrf = (document.querySelector('meta[name="csrf-token"]') || {}).content || form.querySelector('input[name="_csrf"]').value;
  var fmt = function (n) { return '$ ' + Math.round(n || 0).toLocaleString('es-CO') + ' COP'; };

  // Reindexa los name="grupo[i][campo]" tras agregar/quitar/mover filas.
  function reindex(container, group) {
    container.querySelectorAll(group === 'images' ? '.ash-img' : 'tbody tr').forEach(function (row, i) {
      row.querySelectorAll('[name^="' + group + '["]').forEach(function (inp) {
        inp.name = inp.name.replace(new RegExp('^' + group + '\\[\\d+\\]'), group + '[' + i + ']');
      });
    });
  }

  var variants = form.querySelector('[data-variants]');
  form.querySelector('[data-add-variant]').addEventListener('click', function () {
    var i = variants.querySelectorAll('tbody tr').length;
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><input type="hidden" name="variants[' + i + '][id]" value="" /><input name="variants[' + i + '][color]" /></td>' +
      '<td><input name="variants[' + i + '][size]" /></td><td><input name="variants[' + i + '][sku]" /></td>' +
      '<td><input name="variants[' + i + '][price]" inputmode="numeric" /></td><td><input name="variants[' + i + '][stock]" type="number" min="0" /></td>' +
      '<td><button type="button" class="btn btn-ghost btn-xs" data-remove-row>Quitar</button></td>';
    variants.querySelector('tbody').appendChild(tr);
    tr.querySelector('input:not([type=hidden])').focus();
  });

  var compat = form.querySelector('[data-compat]');
  var addCompat = form.querySelector('[data-add-compat]');
  if (addCompat) addCompat.addEventListener('click', function () {
    var i = compat.querySelectorAll('tbody tr').length;
    var opts = form.querySelector('[data-compat-options]').innerHTML;
    var tr = document.createElement('tr');
    tr.innerHTML = '<td><select name="compat[' + i + '][model]">' + opts + '</select></td>' +
      '<td><input name="compat[' + i + '][from]" type="number" /></td><td><input name="compat[' + i + '][to]" type="number" /></td>' +
      '<td><button type="button" class="btn btn-ghost btn-xs" data-remove-row>Quitar</button></td>';
    compat.querySelector('tbody').appendChild(tr);
  });

  var images = form.querySelector('[data-images]');
  form.addEventListener('click', function (e) {
    var t = e.target;
    if (t.matches('[data-remove-row]')) {
      var table = t.closest('table');
      t.closest('tr').remove();
      reindex(table, table.matches('[data-variants]') ? 'variants' : 'compat');
    }
    var card = t.closest('.ash-img');
    if (!card) return;
    if (t.matches('[data-remove-img]')) card.remove();
    if (t.matches('[data-img-left]') && card.previousElementSibling) images.insertBefore(card, card.previousElementSibling);
    if (t.matches('[data-img-right]') && card.nextElementSibling) images.insertBefore(card.nextElementSibling, card);
    reindex(images, 'images');
  });

  function addImage(url) {
    var i = images.querySelectorAll('.ash-img').length;
    var div = document.createElement('div');
    div.className = 'ash-img';
    div.innerHTML = '<img src="" alt="" /><input type="hidden" name="images[' + i + '][url]" /><input name="images[' + i + '][alt]" placeholder="Texto alternativo" />' +
      '<div class="ash-img-actions"><button type="button" data-img-left title="Mover antes">&lt;</button><button type="button" data-img-right title="Mover después">&gt;</button><button type="button" data-remove-img title="Quitar">x</button></div>';
    div.querySelector('img').src = url;
    div.querySelector('input[type=hidden]').value = url;
    div.querySelector('input[name$="[alt]"]').value = (form.querySelector('input[name="name"]').value || '').trim();
    images.appendChild(div);
  }

  // Reduce a WebP de máximo 1600 px para que la ficha cargue rápido en móvil.
  function toWebP(file) {
    return new Promise(function (resolve) {
      var img = new Image();
      img.onload = function () {
        var max = 1600;
        var scale = Math.min(1, max / Math.max(img.width, img.height));
        var c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        c.toBlob(function (blob) { resolve(blob ? new File([blob], 'foto.webp', { type: 'image/webp' }) : file); }, 'image/webp', 0.82);
        URL.revokeObjectURL(img.src);
      };
      img.onerror = function () { resolve(file); };
      img.src = URL.createObjectURL(file);
    });
  }

  var upload = form.querySelector('[data-upload]');
  var status = form.querySelector('[data-upload-status]');
  upload.addEventListener('change', function () {
    var files = Array.prototype.slice.call(upload.files, 0, 5);
    if (!files.length) return;
    status.textContent = 'Subiendo ' + files.length + ' foto(s)...';
    Promise.all(files.map(toWebP)).then(function (ready) {
      var fd = new FormData();
      ready.forEach(function (f) { fd.append('images', f, f.name); });
      fd.append('_csrf', csrf);
      return fetch('/admin/tienda/upload-image', { method: 'POST', headers: { 'X-CSRF-Token': csrf }, body: fd });
    }).then(function (r) { return r.json(); }).then(function (data) {
      (data.urls || []).forEach(addImage);
      status.textContent = data.urls && data.urls.length ? 'Listo. Recuerda guardar el producto.' : 'No se pudo subir. Revisa el formato.';
      upload.value = '';
    }).catch(function () { status.textContent = 'Error al subir las fotos.'; });
  });

  var price = form.querySelector('[data-price]');
  var disc = form.querySelector('[data-discount]');
  var club = form.querySelector('[data-club]');
  var preview = form.querySelector('[data-price-preview]');
  function updatePreview() {
    var p = parseInt(String(price.value).replace(/\D/g, ''), 10) || 0;
    var d = Math.min(100, parseInt(disc.value, 10) || 0);
    var c = Math.min(100, parseInt(club.value, 10) || 0);
    var txt = 'Precio en la tienda: ' + fmt(Math.round(p * (1 - d / 100)));
    if (d) txt += ' (antes ' + fmt(p) + ')';
    if (c > d) txt += '. Precio club: ' + fmt(Math.round(p * (1 - c / 100)));
    preview.textContent = txt;
  }
  [price, disc, club].forEach(function (el) { el.addEventListener('input', updatePreview); });
  updatePreview();
})();
