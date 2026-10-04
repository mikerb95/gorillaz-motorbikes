// Motion de la pantalla del cliente del KDS ("el taller a la vista").
//
// La pantalla afirma dos cosas: que el taller está trabajando ahora mismo y
// que el cliente puede registrar su llegada. La prueba de lo primero es el
// "taller en vivo": una ficha (placa en blanco) por moto en cada etapa; cuando
// una moto avanza, su ficha se descuelga y vuela en arco a la etapa nueva
// (el mismo vuelo de las herramientas de /servicios). El reloj es mecánico:
// sus dígitos ruedan como un odómetro.
//
// Fail-open: el servidor ya pinta la hora, los conteos y las fichas. Si este
// módulo falla, `mount` devuelve todo a la vista y el reloj de respaldo de
// kiosk.ejs sigue dando la hora. Con movimiento reducido no se monta nada.
//
// VERSIONES: /static va con caché inmutable; al cambiar un import, sube su ?v=.

import { mount, prefersReduced, getGsap } from '../motion/core.mjs?v=1';
import { clockParts, rollPath, planMoves, tokenLayout } from '../motion/lib/kds.mjs?v=1';
import { flightFrame } from '../motion/lib/flight.mjs?v=1';

const POLL_MS = 20000;
const html = document.documentElement;
const gsap = getGsap();

// ── Reloj odómetro ──────────────────────────────────────────────────────
function initClock(root) {
  const cells = Array.from(root.querySelectorAll('.kds-dg'));
  const ampmEl = root.querySelector('.kds-clock-ampm');
  if (cells.length !== 4 || !ampmEl) throw new Error('reloj sin 4 dígitos');

  // Cada dígito pasa a ser una ventana sobre la tira "0123456789" ×2.
  const strips = cells.map((cell) => {
    const strip = document.createElement('span');
    strip.className = 'kds-dg-strip';
    for (let k = 0; k < 20; k++) {
      const n = document.createElement('span');
      n.textContent = String(k % 10);
      strip.appendChild(n);
    }
    cell.textContent = '';
    cell.appendChild(strip);
    cell.classList.add('is-odo');
    return strip;
  });

  let shown = clockParts(new Date());
  shown.digits.forEach((d, i) => gsap.set(strips[i], { yPercent: rollPath(d, d).to }));
  ampmEl.textContent = shown.ampm;
  html.classList.add('kds-clock-live');

  function tick() {
    const now = clockParts(new Date());
    if (now.label === shown.label) return;
    root.setAttribute('aria-label', now.label);
    ampmEl.textContent = now.ampm;
    // El dígito de la derecha cambia primero; los de la izquierda lo siguen
    // un instante después, como un contador que arrastra al siguiente.
    let delay = 0;
    for (let i = 3; i >= 0; i--) {
      const a = shown.digits[i];
      const b = now.digits[i];
      if (a === b) continue;
      const p = rollPath(a, b);
      gsap.fromTo(strips[i], { yPercent: p.from }, {
        yPercent: p.to, duration: 0.9, delay, ease: 'expo.out',
        onComplete: p.reset === null ? null : () => gsap.set(strips[i], { yPercent: p.reset }),
      });
      delay += 0.12;
    }
    shown = now;
  }
  const timer = setInterval(tick, 1000);
  return {
    destroy() {
      clearInterval(timer);
      html.classList.remove('kds-clock-live');
    },
  };
}

// ── Taller en vivo ─────────────────────────────────────────────────────
function initLive(root) {
  const stages = Array.from(root.querySelectorAll('.kds-live-stage'));
  if (!stages.length) throw new Error('sin etapas');
  const tokensOf = (i) => stages[i].querySelector('.kds-live-tokens');
  const countOf = (i) => stages[i].querySelector('[data-count]');
  let counts = stages.map((_, i) => Number(countOf(i).textContent) || 0);
  let busy = false;
  let timer = 0;
  let destroyed = false;

  // Dibuja las fichas de una etapa según su conteo (tope con "+N").
  function paint(i, count) {
    const box = tokensOf(i);
    const { shown, extra } = tokenLayout(count);
    box.textContent = '';
    for (let k = 0; k < shown; k++) box.appendChild(Object.assign(document.createElement('i'), { className: 'kds-live-token' }));
    if (extra) box.appendChild(Object.assign(document.createElement('b'), { className: 'kds-live-more', textContent: '+' + extra }));
  }

  // El número cambia con un golpe corto, no con un fundido.
  function bumpCount(i, value) {
    const el = countOf(i);
    el.textContent = String(value);
    gsap.fromTo(el, { scale: 1.35, color: '#F25C05' }, { scale: 1, color: '#ffffff', duration: 0.5, ease: 'back.out(3)', clearProps: 'transform,color' });
  }

  // Entrada: las fichas caen y se asientan, etapa por etapa.
  const intro = root.querySelectorAll('.kds-live-token, .kds-live-more');
  gsap.set(intro, { y: -26, opacity: 0 });
  html.classList.remove('kds-intro-pending');
  gsap.to(intro, {
    y: 0, opacity: 1, duration: 0.55, ease: 'back.out(2.2)',
    stagger: { each: 0.06 }, delay: 0.25, clearProps: 'transform,opacity',
  });

  // Vuelo de una ficha de la etapa `from` a la etapa `to`, en arco.
  function fly(from, to, delay) {
    return new Promise((resolve) => {
      const srcBox = tokensOf(from);
      const src = srcBox.querySelector('.kds-live-token:last-of-type') || srcBox;
      const a = src.getBoundingClientRect();
      // Hueco de llegada: una ficha invisible al final de la etapa destino.
      const slot = document.createElement('i');
      slot.className = 'kds-live-token';
      slot.style.visibility = 'hidden';
      tokensOf(to).appendChild(slot);
      const b = slot.getBoundingClientRect();
      if (src !== srcBox) src.remove();

      const flyer = document.createElement('i');
      flyer.className = 'kds-live-token kds-live-flyer';
      flyer.style.width = b.width + 'px';
      flyer.style.height = b.height + 'px';
      document.body.appendChild(flyer);
      const lift = Math.max(60, Math.abs(b.left - a.left) * 0.25);
      const state = { t: 0 };
      const place = () => {
        const f = flightFrame(state.t, a, b, { lift, tilt: -16 });
        gsap.set(flyer, { x: f.x - b.width / 2, y: f.y - b.height / 2, scale: f.scale * (1 + 0.35 * Math.sin(Math.PI * state.t)), rotation: f.rotation });
      };
      place();
      gsap.to(state, {
        t: 1, duration: 1.1, delay, ease: 'power2.inOut', onUpdate: place,
        onComplete: () => {
          flyer.remove();
          slot.style.visibility = '';
          gsap.fromTo(slot, { y: -6 }, { y: 0, duration: 0.4, ease: 'bounce.out', clearProps: 'transform' });
          resolve();
        },
      });
    });
  }

  // Moto que entra: su ficha cae desde arriba. Moto que sale: sube y se va.
  function enter(i, delay) {
    const t = Object.assign(document.createElement('i'), { className: 'kds-live-token' });
    tokensOf(i).appendChild(t);
    return gsap.fromTo(t, { y: -40, opacity: 0 }, { y: 0, opacity: 1, duration: 0.7, delay, ease: 'bounce.out', clearProps: 'transform,opacity' }).then();
  }
  function exit(i, delay) {
    const t = tokensOf(i).querySelector('.kds-live-token:last-of-type');
    if (!t) return Promise.resolve();
    return gsap.to(t, { y: -30, opacity: 0, scale: 0.6, duration: 0.6, delay, ease: 'power2.in', onComplete: () => t.remove() }).then();
  }

  async function apply(next) {
    const plan = planMoves(counts, next);
    const jobs = [];
    let d = 0;
    plan.exits.forEach((i) => { jobs.push(exit(i, d)); d += 0.15; });
    plan.moves.forEach(({ from, to }) => { jobs.push(fly(from, to, d)); d += 0.35; });
    plan.enters.forEach((i) => { jobs.push(enter(i, d)); d += 0.15; });
    await Promise.all(jobs);
    // Al final, el estado exacto: conteos nuevos y fichas normalizadas
    // (por si alguna etapa pasó del tope y ahora lleva "+N").
    next.forEach((c, i) => {
      if (c !== counts[i]) bumpCount(i, c);
      paint(i, c);
    });
    counts = next;
  }

  async function poll() {
    if (destroyed || busy || document.hidden) return;
    busy = true;
    try {
      const r = await fetch('/kds/en-vivo.json', { headers: { Accept: 'application/json' } });
      const data = r.ok ? await r.json() : null;
      const next = data && Array.isArray(data.counts) && data.counts.length === counts.length ? data.counts.map(Number) : null;
      if (next && next.some((c, i) => c !== counts[i])) await apply(next);
    } catch { /* red intermitente: se reintenta en el próximo ciclo */ }
    busy = false;
  }
  timer = setInterval(poll, POLL_MS);
  const onVis = () => { if (!document.hidden) poll(); };
  document.addEventListener('visibilitychange', onVis);

  // Para verificar con capturas sin esperar al servidor: aplica unos conteos.
  root.kdsLiveApply = (next) => apply(next.map(Number));

  return {
    destroy() {
      destroyed = true;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
      document.querySelectorAll('.kds-live-flyer').forEach((f) => f.remove());
    },
  };
}

if (gsap && !prefersReduced()) {
  html.classList.add('motion-ok');
  mount('[data-kds-clock]', initClock);
  mount('[data-kds-live]', initLive);
} else {
  html.classList.remove('kds-intro-pending');
}
