// /pintura-detailing-wrap
//
// 1. LA CABINA. Sin JS el tanque cambia de acabado con radios + :has()
//    (estetica.css). Con JS y GSAP, cada acabado se APLICA: la pistola pinta en
//    zigzag, la pulidora borra la opacidad, el vinilo se extiende con la
//    espátula. El acabado que entra vive en la capa "b" y una máscara lo va
//    destapando; al terminar pasa a la capa "a". Además el reflejo sigue al
//    cursor. Contrato fail-open: si algo falla o hay movimiento reducido, la
//    capa "a" se queda sin data-look y manda el CSS.
// 2. EL COTIZADOR. Formulario por pasos que arma un mensaje y abre WhatsApp.
//    No envía nada al servidor.

(function () {
  'use strict';
  var cab = document.querySelector('[data-et-cab]');
  var gsap = window.gsap;
  if (!cab || !gsap) return;
  try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (e) { return; }

  var svg = cab.querySelector('.et-tank');
  var A = cab.querySelector('.tk-look-a');
  var B = cab.querySelector('.tk-look-b');
  var mStroke = cab.querySelector('.m-stroke');
  var mWipe = cab.querySelector('.m-wipe');
  var mAll = cab.querySelector('.m-all');
  var fx = {
    mist: cab.querySelector('.fx-mist'), gun: cab.querySelector('.fx-gun'),
    pad: cab.querySelector('.fx-pad'), spin: cab.querySelector('.fx-pad-spin'),
    sq: cab.querySelector('.fx-sq'), sweep: cab.querySelector('.fx-sweep'),
  };
  if (!svg || !A || !B || !mStroke || !mWipe || !mAll || !fx.gun || !fx.pad || !fx.sq) return;

  var LEN;
  try { LEN = mStroke.getTotalLength(); } catch (e) { return; }
  if (!LEN) return;
  mStroke.setAttribute('stroke-dasharray', LEN + ' ' + LEN);

  function checked(name) {
    var el = cab.querySelector('input[name="' + name + '"]:checked');
    return el ? el.value : '';
  }
  function lookNow() {
    var f = checked('et-finish');
    return f === 'wrap' ? checked('et-vinyl') : f;
  }

  var current = lookNow();
  var pending = null;
  var tl = null;
  A.setAttribute('data-look', current);

  function resetMask() {
    mStroke.setAttribute('stroke-dashoffset', LEN);
    mStroke.removeAttribute('filter');
    mWipe.setAttribute('width', 0);
    mAll.setAttribute('opacity', 0);
  }
  function settle(look) {
    A.setAttribute('data-look', look);
    current = look;
    pending = null;
    B.style.display = 'none';
    gsap.set([fx.mist, fx.gun, fx.pad, fx.sq, fx.sweep], { opacity: 0 });
    tl = null;
  }

  // La herramienta recorre el trazo de la máscara: lo ya recorrido queda destapado.
  function follow(tool, dur, onPoint) {
    var st = { p: 0 };
    return gsap.to(st, {
      p: 1, duration: dur, ease: 'sine.inOut',
      onUpdate: function () {
        var d = st.p * LEN;
        mStroke.setAttribute('stroke-dashoffset', LEN - d);
        var pt = mStroke.getPointAtLength(d);
        onPoint(pt, st.p);
      },
    });
  }

  function paint(t) {
    mStroke.setAttribute('filter', 'url(#et-f-soft)');
    gsap.set(fx.gun, { x: -10, y: 82, rotation: -6 });
    gsap.set(fx.mist, { x: -40, y: 82 });
    t.to([fx.gun, fx.mist], { opacity: 1, duration: .2 })
      .add(follow(fx.gun, 1.9, function (pt, p) {
        gsap.set(fx.gun, { x: pt.x + 26, y: pt.y, rotation: -6 + Math.sin(p * 22) * 3 });
        gsap.set(fx.mist, { x: pt.x - 6, y: pt.y, scale: 1 + Math.sin(p * 40) * .08, transformOrigin: 'center' });
      }))
      .to([fx.gun, fx.mist], { opacity: 0, duration: .25 });
  }

  function polish(t) {
    gsap.set(fx.pad, { x: -10, y: 82 });
    t.to(fx.pad, { opacity: 1, duration: .2 })
      .add(gsap.to(fx.spin, { rotation: 1440, duration: 2.3, ease: 'none', transformOrigin: 'center' }), '<')
      .add(follow(fx.pad, 2.1, function (pt, p) {
        // Órbita corta alrededor del trazo: el vaivén de la pulidora.
        gsap.set(fx.pad, { x: pt.x + Math.cos(p * 60) * 5, y: pt.y + Math.sin(p * 60) * 5 });
      }), '<')
      .to(fx.pad, { opacity: 0, duration: .25 })
      // Remate: la luz de la cabina barre el tanque ya brillante.
      .fromTo(fx.sweep, { x: -120, opacity: 0, skewX: -18 },
        { x: 440, opacity: .9, skewX: -18, duration: .8, ease: 'power2.inOut' }, '-=.1')
      .to(fx.sweep, { opacity: 0, duration: .15 }, '-=.15');
  }

  function wipe(t) {
    var st = { w: 0 };
    gsap.set(fx.sq, { x: -20 });
    t.to(fx.sq, { opacity: 1, duration: .15 })
      .to(st, {
        w: 460, duration: 1.25, ease: 'power2.inOut',
        onUpdate: function () {
          mWipe.setAttribute('width', st.w);
          gsap.set(fx.sq, { x: st.w - 20 });
        },
      })
      .to(fx.sq, { opacity: 0, duration: .2 })
      // La esquina del vinilo se levanta al final.
      .fromTo(B.querySelector('.tk-peel-flap'), { scale: 0, svgOrigin: '362 178' },
        { scale: 1, svgOrigin: '362 178', duration: .45, ease: 'back.out(2)', immediateRender: true }, '-=.15');
  }

  function fade(t) {
    var st = { o: 0 };
    t.to(st, { o: 1, duration: .5, ease: 'power1.out', onUpdate: function () { mAll.setAttribute('opacity', st.o); } });
  }

  function apply() {
    var target = lookNow();
    if (tl) { tl.kill(); settle(pending || current); }
    if (!target || target === current) return;
    pending = target;
    resetMask();
    B.setAttribute('data-look', target);
    B.style.display = 'block';
    tl = gsap.timeline({ onComplete: function () { settle(target); } });
    try {
      if (target === 'pintura') paint(tl);
      else if (target === 'detailing') polish(tl);
      else if (target === 'llega') fade(tl);
      else wipe(tl);
    } catch (e) {
      if (tl) tl.kill();
      settle(target);
    }
  }
  cab.addEventListener('change', function (e) {
    if (e.target && (e.target.name === 'et-finish' || e.target.name === 'et-vinyl')) apply();
  });

  // ── La luz sigue al cursor (o a la inclinación del teléfono) ─────────────
  var booth = cab.querySelector('.et-booth');
  var goal = { x: 0, y: 0 };
  var pos = { x: 0, y: 0 };
  var raf = 0;
  function tick() {
    pos.x += (goal.x - pos.x) * .12;
    pos.y += (goal.y - pos.y) * .12;
    svg.style.setProperty('--lx', pos.x.toFixed(3));
    svg.style.setProperty('--ly', pos.y.toFixed(3));
    raf = (Math.abs(goal.x - pos.x) + Math.abs(goal.y - pos.y) > .002) ? requestAnimationFrame(tick) : 0;
  }
  function aim(x, y) {
    goal.x = Math.max(-1, Math.min(1, x));
    goal.y = Math.max(-1, Math.min(1, y));
    svg.style.setProperty('--l-on', 1);
    if (!raf) raf = requestAnimationFrame(tick);
  }
  if (booth) {
    booth.addEventListener('pointermove', function (e) {
      var r = booth.getBoundingClientRect();
      aim(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1);
    });
    booth.addEventListener('pointerleave', function () {
      svg.style.setProperty('--l-on', 0);
      goal.x = 0; goal.y = 0;
      if (!raf) raf = requestAnimationFrame(tick);
    });
  }
  // En el teléfono, la inclinación mueve la luz (donde no pide permiso).
  var needsPerm = window.DeviceOrientationEvent && typeof window.DeviceOrientationEvent.requestPermission === 'function';
  if (window.DeviceOrientationEvent && !needsPerm && window.matchMedia('(pointer: coarse)').matches) {
    window.addEventListener('deviceorientation', function (e) {
      if (e.gamma == null || e.beta == null) return;
      aim(e.gamma / 28, (e.beta - 45) / 35);
    }, { passive: true });
  }

  // ── Demostración: recorre los acabados una vez al entrar en pantalla ─────
  if (!('IntersectionObserver' in window)) return;
  var seq = [
    ['etf-pintura', 2900],
    ['etf-detailing', 4000],
    ['etf-wrap', 2500],
    ['etv-carbono', 2300],
    ['etv-camaleon', 2600],
    ['etf-detailing', 0],
  ];
  var timer = null;
  var stopped = false;
  function stop() { stopped = true; clearTimeout(timer); }
  ['pointerdown', 'keydown'].forEach(function (ev) { cab.addEventListener(ev, stop, { once: true }); });
  function step(i) {
    if (stopped || i >= seq.length) return;
    var input = document.getElementById(seq[i][0]);
    if (input) { input.checked = true; apply(); }
    timer = setTimeout(function () { step(i + 1); }, seq[i][1]);
  }
  var io = new IntersectionObserver(function (entries) {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    if (!stopped) timer = setTimeout(function () { step(0); }, 1500);
  }, { threshold: 0.5 });
  io.observe(cab);
})();

// ── Cotizador por pasos ───────────────────────────────────────────────────
(function () {
  'use strict';
  var form = document.querySelector('[data-qz]');
  if (!form) return;
  var fallback = document.querySelector('[data-qz-fallback]');
  var gsap = window.gsap;
  var calm = false;
  try { calm = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { calm = true; }

  var all = [].slice.call(form.querySelectorAll('[data-step]'));
  var byName = {};
  all.forEach(function (s) { byName[s.getAttribute('data-step')] = s; });
  var bar = form.querySelector('[data-qz-bar]');
  var count = form.querySelector('[data-qz-count]');
  var err = form.querySelector('[data-qz-error]');
  var back = form.querySelector('[data-qz-back]');
  var next = form.querySelector('[data-qz-next]');
  var send = form.querySelector('[data-qz-send]');
  var preview = form.querySelector('[data-qz-preview]');
  if (!bar || !count || !err || !back || !next || !send || !preview) return;

  function vals(name) {
    return [].slice.call(form.querySelectorAll('input[name="' + name + '"]:checked'));
  }
  function text(name) {
    var el = form.elements[name];
    return el ? String(el.value || '').replace(/\s+/g, ' ').trim() : '';
  }
  function has(svc) { return vals('svc').some(function (i) { return i.value === svc; }); }

  // Los pasos dependen de lo elegido: las piezas solo importan en pintura y wrap.
  function flow() {
    var f = ['servicio', 'moto'];
    if (has('pintura') || has('wrap')) f.push('piezas');
    f.push('detalles', 'resumen');
    return f;
  }

  function message() {
    var name = text('nombre');
    var lines = [(name ? 'Hola, soy ' + name + '. ' : 'Hola. ') + 'Quiero cotizar para mi moto:'];
    lines.push('• Servicio: ' + vals('svc').map(function (i) { return i.getAttribute('data-label'); }).join(', '));
    var color = text('color');
    lines.push('• Moto: ' + text('moto') + (color ? ' (color actual: ' + color + ')' : ''));
    if (has('pintura') || has('wrap')) {
      var parts = form.elements.toda.checked ? ['Toda la moto']
        : vals('pieza').map(function (i) { return i.getAttribute('data-label'); });
      if (parts.length) lines.push('• Piezas: ' + parts.join(', '));
    }
    if (has('wrap')) {
      var fin = vals('wrapFinish')[0];
      var wc = text('wrapColor');
      if (fin || wc) lines.push('• Wrap: ' + [fin ? 'acabado ' + fin.value.toLowerCase() : '', wc ? 'color ' + wc : ''].filter(Boolean).join(', '));
    }
    if (has('pintura')) {
      var goal = vals('paintGoal')[0];
      if (goal) lines.push('• Pintura: ' + goal.value.toLowerCase());
    }
    if (has('detailing')) {
      var signs = vals('sign').map(function (i) { return i.value.toLowerCase(); });
      if (signs.length) lines.push('• Le noto: ' + signs.join(', '));
    }
    var note = text('nota');
    if (note) lines.push('• Nota: ' + note);
    lines.push('Les envío las fotos por aquí.');
    return lines.join('\n');
  }

  function validate(name) {
    if (name === 'servicio' && !vals('svc').length) return 'Elige al menos una opción.';
    if (name === 'moto' && text('moto').length < 2) return 'Cuéntanos qué moto es.';
    if (name === 'piezas' && !form.elements.toda.checked && !vals('pieza').length) return 'Elige al menos una pieza o "Toda la moto".';
    return '';
  }

  var index = 0;
  function show(i, dir) {
    var f = flow();
    index = Math.max(0, Math.min(f.length - 1, i));
    var name = f[index];
    all.forEach(function (s) { s.hidden = s !== byName[name]; });
    ['wrap', 'pintura', 'detailing'].forEach(function (k) {
      [].forEach.call(form.querySelectorAll('[data-if="' + k + '"]'), function (g) { g.hidden = !has(k); });
    });
    var last = index === f.length - 1;
    back.hidden = index === 0;
    next.hidden = last;
    send.hidden = !last;
    err.textContent = '';
    bar.style.width = Math.round(((index + 1) / f.length) * 100) + '%';
    count.textContent = 'Paso ' + (index + 1) + ' de ' + f.length;
    if (last) refresh();
    var stepEl = byName[name];
    if (gsap && !calm && dir) {
      gsap.fromTo(stepEl, { opacity: 0, x: 28 * dir }, { opacity: 1, x: 0, duration: .4, ease: 'power3.out', clearProps: 'all' });
      gsap.from(stepEl.querySelectorAll('.qz-chip, .qz-field, .qz-bike, .qz-preview'),
        { opacity: 0, y: 12, duration: .35, stagger: .035, ease: 'power2.out', clearProps: 'all', delay: .05 });
    }
    if (dir) {
      var legend = stepEl.querySelector('legend');
      if (legend) legend.focus({ preventScroll: true });
    }
  }
  function refresh() {
    var msg = message();
    preview.textContent = msg;
    send.href = form.getAttribute('data-wa') + '?text=' + encodeURIComponent(msg + '\n' + form.getAttribute('data-url'));
  }
  function forward() {
    var problem = validate(flow()[index]);
    if (problem) {
      err.textContent = problem;
      if (gsap && !calm) gsap.fromTo(next, { x: -6 }, { x: 0, duration: .4, ease: 'elastic.out(1.2, .3)' });
      return;
    }
    show(index + 1, 1);
  }

  next.addEventListener('click', forward);
  back.addEventListener('click', function () { show(index - 1, -1); });
  form.addEventListener('submit', function (e) { e.preventDefault(); });
  form.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target && e.target.tagName === 'INPUT' && e.target.type === 'text') {
      e.preventDefault();
      if (flow()[index] === 'resumen') refresh(); else forward();
    }
  });
  form.addEventListener('input', function (e) {
    err.textContent = '';
    if (e.target && e.target.name === 'nombre') refresh();
  });

  // "No sé, asesórenme" va sola: no se combina con un servicio concreto.
  form.addEventListener('change', function (e) {
    var t = e.target;
    if (!t || t.name !== 'svc' || !t.checked) return;
    vals('svc').forEach(function (i) {
      if ((t.value === 'asesoria') !== (i.value === 'asesoria')) i.checked = false;
    });
  });

  // La moto: tocar una pieza marca su casilla, y al revés.
  var partEls = [].slice.call(form.querySelectorAll('[data-part]'));
  var partInputs = [].slice.call(form.querySelectorAll('input[name="pieza"]'));
  var todaInput = form.elements.toda;
  function syncParts() {
    partEls.forEach(function (el) {
      var input = partInputs.filter(function (i) { return i.value === el.getAttribute('data-part'); })[0];
      el.classList.toggle('is-on', !!(input && input.checked));
    });
  }
  partEls.forEach(function (el) {
    el.addEventListener('click', function () {
      var input = partInputs.filter(function (i) { return i.value === el.getAttribute('data-part'); })[0];
      if (!input) return;
      input.checked = !input.checked;
      todaInput.checked = partInputs.every(function (i) { return i.checked; });
      err.textContent = '';
      syncParts();
    });
  });
  partInputs.forEach(function (i) {
    i.addEventListener('change', function () {
      todaInput.checked = partInputs.every(function (p) { return p.checked; });
      syncParts();
    });
  });
  todaInput.addEventListener('change', function () {
    partInputs.forEach(function (i) { i.checked = todaInput.checked; });
    syncParts();
  });

  // Botones de la página que traen un servicio ya elegido (p. ej. "Cotizar mi wrap").
  [].forEach.call(document.querySelectorAll('[data-qz-pick]'), function (a) {
    a.addEventListener('click', function () {
      var input = form.querySelector('input[name="svc"][value="' + a.getAttribute('data-qz-pick') + '"]');
      if (!input) return;
      vals('svc').forEach(function (i) { i.checked = false; });
      input.checked = true;
      show(0, 0);
    });
  });

  form.hidden = false;
  if (fallback) fallback.hidden = true;
  show(0, 0);
})();
