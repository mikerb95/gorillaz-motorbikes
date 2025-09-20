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
    return el;
  };
  slides.forEach(s => deck.appendChild(makeSlide(s)));

  let idx = 0;
  const update = () => {
    deck.style.setProperty('--i', String(idx));
    Array.from(deck.children).forEach((el, i) => el.setAttribute('aria-hidden', i===idx? 'false':'true'));
  };
  update();

  const go = (d) => { idx = Math.max(0, Math.min(slides.length-1, idx + d)); update(); };
  const prev = () => go(-1), next = () => go(1);

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
})();
