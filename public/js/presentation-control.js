(function () {
  const root = document.querySelector('.ctrl-wrap');
  if (!root) return;
  const code = root.getAttribute('data-ctrl-code');
  let index = Number(root.getAttribute('data-ctrl-index')) || 0;
  let total = Number(root.getAttribute('data-ctrl-total')) || 1;

  const progressEl = document.querySelector('[data-ctrl="progress"]');
  const prevBtn = document.querySelector('[data-ctrl="prev"]');
  const nextBtn = document.querySelector('[data-ctrl="next"]');
  const toastEl = document.querySelector('[data-ctrl="toast"]');

  const update = () => {
    if (progressEl) progressEl.textContent = `${index + 1} / ${total}`;
    if (prevBtn) prevBtn.disabled = index <= 0;
    if (nextBtn) nextBtn.disabled = index >= total - 1;
  };
  update();

  let toastTimer = null;
  const toast = (msg) => {
    if (!toastEl) return;
    toastEl.textContent = msg;
    toastEl.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-visible'), 2200);
  };

  let busy = false;
  const nav = async (dir) => {
    if (busy) return;
    busy = true;
    try {
      const csrfToken = document.querySelector('meta[name="csrf-token"]')?.content || '';
      const res = await fetch(`/api/presentacion/${code}/nav`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken },
        body: JSON.stringify({ dir }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        toast(data.error === 'Sesión expirada' ? 'La sesión expiró. Vuelve a conectar desde el PC.' : 'No se pudo enviar el comando.');
        return;
      }
      index = data.index;
      total = data.total;
      update();
    } catch {
      toast('Sin conexión. Intenta de nuevo.');
    } finally {
      busy = false;
    }
  };

  if (prevBtn) prevBtn.addEventListener('click', () => nav(-1));
  if (nextBtn) nextBtn.addEventListener('click', () => nav(1));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') nav(1);
    if (e.key === 'ArrowLeft') nav(-1);
  });
})();
