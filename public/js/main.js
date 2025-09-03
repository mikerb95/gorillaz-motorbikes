document.addEventListener('DOMContentLoaded', () => {
  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('[data-nav]');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!open));
      toggle.setAttribute('aria-expanded', String(!open));
    });
  }

  // Build and animate the orange blob under brand and nav items
  const headerInner = document.querySelector('.header-inner');
  const logo = document.querySelector('.nav-center .logo') || document.querySelector('.logo');
  const links = Array.from(document.querySelectorAll('.nav-links a'));
  const ctaLinks = Array.from(document.querySelectorAll('.header-right a, .nav-cta a, .nav-cta form button, .header-right form button'));
  if (headerInner && logo) {
    const blob = document.createElement('div');
    blob.className = 'nav-blob';
    headerInner.appendChild(blob);

    const setToEl = (el) => {
      const rect = el.getBoundingClientRect();
      const host = headerInner.getBoundingClientRect();
      const padX = 24; // extra width for "splash" feel
      const padY = 10;
      const x = rect.left - host.left - padX/2;
      const y = rect.top - host.top + rect.height/2;
      const isLogo = el.classList.contains('logo') || el.closest('.logo');
      const baseW = Math.max(120, rect.width + padX);
      const w = isLogo ? Math.max(120, Math.min(160, baseW)) : baseW;
      const h = Math.max(32, rect.height + padY);
      blob.style.setProperty('--x', `${x}px`);
      blob.style.setProperty('--w', `${w}px`);
      blob.style.setProperty('--h', `${h}px`);
      blob.style.top = `${y}px`;
    };

    // Default position under the brand text (or full logo)
  const defaultTarget = logo;
    setToEl(defaultTarget);

    // Hover interactions (only on pointer-capable devices): move blob to hovered nav item
    const canHover = window.matchMedia && window.matchMedia('(pointer:fine)').matches;
    if (canHover) {
      const hoverables = [defaultTarget, ...links, ...ctaLinks];
      hoverables.forEach((el) => {
        el.addEventListener('mouseenter', () => setToEl(el));
        el.addEventListener('focus', () => setToEl(el));
      });
      headerInner.addEventListener('mouseleave', () => setToEl(defaultTarget));
    }

    // Keep blob responsive on resize
    window.addEventListener('resize', () => setToEl(defaultTarget));
  }
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
