'use strict';
// Teclado virtual propio del panel /kds. Cualquier campo con [data-kds-kbd] se vuelve
// readonly y, al tocarlo, abre este panel en vez de activar el teclado nativo de la
// tablet. Layout QWERTY por defecto; [data-kds-kbd="numeric"] muestra solo 1-0
// (usado por el PIN gate). Escribe directo sobre el input/textarea original y
// dispara eventos input/change reales para que el resto del código de la página
// (autouppercase de placa, autosugerencia de marca/modelo, etc.) siga funcionando.
(function () {
  if (window.KDSKeyboard) return;

  var QWERTY_ROWS = [
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
    ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
    ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ñ'],
    ['z', 'x', 'c', 'v', 'b', 'n', 'm', '.', '-', '+']
  ];
  var NUMERIC_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

  var style = document.createElement('style');
  style.textContent =
    '.kds-vkb-wrap{position:fixed;inset:0;z-index:100000;display:flex;align-items:flex-end;justify-content:center;opacity:0;pointer-events:none;transition:opacity .15s ease}' +
    '.kds-vkb-wrap.open{opacity:1;pointer-events:auto}' +
    '.kds-vkb-bd{position:absolute;inset:0;background:rgba(0,0,0,.5)}' +
    '.kds-vkb-panel{position:relative;width:100%;max-width:780px;background:#0f1012;border:1px solid var(--kds-line,#2d3035);border-bottom:0;border-radius:16px 16px 0 0;padding:14px 14px calc(14px + env(safe-area-inset-bottom));box-shadow:0 -12px 40px rgba(0,0,0,.45);font-family:var(--kds-font,system-ui,sans-serif)}' +
    '.kds-vkb-preview{background:var(--kds-paper,#f3f1eb);border-radius:10px;padding:10px 12px 10px 16px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;gap:12px}' +
    '.kds-vkb-label{font:600 13px/1 var(--kds-cond,sans-serif);color:#6b665c;text-transform:uppercase;letter-spacing:.1em;margin-bottom:4px}' +
    '.kds-vkb-value{font-size:24px;font-weight:600;color:var(--kds-ink,#141414);flex:1;word-break:break-word;min-height:28px}' +
    '.kds-vkb-done{flex:none;background:var(--kds-brand,#F25C05);color:var(--kds-ink,#141414);border:none;border-radius:10px;padding:14px 22px;font:700 20px/1 var(--kds-cond,sans-serif);text-transform:uppercase;letter-spacing:.05em;cursor:pointer}' +
    '.kds-vkb-row{display:flex;gap:6px;margin-bottom:6px}' +
    '.kds-vkb-row:last-child{margin-bottom:0}' +
    '.kds-vkb-row:nth-child(2){margin-left:5%;width:95%}' +
    '.kds-vkb-row:nth-child(3){margin-left:7.5%;width:92.5%}' +
    '.kds-vkb-row:nth-child(4){margin-left:10%;width:90%}' +
    '.kds-vkb-key{flex:1;padding:14px 0;font:700 24px/1 var(--kds-cond,sans-serif);background:var(--kds-bg-3,#272a2e);color:var(--kds-text,#ecebe6);border:1px solid var(--kds-line,#2d3035);border-radius:8px;cursor:pointer;text-transform:uppercase;transition:transform .08s ease}' +
    '.kds-vkb-key:active{background:#3a3e44;transform:scale(.94)}' +
    '.kds-vkb-key.wide{flex:3}' +
    '.kds-vkb-key.action{background:transparent;color:var(--kds-text-2,#a6a9ae);flex:1.5;font:600 16px/1 var(--kds-font,sans-serif);text-transform:none}' +
    '.kds-vkb-key.action.on{background:var(--kds-brand,#F25C05);color:var(--kds-ink,#141414);border-color:var(--kds-brand,#F25C05)}' +
    '.kds-vkb-row:nth-child(1) .kds-vkb-key{background:#1d1f22}' +
    '.kds-vkb-numgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}' +
    '.kds-vkb-numgrid .kds-vkb-key{padding:18px 0;font-size:30px}';
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.className = 'kds-vkb-wrap';
  wrap.innerHTML =
    '<div class="kds-vkb-bd"></div>' +
    '<div class="kds-vkb-panel">' +
      '<div class="kds-vkb-preview">' +
        '<div><div class="kds-vkb-label"></div><div class="kds-vkb-value"></div></div>' +
        '<button type="button" class="kds-vkb-done">Listo</button>' +
      '</div>' +
      '<div class="kds-vkb-keys"></div>' +
    '</div>';
  document.body.appendChild(wrap);

  var labelEl = wrap.querySelector('.kds-vkb-label');
  var valueEl = wrap.querySelector('.kds-vkb-value');
  var keysEl  = wrap.querySelector('.kds-vkb-keys');
  var doneBtn = wrap.querySelector('.kds-vkb-done');

  var target = null;
  var numeric = false;
  var shift = false;

  function addKey(rowEl, label, opts) {
    opts = opts || {};
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'kds-vkb-key' + (opts.cls ? ' ' + opts.cls : '');
    btn.textContent = label;
    btn.addEventListener('click', opts.onClick || function () { insert(label); });
    rowEl.appendChild(btn);
    return btn;
  }

  function renderKeys() {
    keysEl.innerHTML = '';
    if (numeric) {
      var grid = document.createElement('div');
      grid.className = 'kds-vkb-numgrid';
      NUMERIC_KEYS.forEach(function (d) { addKey(grid, d); });
      keysEl.appendChild(grid);
      return;
    }

    QWERTY_ROWS.forEach(function (row, i) {
      var rowEl = document.createElement('div');
      rowEl.className = 'kds-vkb-row';
      if (i === 3) {
        addKey(rowEl, '⇧', { cls: 'action' + (shift ? ' on' : ''), onClick: toggleShift });
      }
      row.forEach(function (ch) {
        var label = /[a-zñ]/.test(ch) && shift ? ch.toUpperCase() : ch;
        addKey(rowEl, label);
      });
      if (i === 3) {
        addKey(rowEl, '⌫', { cls: 'action', onClick: backspace });
      }
      keysEl.appendChild(rowEl);
    });

    var lastRow = document.createElement('div');
    lastRow.className = 'kds-vkb-row';
    addKey(lastRow, 'espacio', { cls: 'wide', onClick: function () { insert(' '); } });
    keysEl.appendChild(lastRow);
  }

  function toggleShift() { shift = !shift; renderKeys(); }

  function syncPreview() {
    var v = target ? target.value || '' : '';
    valueEl.textContent = numeric ? v.replace(/./g, '•') : (v || ' ');
  }

  function insert(ch) {
    if (!target) return;
    var v = target.value || '';
    var max = target.getAttribute('maxlength');
    if (max && v.length >= Number(max)) return;
    target.value = v + ch;
    fire('input');
    syncPreview();
  }

  function backspace() {
    if (!target) return;
    target.value = (target.value || '').slice(0, -1);
    fire('input');
    syncPreview();
  }

  function fire(type) {
    target.dispatchEvent(new Event(type, { bubbles: true }));
  }

  function open(el, opts) {
    target = el;
    numeric = (opts && opts.type) === 'numeric';
    shift = false;
    labelEl.textContent = (opts && opts.label) || el.getAttribute('data-kds-label') || '';
    renderKeys();
    syncPreview();
    wrap.classList.add('open');
    fire('focus');
  }

  function close() {
    if (target) fire('change');
    wrap.classList.remove('open');
    target = null;
  }

  wrap.querySelector('.kds-vkb-bd').addEventListener('click', close);
  doneBtn.addEventListener('click', close);

  function attach(el, opts) {
    opts = opts || {};
    el.setAttribute('readonly', 'readonly');
    el.addEventListener('click', function (e) {
      e.preventDefault();
      if (el.hasAttribute('data-kds-locked')) return;
      open(el, opts);
    });
  }

  function autoAttach() {
    Array.prototype.forEach.call(document.querySelectorAll('[data-kds-kbd]'), function (el) {
      attach(el, { type: el.getAttribute('data-kds-kbd'), label: el.getAttribute('data-kds-label') });
    });
  }

  window.KDSKeyboard = { attach: attach, open: open, close: close };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoAttach);
  } else {
    autoAttach();
  }
})();
