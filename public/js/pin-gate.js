'use strict';
// Gate de PIN para acciones sensibles. Cualquier <form data-require-pin> abre un
// modal que pide el PIN del empleado, lo verifica contra el servidor (AJAX) y,
// solo si es válido, inyecta el PIN en el formulario y lo envía. El servidor
// vuelve a exigir el PIN (defensa en profundidad); esto es solo la UX/feedback.
//
// Configuración por página:
//   window.PIN_VERIFY_URL  → endpoint que valida el PIN ('/admin/verificar-pin', …)
// Por formulario (opcional):
//   data-pin-title, data-pin-msg → textos del modal
(function () {
  var VERIFY_URL = window.PIN_VERIFY_URL || (document.body && document.body.dataset.pinVerifyUrl);
  var forms = Array.prototype.slice.call(document.querySelectorAll('form[data-require-pin]'));
  if (!VERIFY_URL || forms.length === 0) return;

  function csrfToken(form) {
    var meta = document.querySelector('meta[name="csrf-token"]');
    if (meta && meta.content) return meta.content;
    var input = (form && form.querySelector('input[name="_csrf"]')) || document.querySelector('input[name="_csrf"]');
    return input ? input.value : '';
  }

  // ── Modal (se construye una vez y se reutiliza) ──────────────────────────
  var style = document.createElement('style');
  style.textContent =
    '.pin-gate-wrap{position:fixed;inset:0;z-index:100000;display:flex;align-items:center;justify-content:center;padding:16px;opacity:0;pointer-events:none;transition:opacity .18s ease}' +
    '.pin-gate-wrap.open{opacity:1;pointer-events:auto}' +
    '.pin-gate-bd{position:absolute;inset:0;background:rgba(0,0,0,.5);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}' +
    '.pin-gate-card{position:relative;background:#fff;border-radius:18px;padding:26px 24px 22px;width:100%;max-width:360px;box-shadow:0 24px 60px rgba(0,0,0,.25);transform:scale(.94) translateY(8px);opacity:0;transition:transform .2s cubic-bezier(.34,1.3,.64,1),opacity .18s ease;font-family:Montserrat,system-ui,sans-serif}' +
    '.pin-gate-wrap.open .pin-gate-card{transform:scale(1) translateY(0);opacity:1}' +
    '.pin-gate-ic{width:46px;height:46px;border-radius:50%;background:#fff7ed;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;color:#F25C05}' +
    '.pin-gate-title{font-size:16px;font-weight:800;color:#111827;text-align:center;margin:0 0 6px}' +
    '.pin-gate-msg{font-size:13px;color:#6b7280;text-align:center;margin:0 0 16px;line-height:1.5}' +
    '.pin-gate-input{width:100%;box-sizing:border-box;text-align:center;letter-spacing:.5em;font-size:24px;font-weight:800;padding:12px;border:1.5px solid #e5e7eb;border-radius:12px;outline:none;font-family:inherit}' +
    '.pin-gate-input:focus{border-color:#F25C05}' +
    '.pin-gate-err{min-height:16px;font-size:12px;font-weight:700;color:#dc2626;text-align:center;margin:8px 0 0}' +
    '.pin-gate-actions{display:flex;gap:10px;margin-top:14px}' +
    '.pin-gate-btn{flex:1;padding:13px;border:none;border-radius:12px;font-size:14px;font-weight:800;cursor:pointer;font-family:inherit}' +
    '.pin-gate-cancel{background:#f3f4f6;color:#111}' +
    '.pin-gate-ok{background:#F25C05;color:#fff}' +
    '.pin-gate-ok:disabled{opacity:.6;cursor:default}';
  document.head.appendChild(style);

  var wrap = document.createElement('div');
  wrap.className = 'pin-gate-wrap';
  wrap.setAttribute('role', 'dialog');
  wrap.setAttribute('aria-modal', 'true');
  wrap.innerHTML =
    '<div class="pin-gate-bd" data-pin-cancel></div>' +
    '<div class="pin-gate-card">' +
      '<div class="pin-gate-ic"><svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg></div>' +
      '<h2 class="pin-gate-title"></h2>' +
      '<p class="pin-gate-msg"></p>' +
      '<input class="pin-gate-input" type="password" inputmode="numeric" autocomplete="off" maxlength="6" placeholder="••••" aria-label="PIN" />' +
      '<p class="pin-gate-err" role="alert"></p>' +
      '<div class="pin-gate-actions">' +
        '<button type="button" class="pin-gate-btn pin-gate-cancel" data-pin-cancel>Cancelar</button>' +
        '<button type="button" class="pin-gate-btn pin-gate-ok">Autorizar</button>' +
      '</div>' +
    '</div>';
  document.body.appendChild(wrap);

  var titleEl  = wrap.querySelector('.pin-gate-title');
  var msgEl    = wrap.querySelector('.pin-gate-msg');
  var inputEl  = wrap.querySelector('.pin-gate-input');
  var errEl    = wrap.querySelector('.pin-gate-err');
  var okBtn    = wrap.querySelector('.pin-gate-ok');
  var pending  = null;   // formulario a enviar tras verificar
  var submitter = null;  // botón que disparó el envío (conserva su name/value)

  function open(form, btn) {
    pending = form;
    submitter = btn || null;
    titleEl.textContent = form.dataset.pinTitle || 'Autoriza con tu PIN';
    msgEl.textContent   = form.dataset.pinMsg || 'Ingresa el PIN de tu empleado para registrar y confirmar esta acción.';
    inputEl.value = '';
    errEl.textContent = '';
    okBtn.disabled = false;
    wrap.classList.add('open');
    setTimeout(function () { inputEl.focus(); }, 60);
  }

  function close() {
    wrap.classList.remove('open');
    pending = null;
  }

  async function confirm() {
    if (!pending) return;
    var pin = (inputEl.value || '').trim();
    if (!/^\d{4,6}$/.test(pin)) { errEl.textContent = 'El PIN son 4 a 6 dígitos.'; return; }
    okBtn.disabled = true;
    errEl.textContent = '';
    try {
      var resp = await fetch(VERIFY_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken(pending) },
        body: JSON.stringify({ pin: pin }),
      });
      var data = await resp.json().catch(function () { return {}; });
      if (resp.ok && data.ok) {
        var form = pending;
        var field = form.querySelector('input[name="pin"].pin-gate-field');
        if (!field) {
          field = document.createElement('input');
          field.type = 'hidden';
          field.name = 'pin';
          field.className = 'pin-gate-field';
          form.appendChild(field);
        }
        field.value = pin;
        var btn = submitter;
        close();
        // requestSubmit re-dispara el evento submit (para que corran los
        // serializadores de ítems de la página); nuestro handler lo deja pasar
        // al detectar el campo pin ya inyectado. Se pasa el submitter original
        // para conservar su name/value (p. ej. <button name="status" value="…">).
        // Fallback a submit() en navegadores sin requestSubmit (el campo de ítems
        // ya quedó poblado en el 1er submit; los forms con botones-estado usan
        // requestSubmit en navegadores modernos).
        if (form.requestSubmit) form.requestSubmit(btn && form.contains(btn) ? btn : undefined);
        else form.submit();
        return;
      }
      errEl.textContent = data.error || 'No se pudo verificar el PIN.';
    } catch (e) {
      errEl.textContent = 'Error de red. Inténtalo de nuevo.';
    }
    okBtn.disabled = false;
  }

  forms.forEach(function (form) {
    form.addEventListener('submit', function (e) {
      // Otro handler ya bloqueó el envío (p. ej. validación de ítems vacíos):
      // no abrir el modal. Depende de que este listener corra después (el script
      // se carga al final de la página).
      if (e.defaultPrevented) return;
      // Si ya inyectamos el PIN (reenvío tras verificar), dejar pasar.
      if (form.querySelector('input[name="pin"].pin-gate-field')) return;
      e.preventDefault();
      open(form);
    });
  });

  okBtn.addEventListener('click', confirm);
  inputEl.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); confirm(); } });
  Array.prototype.forEach.call(wrap.querySelectorAll('[data-pin-cancel]'), function (el) {
    el.addEventListener('click', close);
  });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && wrap.classList.contains('open')) close(); });
})();
