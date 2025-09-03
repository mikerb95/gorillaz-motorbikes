document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('[data-nav]');
  if (!toggle || !nav) return;
  toggle.addEventListener('click', () => {
    const open = nav.getAttribute('data-open') === 'true';
    nav.setAttribute('data-open', String(!open));
    toggle.setAttribute('aria-expanded', String(!open));
  });
});

// Background slideshow for home hero
document.addEventListener('DOMContentLoaded', () => {
  const hero = document.querySelector('.hero[data-slideshow]');
  if (!hero) return;
  let slides;
  try { slides = JSON.parse(hero.getAttribute('data-slideshow') || '[]'); } catch { slides = []; }
  if (!Array.isArray(slides) || slides.length === 0) return;

  const container = hero.querySelector('.hero-slides');
  const els = slides.map((src, i) => {
    const el = document.createElement('div');
    el.className = 'hero-slide';
    el.style.backgroundImage = `url('${src}')`;
    if (i === 0) el.classList.add('is-active');
    container.appendChild(el);
    return el;
  });

  let idx = 0;
  const advance = () => {
    els[idx].classList.remove('is-active');
    idx = (idx + 1) % els.length;
    els[idx].classList.add('is-active');
  };
  setInterval(advance, 6000);
});
