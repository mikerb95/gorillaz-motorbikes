document.addEventListener('DOMContentLoaded', () => {
  // Dynamically set header offset so content doesn't sit under the fixed header
  const setHeaderOffset = () => {
    const header = document.querySelector('.site-header');
    if (!header) return;
    const rect = header.getBoundingClientRect();
    const h = Math.ceil(rect.height);
    document.documentElement.style.setProperty('--header-offset', h + 'px');
  };
  setHeaderOffset();
  // Recalculate after layout settles and on resize
  setTimeout(setHeaderOffset, 100);
  window.addEventListener('resize', setHeaderOffset);

  // Mark when page has a full-bleed hero to adjust layout via CSS
  if (document.querySelector('.hero')) {
    document.body.classList.add('has-hero');
  }

  const toggle = document.querySelector('.nav-toggle');
  const nav = document.querySelector('[data-nav]');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = nav.getAttribute('data-open') === 'true';
      nav.setAttribute('data-open', String(!open));
      toggle.setAttribute('aria-expanded', String(!open));
      // Recompute in case header height changes due to wrap or scrollbar
      setHeaderOffset();
    });
  }

  // Build and animate the orange blob under brand and nav items (hidden by default)
  const headerInner = document.querySelector('.header-inner');
  const logo = document.querySelector('.nav-center .logo') || document.querySelector('.logo');
  const links = Array.from(document.querySelectorAll('.nav-links a'));
  const ctaLinks = Array.from(document.querySelectorAll('.header-right a, .nav-cta a, .nav-cta form button, .header-right form button'));
  if (headerInner && logo) {
    const blob = document.createElement('div');
    blob.className = 'nav-blob';
    headerInner.appendChild(blob);

    let lastEl = null;
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
      // default: gradient mode
      blob.classList.remove('is-label');
      blob.textContent = '';
      logo.classList.remove('is-hidden');
      lastEl = el;
    };
    const showFor = (el) => {
      setToEl(el);
      blob.classList.add('is-visible');
    };
    const hideBlob = () => {
      blob.classList.remove('is-visible');
      blob.classList.remove('is-label');
      blob.textContent = '';
      logo.classList.remove('is-hidden');
    };

    // Hover interactions (only on pointer-capable devices): move blob to hovered nav item
    const canHover = window.matchMedia && window.matchMedia('(pointer:fine)').matches;
    if (canHover) {
      const hoverables = [logo, ...links, ...ctaLinks];
      hoverables.forEach((el) => {
        el.addEventListener('mouseenter', () => showFor(el));
        el.addEventListener('focus', () => showFor(el));
      });
      headerInner.addEventListener('mouseleave', hideBlob);

      // Special behavior for logo: hide the image and show the inline text; no blob overlay
      logo.addEventListener('mouseenter', () => {
        hideBlob();
        logo.classList.add('is-hidden');
      });
      logo.addEventListener('mouseleave', () => {
        hideBlob();
        logo.classList.remove('is-hidden');
      });
    }

    // Also support keyboard focus for accessibility (works regardless of pointer type)
    logo.addEventListener('focus', () => {
      hideBlob();
      logo.classList.add('is-hidden');
    });
    logo.addEventListener('blur', () => {
      hideBlob();
      logo.classList.remove('is-hidden');
    });

    // Keep blob responsive on resize
    window.addEventListener('resize', () => {
      if (blob.classList.contains('is-visible') && lastEl) setToEl(lastEl);
    });
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

// Inline calendar for Services scheduling
document.addEventListener('DOMContentLoaded', () => {
  const calHost = document.querySelector('#calendar[data-calendar]');
  if (!calHost) return;
  const input = document.getElementById('date');
  const selectedText = document.getElementById('selectedDateText');

  const state = { date: new Date() };
  state.date.setHours(0,0,0,0);
  let current = new Date(state.date);

  const fmt = (d) => d.toISOString().slice(0,10);
  const wk = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];

  const render = () => {
    calHost.innerHTML = '';
    const head = document.createElement('div');
    head.className = 'cal-head';
    const month = current.toLocaleString('es-CO', { month: 'long', year: 'numeric' });
    const prev = document.createElement('button'); prev.type='button'; prev.textContent='‹';
    const next = document.createElement('button'); next.type='button'; next.textContent='›';
    const title = document.createElement('div'); title.textContent = month.charAt(0).toUpperCase() + month.slice(1);
    head.append(prev, title, next);
    calHost.appendChild(head);

    const grid = document.createElement('div');
    grid.className = 'cal-grid';
    wk.forEach(w => { const el = document.createElement('div'); el.className='cal-weekday'; el.textContent=w; grid.appendChild(el); });

    const first = new Date(current.getFullYear(), current.getMonth(), 1);
    const startDay = (first.getDay() + 6) % 7; // make Monday=0
    const daysInMonth = new Date(current.getFullYear(), current.getMonth()+1, 0).getDate();
    const today = new Date(); today.setHours(0,0,0,0);
    const minDate = today; // no past dates

    for (let i=0;i<startDay;i++) {
      const blank = document.createElement('div'); blank.className='cal-day is-disabled'; blank.textContent=''; grid.appendChild(blank);
    }
    for (let d=1; d<=daysInMonth; d++){
      const date = new Date(current.getFullYear(), current.getMonth(), d);
      const el = document.createElement('button'); el.type='button'; el.className='cal-day'; el.textContent=String(d);
      if (fmt(date) === fmt(today)) el.classList.add('is-today');
      const isPast = date < minDate;
      if (isPast) { el.classList.add('is-disabled'); el.disabled = true; }
      if (input.value && fmt(date) === input.value) el.classList.add('is-selected');
      el.addEventListener('click', () => {
        input.value = fmt(date);
        selectedText.textContent = 'Fecha seleccionada: ' + date.toLocaleDateString('es-CO', { weekday:'long', year:'numeric', month:'long', day:'numeric' });
        render();
      });
      grid.appendChild(el);
    }
    calHost.appendChild(grid);

    prev.addEventListener('click', () => { current.setMonth(current.getMonth()-1); render(); });
    next.addEventListener('click', () => { current.setMonth(current.getMonth()+1); render(); });
  };

  render();
});

// Lightweight modal controller (open/close via data attributes)
document.addEventListener('DOMContentLoaded', () => {
  const openers = document.querySelectorAll('[data-modal-open]');
  openers.forEach(btn => {
    btn.addEventListener('click', () => {
      const sel = btn.getAttribute('data-modal-open');
      const modal = sel ? document.querySelector(sel) : null;
      if (!modal) return;
      modal.setAttribute('aria-hidden', 'false');
    });
  });
  const closers = document.querySelectorAll('[data-modal-close]');
  closers.forEach(el => {
    el.addEventListener('click', () => {
      const modal = el.closest('.modal');
      if (!modal) return;
      modal.setAttribute('aria-hidden', 'true');
    });
  });
  // Close on Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape'){
      document.querySelectorAll('.modal[aria-hidden="false"]').forEach(m => m.setAttribute('aria-hidden','true'));
    }
  });
});

// CSRF helper and destructive action confirms
document.addEventListener('DOMContentLoaded', () => {
  // Inject CSRF token into all POST forms automatically
  const meta = document.querySelector('meta[name="csrf-token"]');
  const token = meta && meta.getAttribute('content');
  if (token) {
    document.querySelectorAll('form[method="post" i]').forEach(form => {
      if (!form.querySelector('input[name="_csrf"]')){
        const input = document.createElement('input');
        input.type = 'hidden';
        input.name = '_csrf';
        input.value = token;
        form.appendChild(input);
      }
    });
  }
  // Intercept forms/buttons marked with data-confirm
  document.querySelectorAll('form[data-confirm]')
    .forEach(form => {
      form.addEventListener('submit', (e) => {
        const msg = form.getAttribute('data-confirm') || '¿Confirmas esta acción?';
        if (!confirm(msg)) e.preventDefault();
      });
    });
  document.querySelectorAll('[data-confirm-click]')
    .forEach(btn => {
      btn.addEventListener('click', (e) => {
        const msg = btn.getAttribute('data-confirm-click') || '¿Confirmas esta acción?';
        if (!confirm(msg)) e.preventDefault();
      });
    });
});

// Dual range slider for price filter
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-price-slider]').forEach(slider => {
    const minInput = slider.querySelector('input[name="min"]');
    const maxInput = slider.querySelector('input[name="max"]');
    const minThumb = slider.querySelector('[data-price-min]');
    const maxThumb = slider.querySelector('[data-price-max]');
    const minText = slider.querySelector('[data-price-min-text]');
    const maxText = slider.querySelector('[data-price-max-text]');
    const defaultMin = Number(slider.getAttribute('data-min-default') || '0');
    const defaultMax = Number(slider.getAttribute('data-max-default') || '0');

    const toNumber = (v, fall) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : fall;
    };

    const setUI = (mn, mx) => {
      minThumb.value = String(mn);
      maxThumb.value = String(mx);
      minInput.value = String(mn);
      maxInput.value = String(mx);
      minText.textContent = toNumber(mn, defaultMin).toLocaleString('es-CO');
      maxText.textContent = toNumber(mx, defaultMax).toLocaleString('es-CO');
    };

    const clampUpdate = () => {
      let mn = Math.min(toNumber(minThumb.value, defaultMin), toNumber(maxThumb.value, defaultMax));
      let mx = Math.max(toNumber(minThumb.value, defaultMin), toNumber(maxThumb.value, defaultMax));
      // ensure at least 0 gap
      if (mn > mx) [mn, mx] = [mx, mn];
      setUI(mn, mx);
    };

    // Initialize
    const startMin = toNumber(minInput.value || minThumb.value, defaultMin);
    const startMax = toNumber(maxInput.value || maxThumb.value, defaultMax);
    setUI(Math.min(startMin, startMax), Math.max(startMin, startMax));

    minThumb.addEventListener('input', clampUpdate);
    maxThumb.addEventListener('input', clampUpdate);
  });
});
