// Servicios: "un experto para cada sistema de tu moto".
//
// La sección MUESTRA lo que afirma: cada servicio enciende en la moto la parte
// que atiende y la pone a funcionar (el pistón sube y baja, la corriente
// recorre el cableado, el rodamiento entra a presión en la manzana…).
//
// ESCRITORIO (≥1024 px): la sección se fija y el scroll avanza servicio por
// servicio con paradas de trinquete (snap). Una lámpara de inspección, como la
// que usa el mecánico, deja en penumbra todo menos la parte activa, y la
// cámara (el viewBox del SVG) se acerca a ella. Los títulos se vuelven
// pestañas: clic o flechas del teclado llevan a ese servicio.
//
// MÓVIL: no se fija nada. Las tarjetas van en un carrusel con scroll-snap y
// cada lupa "enfoca" (de borrosa a nítida y la parte se enciende) cuando su
// tarjeta queda al centro. Es otra interacción, no el escritorio encogido.
//
// Sin JS o con movimiento reducido: la lista de tarjetas del servidor, cada
// una con su lupa ya encendida (ver bike-art.ejs y landing.css).

import { getGsap, MQ } from '../motion/core.mjs?v=1';
import { detentIndex, detentProgress, ratchetAngle } from '../motion/lib/ratchet.mjs?v=1';
import { cameraBox, viewBoxString } from '../motion/lib/camera.mjs?v=1';
import { polar } from '../motion/lib/tach.mjs?v=1';

const NS = 'http://www.w3.org/2000/svg';
const ART = [0, 0, 1200, 700];
const SYSTEMS = ['engine', 'oil', 'electric', 'scan', 'inspect', 'axle', 'hub', 'body', 'wash', 'detail', 'helmet'];

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};

/**
 * Micro-animación de cada sistema sobre el arte clonado del escenario.
 * Cada fábrica devuelve un timeline en bucle; al cambiar de servicio se mata
 * y se limpian los estilos que dejó.
 */
function fxFactories(gsap, art, overlay) {
  const q = (sel) => Array.from(art.querySelectorAll(sel));
  const q1 = (sel) => art.querySelector(sel);
  // Los grupos fx-* tienen su opacidad atada a --on-*: no se tocan. Se anima
  // un <g> interior para que al apagar el sistema el grupo desaparezca igual.
  const inner = (sel) => {
    const host = q1(sel);
    if (!host) return null;
    if (host.__inner) return host.__inner;
    const g = document.createElementNS(NS, 'g');
    while (host.firstChild) g.appendChild(host.firstChild);
    host.appendChild(g);
    host.__inner = g;
    return g;
  };
  const loop = (opts = {}) => gsap.timeline({ repeat: -1, ...opts });

  return {
    engine() {
      return loop().to(q('.fx-piston-slide'), { y: 16, duration: 0.2, ease: 'sine.inOut', yoyo: true, repeat: 1 });
    },
    oil() {
      const drop = inner('.fx-oil');
      const cap = q('.s-oil-cap');
      return loop({ repeatDelay: 0.5 })
        .fromTo(drop, { y: -48, opacity: 0 }, { y: 0, opacity: 1, duration: 0.55, ease: 'power2.in' })
        .to(drop, { scaleY: 0.4, scaleX: 1.5, opacity: 0, transformOrigin: '50% 100%', duration: 0.16, ease: 'power1.out' })
        .fromTo(cap, { scale: 1 }, { scale: 1.45, transformOrigin: '50% 50%', duration: 0.12, yoyo: true, repeat: 1 }, '<');
    },
    electric() {
      const wiring = q('.s-wiring');
      const beam = q('.fx-beam');
      gsap.set(wiring, { strokeDasharray: '16 12' });
      return loop()
        .fromTo(beam, { attr: { 'fill-opacity': 0 } }, {
          keyframes: [
            { attr: { 'fill-opacity': 0.85 }, duration: 0.06 },
            { attr: { 'fill-opacity': 0.25 }, duration: 0.1 },
            { attr: { 'fill-opacity': 1 }, duration: 0.35 },
            { attr: { 'fill-opacity': 1 }, duration: 1.8 },
          ],
        }, 0)
        .fromTo(wiring, { strokeDashoffset: 0 }, { strokeDashoffset: -168, duration: 2.31, ease: 'none' }, 0);
    },
    scan() {
      const line = overlay.querySelector('.lp-scanline');
      const bars = q('.fx-scan-bars');
      return loop()
        .set(line, { opacity: 1 }, 0)
        .fromTo(line, { attr: { x: 160 } }, { attr: { x: 1060 }, duration: 1.5, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0)
        .fromTo(bars, { scaleY: 1 }, { scaleY: 0.35, transformOrigin: '50% 100%', duration: 0.25, ease: 'steps(3)', yoyo: true, repeat: 11 }, 0);
    },
    inspect() {
      const checks = q('.fx-check');
      return loop({ repeatDelay: 0.3 })
        .fromTo(checks, { scale: 0, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.45, ease: 'back.out(2.4)', stagger: 0.34 })
        .to(checks, { scale: 0, duration: 0.22, ease: 'power2.in', stagger: 0.05 }, '+=1.8');
    },
    axle() {
      return loop()
        .fromTo(q('.fx-thread'), { x: 0 }, { x: -8, duration: 0.16, ease: 'none', repeat: 9 }, 0)
        .fromTo(q('.fx-chip'), { x: 0, y: 0, opacity: 0 }, { x: 16, y: 12, opacity: 1, duration: 0.5, stagger: 0.26, ease: 'power1.out' }, 0)
        .to(q('.fx-chip'), { opacity: 0, duration: 0.3 }, 1.1);
    },
    hub() {
      const ring = q('.fx-bearing-ring');
      const press = q('.fx-press');
      return loop({ repeatDelay: 0.9 })
        .fromTo(press, { scale: 1.3, opacity: 0, transformOrigin: '50% 50%' }, { scale: 1, opacity: 1, duration: 0.35 }, 0)
        .fromTo(ring, { scale: 1.9, opacity: 0, transformOrigin: '50% 50%' }, { scale: 1, opacity: 1, duration: 0.75, ease: 'power3.in' }, 0.1)
        .to(ring, { scale: 0.93, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.out' });
    },
    body() {
      const specks = q('.fx-specks circle');
      return loop()
        .fromTo(q('.fx-mist'), { scale: 0.75, transformOrigin: '80% 20%' }, { scale: 1.15, duration: 0.9, ease: 'sine.inOut', yoyo: true, repeat: 1 }, 0)
        .fromTo(specks, { x: 46, y: -44, opacity: 0 }, { x: 0, y: 0, opacity: 1, duration: 0.55, ease: 'power1.in', stagger: 0.14 }, 0)
        .to(specks, { opacity: 0, duration: 0.3, stagger: 0.14 }, 0.7);
    },
    wash() {
      const bubbles = q('.fx-foam circle');
      const drops = q('.fx-foam path');
      return loop({ repeatDelay: 0.2 })
        .fromTo(bubbles, { scale: 0, y: 0, opacity: 1, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.45, ease: 'back.out(3)', stagger: { each: 0.05, from: 'edges' } })
        .fromTo(drops, { y: -24, opacity: 0 }, { y: 26, opacity: 1, duration: 0.7, ease: 'power2.in', stagger: 0.18 }, 0.3)
        .to(bubbles, { y: -16, opacity: 0, duration: 0.7, stagger: { each: 0.04, from: 'center' } }, '+=0.9');
    },
    detail() {
      const shine = q('.fx-shine > path');
      const stars = q('.fx-star');
      gsap.set(shine, { strokeDasharray: '70 420' });
      return loop({ repeatDelay: 0.4 })
        .fromTo(shine, { strokeDashoffset: 80 }, { strokeDashoffset: -420, duration: 1.1, ease: 'power2.inOut' })
        .fromTo(stars, { scale: 0, rotation: 0, transformOrigin: '50% 50%' }, { scale: 1, rotation: 90, duration: 0.32, ease: 'power2.out', stagger: 0.16, yoyo: true, repeat: 1 }, 0.5);
    },
    helmet() {
      const helmet = inner('.s-helmet');
      const foam = q('.fx-helmet-foam circle');
      return loop({ repeatDelay: 0.4 })
        .fromTo(helmet, { y: -90, rotation: -8, transformOrigin: '50% 100%' }, { y: 0, rotation: 0, duration: 0.75, ease: 'bounce.out' })
        .fromTo(foam, { scale: 0, y: 0, opacity: 1, transformOrigin: '50% 50%' }, { scale: 1, duration: 0.4, ease: 'back.out(3)', stagger: 0.07 })
        .to(foam, { y: -12, opacity: 0, duration: 0.6, stagger: 0.05 }, '+=1');
    },
  };
}

/** Cabeza de llave de trinquete: 24 dientes. */
function ratchetSvg() {
  const svg = el('svg', { class: 'lp-ratchet', viewBox: '-26 -26 52 52', 'aria-hidden': 'true', focusable: 'false' });
  const head = el('g', { class: 'lp-ratchet-head' }, svg);
  let d = '';
  for (let i = 0; i < 24; i++) {
    const a = polar(0, 0, 19, i * 15 - 4);
    const b = polar(0, 0, 23, i * 15);
    const c = polar(0, 0, 19, i * 15 + 4);
    d += `${i ? 'L' : 'M'}${a.x.toFixed(2)} ${a.y.toFixed(2)}L${b.x.toFixed(2)} ${b.y.toFixed(2)}L${c.x.toFixed(2)} ${c.y.toFixed(2)}`;
  }
  el('path', { d: d + 'Z', fill: '#F25C05' }, head);
  el('circle', { r: 9, fill: '#0e0f11' }, head);
  el('rect', { x: -3, y: -3, width: 6, height: 6, fill: '#F25C05' }, head);
  return svg;
}

function setupDesktop(root, gsap) {
  const ST = window.ScrollTrigger;
  const list = root.querySelector('.lp-service-list');
  const items = Array.from(root.querySelectorAll('.lp-service'));
  const stageSvg = root.querySelector('.lp-stage-svg');
  const source = document.getElementById('lp-bike-art');
  if (!ST || !list || !stageSvg || !source || items.length < 2) return () => {};
  const n = items.length;

  // Escenario: se clona el arte una sola vez (las lupas siguen usando <use>).
  const use = stageSvg.querySelector('use');
  const art = source.cloneNode(true);
  art.removeAttribute('id');
  art.classList.add('lp-stage-art');
  stageSvg.replaceChild(art, use);

  // Lámpara de inspección: penumbra con un agujero de luz sobre la parte activa.
  const defs = el('defs', {}, stageSvg);
  const grad = el('radialGradient', { id: 'lp-g-lamp' }, defs);
  el('stop', { offset: '0', 'stop-color': '#000' }, grad);
  el('stop', { offset: '.55', 'stop-color': '#000' }, grad);
  el('stop', { offset: '1', 'stop-color': '#fff' }, grad);
  const glowGrad = el('radialGradient', { id: 'lp-g-lampglow' }, defs);
  el('stop', { offset: '0', 'stop-color': '#ffd9b0', 'stop-opacity': '.22' }, glowGrad);
  el('stop', { offset: '1', 'stop-color': '#ffd9b0', 'stop-opacity': '0' }, glowGrad);
  const scanGrad = el('linearGradient', { id: 'lp-g-scan', x1: '0', x2: '1' }, defs);
  el('stop', { offset: '0', 'stop-color': '#F25C05', 'stop-opacity': '0' }, scanGrad);
  el('stop', { offset: '.5', 'stop-color': '#ffb13b', 'stop-opacity': '.95' }, scanGrad);
  el('stop', { offset: '1', 'stop-color': '#F25C05', 'stop-opacity': '0' }, scanGrad);
  const mask = el('mask', { id: 'lp-lamp-mask', maskUnits: 'userSpaceOnUse', x: '-400', y: '-400', width: '2000', height: '1500' }, defs);
  el('rect', { x: '-400', y: '-400', width: '2000', height: '1500', fill: '#fff' }, mask);
  const hole = el('circle', { cx: 600, cy: 400, r: 600, fill: 'url(#lp-g-lamp)' }, mask);
  const overlay = el('g', { class: 'lp-stage-overlay' }, stageSvg);
  el('rect', { x: '-400', y: '-400', width: '2000', height: '1500', fill: '#0b0c0e', 'fill-opacity': '.66', mask: 'url(#lp-lamp-mask)' }, overlay);
  const glow = el('circle', { cx: 600, cy: 400, r: 600, fill: 'url(#lp-g-lampglow)', style: 'mix-blend-mode:screen' }, overlay);
  el('rect', { class: 'lp-scanline', x: 160, y: 60, width: 26, height: 560, fill: 'url(#lp-g-scan)', opacity: 0 }, overlay);

  const fx = fxFactories(gsap, art, overlay);
  const aspect = ART[2] / ART[3];

  // Pestañas accesibles (solo en este modo; en móvil es una lista normal).
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-orientation', 'vertical');
  list.setAttribute('aria-label', 'Servicios del taller');
  const tabs = items.map((li, i) => {
    const h3 = li.querySelector('.lp-service-name');
    const panel = li.querySelector('.lp-service-panel');
    const slug = li.dataset.slug;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lp-tab';
    btn.id = `lp-tab-${slug}`;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-controls', `lp-panel-${slug}`);
    while (h3.firstChild) btn.appendChild(h3.firstChild);
    h3.appendChild(btn);
    li.setAttribute('role', 'presentation');
    panel.id = `lp-panel-${slug}`;
    panel.setAttribute('role', 'tabpanel');
    panel.setAttribute('aria-labelledby', btn.id);
    btn.addEventListener('click', () => goTo(i));
    btn.addEventListener('keydown', (e) => {
      const map = { ArrowDown: i + 1, ArrowRight: i + 1, ArrowUp: i - 1, ArrowLeft: i - 1, Home: 0, End: n - 1 };
      if (!(e.key in map)) return;
      e.preventDefault();
      const j = Math.max(0, Math.min(n - 1, map[e.key]));
      tabs[j].focus();
      goTo(j);
    });
    return btn;
  });

  // El trinquete vive en el contenedor del escenario (no dentro de la lista):
  // así el panel de la derecha sigue midiéndose contra todo el escenario.
  const ratchet = ratchetSvg();
  list.parentElement.appendChild(ratchet);
  const counter = document.createElement('p');
  counter.className = 'lp-stage-count';
  counter.setAttribute('aria-hidden', 'true');
  list.after(counter);

  root.classList.add('is-staged');

  let active = -1;
  let current = null;

  function setActive(i, instant = false) {
    if (i === active) return;
    active = i;
    const li = items[i];
    items.forEach((it, j) => it.classList.toggle('is-active', j === i));
    tabs.forEach((t, j) => {
      t.setAttribute('aria-selected', String(j === i));
      t.tabIndex = j === i ? 0 : -1;
    });
    counter.textContent = `${String(i + 1).padStart(2, '0')} / ${String(n).padStart(2, '0')}`;

    const sys = li.dataset.system;
    SYSTEMS.forEach((s) => stageSvg.style.setProperty(`--on-${s}`, s === sys ? '1' : '0'));

    const focus = li.dataset.focus.split(' ').map(Number);
    const [lx, ly, lr] = li.dataset.lamp.split(' ').map(Number);
    const box = cameraBox(focus, ART, aspect);
    const d = instant ? 0 : 0.9;
    gsap.to(stageSvg, { attr: { viewBox: viewBoxString(box) }, duration: d, ease: 'power3.inOut', overwrite: true });
    gsap.to([hole, glow], { attr: { cx: lx, cy: ly, r: lr }, duration: d, ease: 'power3.inOut', overwrite: true });
    gsap.to(ratchet, { y: li.offsetTop + li.offsetHeight / 2 - 20, duration: instant ? 0 : 0.5, ease: "back.out(1.8)", overwrite: "auto" });

    activeSys = sys;
    syncFx();
  }

  // La micro-animación solo existe mientras la sección está en pantalla y la
  // pestaña visible. Fuera de eso se destruye (no solo se pausa): una línea de
  // tiempo pausada en bucle impide que el ticker de GSAP se duerma.
  let activeSys = null;
  let runningSys = null;
  let visible = false;
  function stopFx() {
    if (!current) return;
    current.kill();
    current = null;
    runningSys = null;
    gsap.set(art.querySelectorAll('.fx *, .s-wiring, .s-oil-cap, .s-helmet *'), { clearProps: 'transform,opacity,strokeDasharray,strokeDashoffset,fillOpacity' });
    gsap.set(overlay.querySelector('.lp-scanline'), { opacity: 0 });
  }
  function syncFx() {
    const want = visible && !document.hidden ? activeSys : null;
    if (want === runningSys) return;
    stopFx();
    if (want && fx[want]) {
      current = fx[want]();
      runningSys = want;
    }
  }
  const io = new IntersectionObserver((entries) => {
    visible = entries.some((e) => e.isIntersecting);
    syncFx();
  });
  io.observe(root);
  const onVis = () => syncFx();
  document.addEventListener('visibilitychange', onVis);

  const st = ST.create({
    trigger: root,
    start: 'top top',
    end: () => '+=' + Math.round(window.innerHeight * 0.5 * (n - 1)),
    pin: true,
    anticipatePin: 1,
    // Parada de trinquete: siempre a la más cercana (el modo direccional de GSAP
    // empuja a la siguiente con un píxel de más). Mientras una pestaña está
    // llevando el scroll a su servicio, el snap no mueve nada: si no, el snap
    // pendiente del último giro de rueda se queda con el desplazamiento.
    snap: {
      snapTo: (v) => (navigating ? v : detentProgress(detentIndex(v, n), n)),
      directional: false, duration: { min: 0.18, max: 0.45 }, delay: 0.06, ease: 'power2.inOut',
    },
    onUpdate(self) {
      setActive(detentIndex(self.progress, n));
      gsap.set(ratchet.querySelector('.lp-ratchet-head'), { rotation: ratchetAngle(self.progress, n, 24), svgOrigin: '0 0' });
    },
  });

  // Navegación desde una pestaña: un tween propio sobre el scroll (en vez del
  // scroll suave del navegador) para poder coordinarlo con el snap.
  let navigating = false;
  let navTween = null;
  const scrollPos = { y: 0 };
  const stopNav = () => {
    navTween?.kill();
    navTween = null;
    navigating = false;
  };
  function goTo(i) {
    st.getTween(true)?.kill();
    stopNav();
    const y = Math.round(st.start + (st.end - st.start) * detentProgress(i, n));
    scrollPos.y = window.scrollY;
    navigating = true;
    const distance = Math.abs(y - scrollPos.y);
    navTween = gsap.to(scrollPos, {
      y, duration: Math.min(1.2, 0.45 + distance / 5000), ease: 'power2.inOut',
      onUpdate: () => window.scrollTo(0, scrollPos.y),
      onComplete: () => { navigating = false; navTween = null; },
    });
    setActive(i);
  }
  // Si la persona mueve la rueda o toca la pantalla a mitad de camino, manda ella.
  const userTakesOver = () => navigating && stopNav();
  window.addEventListener('wheel', userTakesOver, { passive: true });
  window.addEventListener('touchstart', userTakesOver, { passive: true });

  setActive(0, true);
  ST.refresh();

  return () => {
    stopNav();
    window.removeEventListener('wheel', userTakesOver);
    window.removeEventListener('touchstart', userTakesOver);
    st.kill(true);
    io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    stopFx();
    root.classList.remove('is-staged');
    list.removeAttribute('role');
    list.removeAttribute('aria-orientation');
    list.removeAttribute('aria-label');
    items.forEach((li) => {
      li.classList.remove('is-active');
      li.removeAttribute('role');
      const h3 = li.querySelector('.lp-service-name');
      const btn = h3.querySelector('.lp-tab');
      if (btn) {
        while (btn.firstChild) h3.appendChild(btn.firstChild);
        btn.remove();
      }
      const panel = li.querySelector('.lp-service-panel');
      ['id', 'role', 'aria-labelledby'].forEach((a) => panel.removeAttribute(a));
    });
    ratchet.remove();
    counter.remove();
    stageSvg.replaceChildren(use);
    stageSvg.setAttribute('viewBox', '0 0 1200 700');
    SYSTEMS.forEach((s) => stageSvg.style.removeProperty(`--on-${s}`));
  };
}

function setupMobile(root) {
  const list = root.querySelector('.lp-service-list');
  const items = Array.from(root.querySelectorAll('.lp-service'));
  if (!list || !items.length) return () => {};
  root.classList.add('is-armed');

  // Puntos + contador bajo el carrusel (solo se ven ≤700 px, vía CSS).
  const dots = document.createElement('div');
  dots.className = 'lp-carousel-dots';
  dots.setAttribute('aria-hidden', 'true');
  items.forEach(() => dots.appendChild(document.createElement('span')));
  const count = document.createElement('span');
  count.className = 'lp-carousel-count';
  dots.appendChild(count);
  list.after(dots);

  const isCarousel = () => getComputedStyle(list).overflowX === 'auto';
  let io = null;
  const observe = () => {
    io?.disconnect();
    const carousel = isCarousel();
    io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (!e.isIntersecting) return;
          const i = items.indexOf(e.target);
          e.target.classList.add('is-in');
          if (carousel) {
            dots.querySelectorAll('span:not(.lp-carousel-count)').forEach((d, j) => d.classList.toggle('is-on', j === i));
            count.textContent = `${String(i + 1).padStart(2, '0')} / ${String(items.length).padStart(2, '0')}`;
          }
        });
      },
      carousel ? { root: list, threshold: 0.6 } : { threshold: 0.45 },
    );
    items.forEach((it) => io.observe(it));
  };
  observe();
  const mq = window.matchMedia('(max-width: 700px)');
  mq.addEventListener('change', observe);

  return () => {
    io?.disconnect();
    mq.removeEventListener('change', observe);
    dots.remove();
    root.classList.remove('is-armed');
    items.forEach((it) => it.classList.remove('is-in'));
  };
}

export default function initServices(root) {
  const gsap = getGsap();
  if (!gsap) return { destroy() {} };
  const mm = gsap.matchMedia();
  mm.add({ desktop: MQ.desktop, mobile: MQ.mobile }, (ctx) => {
    const { desktop } = ctx.conditions;
    return desktop ? setupDesktop(root, gsap) : setupMobile(root);
  });
  return { destroy: () => mm.revert() };
}
