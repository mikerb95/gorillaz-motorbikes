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

    // Compact when overlapping or clipping (default evaluation)
    const clipRight = edgeRight < 4;
    const overlapRightCenter = rightR.left < centerR.right + 8;
    const overlapLeftCenter = leftR.right > centerR.left - 8;
    let shouldCompact = clipRight || overlapRightCenter || overlapLeftCenter;

    // Squeeze when near-overlap
    const nearRightCenter = gapCenterToRight < 40;
    const nearLeftCenter = gapLeftToCenter < 40;
    const nearEdgeRight = edgeRight < 24;
    let shouldSqueeze = !shouldCompact && (nearRightCenter || nearLeftCenter || nearEdgeRight);

    // If compact is needed, try squeeze first and re-measure to see if it prevents overlap
    if (shouldCompact){
      document.body.classList.add('nav-squeeze');
      const host2 = headerInner.getBoundingClientRect();
      const left2 = navLeft.getBoundingClientRect();
      const center2 = navCenter.getBoundingClientRect();
      const right2 = headerRight.getBoundingClientRect();
      const clipRight2 = (host2.right - right2.right) < 4;
      const overlapRightCenter2 = right2.left < center2.right + 4; // tighter threshold under squeeze
      const overlapLeftCenter2 = left2.right > center2.left - 4;
      if (!(clipRight2 || overlapRightCenter2 || overlapLeftCenter2)){
        // Squeeze rescued layout; prefer squeeze over compact
        shouldCompact = false;
        shouldSqueeze = true;
      }
    }

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

  // If sub content exists inside navbar, mark body for any CSS adjustments
  if (document.querySelector('.sub-embed')){
    document.body.classList.add('has-subbar');
    setTimeout(setHeaderOffset, 0);
  }

  // Measure submenu height to push sub-embed to the bottom while it's open
  const navBar = document.querySelector('.nav-bar');
  const updateSubmenuDepth = () => {
    if (!navBar) return;
    let depth = 0;
    // Find the tallest visible submenu under hover/focus
    document.querySelectorAll('.nav-item.has-submenu .nav-submenu').forEach(sm => {
      const host = sm.closest('.nav-item.has-submenu');
      const hovered = host && (host.matches(':hover') || sm.matches(':hover'));
      if (!hovered) return;
      const r = sm.getBoundingClientRect();
      depth = Math.max(depth, Math.ceil(r.height + 16)); // include a little breathing room
    });
    navBar.style.setProperty('--submenu-depth', depth > 0 ? depth + 'px' : '');
  };
  // Hook events
  document.querySelectorAll('.nav-item.has-submenu').forEach(item => {
    item.addEventListener('mouseenter', updateSubmenuDepth);
    item.addEventListener('mouseleave', () => { updateSubmenuDepth(); });
    item.addEventListener('focusin', updateSubmenuDepth);
    item.addEventListener('focusout', updateSubmenuDepth);
  });
  window.addEventListener('resize', () => { updateSubmenuDepth(); });
  // Initial compute after layout
  setTimeout(updateSubmenuDepth, 0);

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
    const ensureRayCanvas = () => {
      let c = headerInner.querySelector('.nav-ray-canvas');
      if (c) return c;
      c = document.createElement('canvas');
      c.className = 'nav-ray-canvas';
      headerInner.appendChild(c);
      return c;
    };
    const drawLightning = (ctx, x0, y0, x1, y1, options={}) => {
      const steps = options.steps || 18;
      const amp = options.amp || 16;
      const branchPct = options.branchPct || 0.25;
      ctx.save();
      ctx.strokeStyle = options.color || 'rgba(0,0,0,0.9)';
      ctx.lineWidth = options.width || 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      for (let i=1;i<=steps;i++){
        const t = i/steps;
        const x = x0 + (x1-x0)*t;
        const y = y0 + (y1-y0)*t + (Math.sin(t*6*Math.PI)+ (Math.random()-.5))*amp*(1-t);
        ctx.lineTo(x,y);
        // occasional tiny branch
        if (Math.random()<branchPct*t*0.5){
          const bx = x + (Math.random()>.5?1:-1)*8;
          const by = y + (Math.random()-.5)*12;
          ctx.moveTo(x,y);
          ctx.lineTo(bx,by);
          ctx.moveTo(x,y);
        }
      }
      ctx.stroke();
      // Outer glow
      ctx.strokeStyle = options.colorOuter || 'rgba(0,0,0,0.25)';
      ctx.lineWidth = (options.width||2.2)*3;
      ctx.globalCompositeOperation = 'multiply';
      ctx.beginPath();
      ctx.moveTo(x0,y0);
      for (let i=1;i<=steps;i++){
        const t = i/steps;
        const x = x0 + (x1-x0)*t;
        const y = y0 + (y1-y0)*t + (Math.sin(t*6*Math.PI)+ (Math.random()-.5))*amp*(1-t);
        ctx.lineTo(x,y);
      }
      ctx.stroke();
      ctx.restore();
    };
    const makePath = (x0,y0,x1,y1) => {
      const dx = x1-x0, dy = y1-y0;
      const len = Math.hypot(dx,dy);
      const steps = Math.max(14, Math.min(48, Math.floor(len/18)));
      const amp = Math.max(10, Math.min(22, len/18));
      const pts = [{x:x0,y:y0}];
      for (let i=1;i<=steps;i++){
        const t = i/steps;
        const x = x0 + dx*t;
        const y = y0 + dy*t + (Math.sin(t*6*Math.PI) + (Math.random()-.5))*amp*(1-t);
        pts.push({x,y});
      }
      return pts;
    };
    const drawPath = (ctx, pts, progress, opts) => {
      const n = Math.max(2, Math.floor(pts.length*progress));
      if (n < 2) return;
      const sub = pts.slice(0,n);
      // Glow
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.strokeStyle = opts.glow || 'rgba(0,0,0,0.25)';
      ctx.lineWidth = (opts.width||2.2)*3;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(sub[0].x, sub[0].y);
      for (let i=1;i<sub.length;i++) ctx.lineTo(sub[i].x, sub[i].y);
      ctx.stroke();
      // Core
      ctx.globalCompositeOperation = 'source-over';
      ctx.strokeStyle = opts.color || 'rgba(0,0,0,0.95)';
      ctx.lineWidth = opts.width || 2.2;
      ctx.beginPath();
      ctx.moveTo(sub[0].x, sub[0].y);
      for (let i=1;i<sub.length;i++) ctx.lineTo(sub[i].x, sub[i].y);
      ctx.stroke();
      ctx.restore();
    };
    const buildBranches = (pts, count=3) => {
      const branches = [];
      const n = pts.length;
      for (let i=0;i<count;i++){
        const startIndex = Math.floor( (0.15 + Math.random()*0.6) * n );
        const start = pts[startIndex];
        const len = 6 + Math.floor(Math.random()*8);
        const dir = (Math.random()<0.5?-1:1);
        const seg = [start];
        for (let j=1;j<=len;j++){
          const base = pts[Math.min(n-1, startIndex+j)];
          const x = base.x + dir * (2 + Math.random()*6) * (1 - j/len);
          const y = base.y + (Math.random()-.5)*6 * (1 - j/len);
          seg.push({x,y});
        }
        branches.push({startIndex, seg});
      }
      return branches;
    };
    const drawBranches = (ctx, branches, mainProgress, opts) => {
      branches.forEach(({startIndex, seg}) => {
        const startT = startIndex / Math.max(1, (opts.totalPts||1));
        if (mainProgress <= startT) return;
        const local = Math.min(1, (mainProgress - startT) / (1 - startT));
        const n = Math.max(2, Math.floor(seg.length * local));
        const sub = seg.slice(0,n);
        ctx.save();
        ctx.globalCompositeOperation = 'multiply';
        ctx.strokeStyle = 'rgba(0,0,0,0.18)';
        ctx.lineWidth = (opts.width||2.2)*2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(sub[0].x, sub[0].y);
        for (let i=1;i<sub.length;i++) ctx.lineTo(sub[i].x, sub[i].y);
        ctx.stroke();
        ctx.globalCompositeOperation = 'source-over';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)';
        ctx.lineWidth = (opts.width||2.2)*0.9;
        ctx.beginPath();
        ctx.moveTo(sub[0].x, sub[0].y);
        for (let i=1;i<sub.length;i++) ctx.lineTo(sub[i].x, sub[i].y);
        ctx.stroke();
        ctx.restore();
      });
    };
    const drawCorona = (ctx, x, y, r, alpha=0.25) => {
      ctx.save();
      ctx.globalCompositeOperation = 'multiply';
      ctx.fillStyle = `rgba(0,0,0,${alpha})`;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1,r), 0, Math.PI*2);
      ctx.fill();
      ctx.restore();
    };
    const emitRays = () => {
      const c = ensureRayCanvas();
      const prefersReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      const dpr = Math.min(window.devicePixelRatio||1, 2);
      const host = headerInner.getBoundingClientRect();
      c.width = Math.ceil(host.width*dpr);
      c.height = Math.ceil(host.height*dpr);
      c.style.width = host.width+'px';
      c.style.height = host.height+'px';
      const ctx = c.getContext('2d');
      ctx.setTransform(dpr,0,0,dpr,0,0);
      const center = logo.getBoundingClientRect();
      const xMid = (center.left + center.right)/2 - host.left;
      const yMid = (center.top + center.bottom)/2 - host.top;
      const leftPts = makePath(xMid, yMid, 8, yMid);
      const rightPts = makePath(xMid, yMid, host.width-8, yMid);
      const leftBranches = buildBranches(leftPts, 2 + Math.floor(Math.random()*2));
      const rightBranches = buildBranches(rightPts, 2 + Math.floor(Math.random()*2));
      let start = performance.now();
      const travel = prefersReduce ? 80 : 140;
      const preflash = prefersReduce ? 0 : 70;
      const dissipate = prefersReduce ? 140 : 320;
      cancelAnimationFrame(c._raf || 0);
      clearTimeout(c._fadeT1); clearTimeout(c._fadeT2);
      c.classList.add('is-on');
      const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
      const step = (now) => {
        const t = now - start;
        const pLin = Math.max(0, Math.min(1, (t - preflash)/Math.max(1,travel)));
        const p = easeOutCubic(Math.max(0,pLin));
        ctx.clearRect(0,0,host.width,host.height);
        // Preflash corona around logo center
        if (t < preflash){
          const a = 0.18 + 0.22 * (0.5 + 0.5*Math.sin(t*0.06));
          drawCorona(ctx, xMid, yMid, 16 + t*0.15, a);
        }
        // Draw main bolts
        drawPath(ctx, leftPts, p, { width: 2.2 });
        drawPath(ctx, rightPts, p, { width: 2.2 });
        // Draw branches as the head passes
        drawBranches(ctx, leftBranches, p, { width: 2.2, totalPts: leftPts.length });
        drawBranches(ctx, rightBranches, p, { width: 2.2, totalPts: rightPts.length });
        // Head corona for a hot tip
        if (p > 0 && p < 1){
          const li = Math.max(1, Math.floor(leftPts.length * p));
          const ri = Math.max(1, Math.floor(rightPts.length * p));
          const lh = leftPts[Math.min(leftPts.length-1, li)];
          const rh = rightPts[Math.min(rightPts.length-1, ri)];
          drawCorona(ctx, lh.x, lh.y, 6, 0.2);
          drawCorona(ctx, rh.x, rh.y, 6, 0.2);
        }
        if (p < 1){ c._raf = requestAnimationFrame(step); return; }
        // Hold a tick then fade by reducing global alpha over dissipate time
        const fadeStart = performance.now();
        const fadeStep = (now2) => {
          const ft = now2 - fadeStart;
          const fp = Math.max(0, Math.min(1, ft/dissipate));
          ctx.clearRect(0,0,host.width,host.height);
          // Slight flicker on dissipate
          const flicker = prefersReduce ? 0 : (Math.random()*0.06);
          ctx.globalAlpha = Math.max(0, 1 - fp - flicker);
          drawPath(ctx, leftPts, 1, { width: 2.2 });
          drawPath(ctx, rightPts, 1, { width: 2.2 });
          drawBranches(ctx, leftBranches, 1, { width: 2.2, totalPts: leftPts.length });
          drawBranches(ctx, rightBranches, 1, { width: 2.2, totalPts: rightPts.length });
          ctx.globalAlpha = 1;
          if (fp < 1){ c._raf = requestAnimationFrame(fadeStep); return; }
          // Done
          c.classList.remove('is-on');
          ctx.clearRect(0,0,host.width,host.height);
        };
        c._raf = requestAnimationFrame(fadeStep);
      };
      c._raf = requestAnimationFrame(step);
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
  // Lightning emit is handled in the dedicated logo mouseenter handler to avoid double triggers
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
        emitRays();
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
