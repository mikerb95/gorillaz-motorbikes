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

  // Detect when nav items overflow and force compact (hamburger) mode regardless of fixed breakpoint
  const updateNavCompact = () => {
    if (updateNavCompact._measuring) return;
    updateNavCompact._measuring = true;
    const headerInner = document.querySelector('.header-inner');
    const navLeft = document.querySelector('.nav-left');
    const navCenter = document.querySelector('.nav-center');
    const headerRight = document.querySelector('.header-right');
    if (!headerInner || !navLeft || !navCenter || !headerRight) return;
    // Temporarily remove classes to measure natural desktop layout
    const body = document.body;
    const hadCompact = body.classList.contains('nav-compact');
    const hadSqueeze = body.classList.contains('nav-squeeze');
    if (hadCompact || hadSqueeze){
      body.classList.remove('nav-compact');
      body.classList.remove('nav-squeeze');
    }

    const host = headerInner.getBoundingClientRect();
    const leftR = navLeft.getBoundingClientRect();
    const centerR = navCenter.getBoundingClientRect();
    const rightR = headerRight.getBoundingClientRect();

    // Gaps and clipping
    const gapLeftToCenter = Math.max(0, centerR.left - leftR.right);
    const gapCenterToRight = Math.max(0, rightR.left - centerR.right);
    const edgeRight = host.right - rightR.right;

    // Compact when overlapping or clipping
    const clipRight = edgeRight < 4;
    const overlapRightCenter = rightR.left < centerR.right + 8;
    const overlapLeftCenter = leftR.right > centerR.left - 8;
    const shouldCompact = clipRight || overlapRightCenter || overlapLeftCenter;

    // Squeeze when near-overlap but not yet compact
  const nearRightCenter = gapCenterToRight < 40; // earlier squeeze
  const nearLeftCenter = gapLeftToCenter < 40;   // earlier squeeze
  const nearEdgeRight = edgeRight < 24;          // earlier squeeze
    const shouldSqueeze = !shouldCompact && (nearRightCenter || nearLeftCenter || nearEdgeRight);

    // Restore classes based on measurement
    const prevState = hadCompact ? 'compact' : (hadSqueeze ? 'squeeze' : 'normal');
    let nextState = 'normal';
    if (shouldCompact) nextState = 'compact';
    else if (shouldSqueeze) nextState = 'squeeze';

    if (nextState !== prevState){
      body.classList.toggle('nav-compact', nextState === 'compact');
      body.classList.toggle('nav-squeeze', nextState === 'squeeze');
      if (prevState === 'compact' && nextState !== 'compact'){
        // Ensure overlay menu is closed when returning from compact
        const nav = document.querySelector('[data-nav]');
        const toggle = document.querySelector('.nav-toggle');
        if (nav){ nav.setAttribute('data-open', 'false'); }
        if (toggle){ toggle.setAttribute('aria-expanded', 'false'); }
      }
    } else {
      // No state change: if we removed classes for measuring, reapply the same
      if (prevState === 'compact') body.classList.add('nav-compact');
      if (prevState === 'squeeze') body.classList.add('nav-squeeze');
    }
    updateNavCompact._measuring = false;
  };
  // Initial and responsive checks
  updateNavCompact();
  // Re-check after full load (images) and when web fonts are ready, as widths can change
  window.addEventListener('load', updateNavCompact);
  try { if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => updateNavCompact()); } catch {}
  window.addEventListener('resize', () => {
    // throttle with rAF
    if (updateNavCompact._ticking) return;
    updateNavCompact._ticking = true;
    requestAnimationFrame(() => { updateNavCompact(); updateNavCompact._ticking = false; });
  });
  // Observe layout changes in header regions to auto-toggle compact mode
  try {
    const ro = new ResizeObserver(() => updateNavCompact());
    const headerInner = document.querySelector('.header-inner');
    const navLeft = document.querySelector('.nav-left');
    const navCenter = document.querySelector('.nav-center');
    const headerRight = document.querySelector('.header-right');
    [headerInner, navLeft, navCenter, headerRight].forEach(el => el && ro.observe(el));
  } catch {}

  // If sub-bar exists (logged-in), add body class and recalc spacing
  if (document.querySelector('.sub-bar')){
    document.body.classList.add('has-subbar');
    // compute extra offset based on sub-bar inner height
    const sub = document.querySelector('.sub-inner');
    if (sub){
      const h = Math.ceil(sub.getBoundingClientRect().height + 12); // keep same margin logic; height will reflect thicker bar
      document.documentElement.style.setProperty('--subbar-offset', h + 'px');
    }
    setTimeout(setHeaderOffset, 0);

    // Auto-hide/show subbar on scroll
    const subBar = document.querySelector('.sub-bar');
    let lastY = window.scrollY || 0;
    let ticking = false;
    const onScroll = () => {
      const y = window.scrollY || 0;
      const delta = y - lastY;
      if (Math.abs(delta) < 4){ lastY = y; return; }
      if (delta > 0 && y > 20){
        subBar.classList.add('is-hidden');
      } else {
        subBar.classList.remove('is-hidden');
      }
      lastY = y;
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking){
        window.requestAnimationFrame(onScroll);
        ticking = true;
      }
    }, { passive: true });
  }

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
      const isLogo = el.classList.contains('logo') || el.closest('.logo');
      const isSub = !!el.closest('.nav-submenu');

      // Compute geometry differently for submenu items: center on text content, not the full anchor box
      let centerX;
      let baseW;
      let h;
      if (isSub) {
        // Use Range to measure the text content bounds precisely
        let txtRect = rect;
        try {
          const range = document.createRange();
          range.selectNodeContents(el);
          const rects = range.getClientRects();
          txtRect = rects.length ? rects[0] : range.getBoundingClientRect();
          range.detach && range.detach();
        } catch {}
        centerX = txtRect.left - host.left + (txtRect.width / 2);
        baseW = Math.max(64, txtRect.width + 8); // tight around text, slight breathing room
        h = Math.max(24, rect.height + 6);
      } else {
        const padX = 24; // extra width for main items only
        const padY = 10;
        baseW = Math.max(120, rect.width + padX);
        h = Math.max(32, rect.height + padY);
        centerX = rect.left - host.left + (rect.width / 2);
      }

      const w = isLogo ? Math.max(120, Math.min(160, baseW)) : baseW;
      // Small fine-tune bias for submenu (visual centering) – far less than before
      const leftBias = isSub ? 2 : 0;
      const x = centerX - (w / 2) - leftBias;
      const y = rect.top - host.top + rect.height/2;
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
      // Determine travel direction for peel animation
      let dir = 'right';
      try {
        const prevRect = lastEl ? lastEl.getBoundingClientRect() : null;
        const nextRect = el.getBoundingClientRect();
        if (prevRect) dir = nextRect.left >= prevRect.left ? 'right' : 'left';
      } catch {}
      blob.setAttribute('data-dir', dir);

      const isSub = !!el.closest('.nav-submenu');
      // For submenu items, avoid skew/scale that can visually offset center
      if (isSub) {
        blob.classList.remove('is-peel');
        // Neutralize skew/scale via CSS variables for precise centering
        blob.style.setProperty('--sx', '1');
        blob.style.setProperty('--skew', '0deg');
      } else {
        // Clear overrides so main items keep the peel effect
        blob.style.removeProperty('--sx');
        blob.style.removeProperty('--skew');
        blob.classList.add('is-peel');
      }
      setToEl(el);
      blob.classList.add('is-visible');
      // Remove peel after a short moment so subsequent moves can re-trigger
      clearTimeout(blob._peelT);
      blob._peelT = setTimeout(() => blob.classList.remove('is-peel'), 160);
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

      // Special behavior for logo: hide the image and show the inline text; also dim the rest of the navbar
      logo.addEventListener('mouseenter', () => {
        hideBlob();
        logo.classList.add('is-hidden');
        document.body.classList.add('logo-hover-dim');
      });
      logo.addEventListener('mouseleave', () => {
        hideBlob();
        logo.classList.remove('is-hidden');
        document.body.classList.remove('logo-hover-dim');
      });
    }

    // Also support keyboard focus for accessibility (works regardless of pointer type)
    logo.addEventListener('focus', () => {
      hideBlob();
      logo.classList.add('is-hidden');
      document.body.classList.add('logo-hover-dim');
    });
    logo.addEventListener('blur', () => {
      hideBlob();
      logo.classList.remove('is-hidden');
      document.body.classList.remove('logo-hover-dim');
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

// Admin summary: rotate chevron on open
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.admin-row details').forEach(d => {
    const chev = d.querySelector('.chev');
    if (!chev) return;
    const sync = () => { chev.style.transform = d.open ? 'rotate(90deg)' : 'none'; };
    d.addEventListener('toggle', sync);
    sync();
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

// AJAX newsletter submit (avoid page jump to top)
document.addEventListener('DOMContentLoaded', () => {
  const form = document.querySelector('.newsletter-form');
  if (!form) return;
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.querySelector('input[name="email"]').value.trim();
    const csrf = document.querySelector('meta[name="csrf-token"]')?.getAttribute('content') || '';
    const captchaEl = document.querySelector('.g-recaptcha');
    let captchaToken = '';
    try { captchaToken = window.grecaptcha ? grecaptcha.getResponse() : ''; } catch {}

    const body = new URLSearchParams();
    body.set('email', email);
    if (csrf) body.set('_csrf', csrf);
    if (captchaToken) body.set('g-recaptcha-response', captchaToken);

    const alertOk = (msg) => {
      const p = document.createElement('p');
      p.className = 'alert success';
      p.textContent = msg || '¡Gracias! Te hemos suscrito al boletín.';
      form.insertAdjacentElement('beforebegin', p);
    };
    const alertErr = (msg) => {
      const p = document.createElement('p');
      p.className = 'alert error';
      p.textContent = msg || 'No pudimos procesar tu suscripción.';
      form.insertAdjacentElement('beforebegin', p);
    };
    // Clear previous alerts
    form.parentElement.querySelectorAll('.alert.success, .alert.error').forEach(n => n.remove());

    try {
      const resp = await fetch('/newsletter', {
        method: 'POST',
        headers: { 'Accept': 'application/json', 'X-Requested-With': 'fetch' },
        body
      });
      if (!resp.ok){
        const data = await resp.json().catch(() => ({}));
        if (data.status === 'captcha') alertErr('Por favor completa la verificación reCAPTCHA.');
        else alertErr(data.message || 'Ingresa un correo válido.');
        return;
      }
      alertOk();
      form.reset();
      try { if (window.grecaptcha && captchaEl) grecaptcha.reset(); } catch {}
    } catch (err) {
      alertErr('Error de red. Intenta de nuevo.');
    }
  });
});
