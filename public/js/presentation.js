(function(){
  const root = document.querySelector('.presentation');
  if (!root) return;
  const slides = (() => {
    try { return JSON.parse(root.getAttribute('data-slides')||'[]') } catch { return [] }
  })();
  const deck = document.getElementById('deck');
  const makeSlide = (s) => {
    const el = document.createElement('section');
    el.className = 'slide';
    if (s.h1){ const h = document.createElement('h1'); h.textContent = s.h1; el.appendChild(h); }
    if (s.h2){ const h = document.createElement('h2'); h.textContent = s.h2; el.appendChild(h); }
    if (s.p){ const p = document.createElement('p'); p.textContent = s.p; el.appendChild(p); }
    if (Array.isArray(s.ul)){
      const ul = document.createElement('ul');
      s.ul.forEach(t => { const li = document.createElement('li'); li.textContent = t; ul.appendChild(li);});
      el.appendChild(ul);
    }
    if (s.img) {
      const img = document.createElement('img');
      img.src = s.img;
      img.className = 'slide-img';
      img.alt = '';
      img.onerror = function() { this.style.display = 'none'; };
      el.appendChild(img);
    }
    return el;
  };
  slides.forEach(s => deck.appendChild(makeSlide(s)));

  let idx = 0;
  const progressEl = document.querySelector('[data-pres="progress"]');
  const update = () => {
    deck.style.setProperty('--i', String(idx));
    Array.from(deck.children).forEach((el, i) => el.setAttribute('aria-hidden', i===idx? 'false':'true'));
    if (progressEl) progressEl.textContent = slides.length ? `${idx + 1} / ${slides.length}` : '';
  };
  update();

  // Control remoto: un celular emparejado por código puede empujar next/prev.
  // La sesión vive en BD (sin websockets, no viables en serverless); este PC
  // hace polling cada 1s para reflejar los comandos del celular, y empuja su
  // propio índice al navegar localmente para que el celular vea el mismo estado.
  let sessionCode = null;
  let pollTimer = null;
  const csrfToken = () => document.querySelector('meta[name="csrf-token"]')?.content || '';

  const pushIndex = () => {
    if (!sessionCode) return;
    fetch(`/api/presentacion/${sessionCode}/set`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrfToken() },
      body: JSON.stringify({ index: idx }),
    }).catch(() => {});
  };

  const setIndex = (newIdx, push) => {
    idx = Math.max(0, Math.min(slides.length - 1, newIdx));
    update();
    if (push) pushIndex();
  };

  const go = (d) => setIndex(idx + d, true);
  const prev = () => go(-1), next = () => go(1);

  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(async () => {
      if (!sessionCode) return;
      try {
        const res = await fetch(`/api/presentacion/${sessionCode}/estado`);
        const data = await res.json();
        if (data.ok && data.index !== idx) setIndex(data.index, false);
      } catch { /* red intermitente: se reintenta en el próximo tick */ }
    }, 1000);
  };

  const remoteBtn   = document.querySelector('[data-pres="remote"]');
  const remoteModal = document.querySelector('[data-pres="remote-modal"]');
  const remoteClose = document.querySelector('[data-pres="remote-close"]');
  const remoteCode  = document.querySelector('[data-pres="remote-code"]');
  const remoteQr    = document.querySelector('[data-pres="remote-qr"]');
  if (remoteBtn) {
    remoteBtn.addEventListener('click', async () => {
      if (!sessionCode) {
        try {
          const res = await fetch(`/clases/${root.dataset.course}/${root.dataset.topic}/control/iniciar`, {
            method: 'POST',
            headers: { 'X-CSRF-Token': csrfToken() },
          });
          const data = await res.json();
          if (data.ok) {
            sessionCode = data.code;
            pushIndex();
            startPolling();
          }
        } catch { /* el botón queda disponible para reintentar */ }
      }
      if (sessionCode && remoteModal) {
        if (remoteCode) remoteCode.textContent = sessionCode;
        if (remoteQr) remoteQr.src = `/clases/control/${sessionCode}/qr.png`;
        remoteModal.hidden = false;
      }
    });
  }
  if (remoteClose) remoteClose.addEventListener('click', () => { remoteModal.hidden = true; });

  // Buttons
  document.querySelector('[data-pres="prev"]').addEventListener('click', prev);
  document.querySelector('[data-pres="next"]').addEventListener('click', next);
  document.querySelector('[data-pres="fs"]').addEventListener('click', () => {
    const el = document.documentElement;
    if (!document.fullscreenElement) el.requestFullscreen().catch(()=>{});
    else document.exitFullscreen().catch(()=>{});
  });

  // Keyboard
  const onKey = (e) => {
    if (e.key === 'ArrowRight') { next(); e.preventDefault(); }
    if (e.key === 'ArrowLeft') { prev(); e.preventDefault(); }
    if (e.key.toLowerCase() === 'f') { document.querySelector('[data-pres="fs"]').click(); e.preventDefault(); }
  };
  window.addEventListener('keydown', onKey);

  // Prevent scroll
  document.body.style.overflow = 'hidden';
  window.addEventListener('beforeunload', () => { document.body.style.overflow = ''; });

  // Floating logo island: tap to expand/collapse on touch devices (no hover)
  const header = document.querySelector('.site-header');
  const logo = header && header.querySelector('.logo');
  if (header && logo) {
    logo.addEventListener('click', (e) => {
      if (!window.matchMedia('(hover: none)').matches) return;
      e.preventDefault();
      header.classList.toggle('is-expanded');
    });
    document.addEventListener('click', (e) => {
      if (header.classList.contains('is-expanded') && !header.contains(e.target)) {
        header.classList.remove('is-expanded');
      }
    });
  }
})();
