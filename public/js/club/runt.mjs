// Garaje del club: vencimiento del SOAT y la tecnomecánica desde el RUNT.
//   - Con proveedor con API (lo normal): las motos sin consultar se consultan
//     solas al abrir el panel, y "Actualizar ahora" fuerza una consulta.
//   - Sin proveedor (respaldo): modal con el captcha del RUNT.
// El miembro nunca escribe fechas.

const csrf = document.querySelector('input[name="_csrf"]')?.value || '';

async function syncPlate(plate) {
  const res = await fetch('/club/vehiculos/runt-sync', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
    body: JSON.stringify({ plate }),
  });
  return res.json().catch(() => ({ ok: false }));
}

const autos = [...document.querySelectorAll('[data-runt-auto]')];
if (autos.length) {
  // En serie: el servidor guarda todo en el mismo registro del usuario.
  (async () => {
    let changed = false;
    for (const box of autos) {
      const json = await syncPlate(box.dataset.runtAuto).catch(() => ({ ok: false }));
      if (json.ok && json.status !== 'error') changed = true;
      else {
        const msg = box.querySelector('[data-runt-msg]');
        if (msg) msg.textContent = 'El RUNT no respondió. Lo intentamos de nuevo más tarde.';
      }
    }
    if (changed) { location.hash = 'garaje'; location.reload(); }
  })();
}

document.querySelectorAll('[data-runt-sync]').forEach((btn) => {
  btn.addEventListener('click', async () => {
    btn.setAttribute('aria-busy', 'true');
    btn.textContent = 'Consultando…';
    const json = await syncPlate(btn.dataset.runtSync).catch(() => ({ ok: false }));
    if (json.ok) { location.hash = 'garaje'; location.reload(); return; }
    btn.removeAttribute('aria-busy');
    btn.textContent = json.error || 'No se pudo consultar. Intenta más tarde.';
  });
});

const modal = document.getElementById('runt-modal');
const form = document.getElementById('runt-form');

if (modal && form) {
  const img = form.querySelector('.clp-runt-img img');
  const imgBox = form.querySelector('.clp-runt-img');
  const status = form.querySelector('[data-runt-status]');
  const errorBox = form.querySelector('.clp-runt-error');
  const submit = form.querySelector('button[type="submit"]');
  let captchaId = null;

  const showError = (msg) => {
    errorBox.textContent = msg;
    errorBox.hidden = !msg;
  };

  async function loadCaptcha() {
    captchaId = null;
    form.captcha.value = '';
    img.hidden = true;
    status.hidden = false;
    status.textContent = 'Cargando…';
    imgBox.setAttribute('aria-busy', 'true');
    try {
      const res = await fetch('/runt/captcha', { headers: { accept: 'application/json' } });
      const json = await res.json();
      if (!json.ok || !json.imagen) throw new Error(json.error || 'sin imagen');
      captchaId = json.idLibreCaptcha;
      img.src = json.imagen.startsWith('data:') ? json.imagen : `data:image/png;base64,${json.imagen}`;
      img.hidden = false;
      status.hidden = true;
    } catch {
      status.textContent = 'El RUNT no respondió. Toca para reintentar.';
    } finally {
      imgBox.removeAttribute('aria-busy');
    }
  }

  document.querySelectorAll('[data-runt-plate]').forEach((btn) => {
    btn.addEventListener('click', () => {
      form.plate.value = btn.dataset.runtPlate;
      form.querySelector('[data-runt-label]').textContent = btn.dataset.runtPlate;
      showError('');
      loadCaptcha();
      setTimeout(() => (form.documento.value ? form.captcha : form.documento).focus(), 50);
    });
  });

  imgBox.addEventListener('click', loadCaptcha);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    if (!captchaId) return showError('Espera a que cargue la imagen.');
    submit.disabled = true;
    submit.textContent = 'Consultando…';
    try {
      const res = await fetch('/club/vehiculos/runt', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-csrf-token': csrf },
        body: JSON.stringify({
          plate: form.plate.value,
          documento: form.documento.value.trim(),
          idLibreCaptcha: captchaId,
          captcha: form.captcha.value.trim(),
        }),
      });
      const json = await res.json().catch(() => ({ ok: false }));
      if (!json.ok) {
        showError(json.error || 'No se pudo consultar. Intenta de nuevo.');
        loadCaptcha();
        return;
      }
      if (!json.soat && !json.tecno) {
        showError(json.message || 'El RUNT no devolvió fechas para esta moto.');
        loadCaptcha();
        return;
      }
      location.hash = 'garaje';
      location.reload();
    } catch {
      showError('Error de red. Revisa tu conexión.');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Consultar';
    }
  });
}
