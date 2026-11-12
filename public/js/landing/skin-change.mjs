// "Cambio de piel": la moto de la cabina pasa por pintura, detailing y wrap.
//
// Cada acabado es una copia de la moto con un recorte (clipPath) que se abre
// de izquierda a derecha. La herramienta del paso viaja pegada al borde del
// recorte: la pistola pinta (con su nube), la pulidora gira y saca destellos,
// el rollo de vinilo forra. Los pasos del texto se encienden con su avance.
//
// Escritorio: la sección se fija y el scroll mueve la línea de tiempo.
// Móvil: la línea de tiempo corre sola en bucle mientras la sección se ve.
// Fail-open: si algo falla, los recortes vuelven a las franjas del servidor.

import { MQ, getGsap, pauseOffscreen } from '../motion/core.mjs?v=1';

const X0 = 150; // borde izquierdo del viewBox de la cabina
const FULL = 900; // ancho del viewBox
const OVER = 70; // la herramienta sigue un poco más para salir del cuadro
const STEP = 1; // duración de cada pasada (unidades de la línea de tiempo)
const GAP = 0.3; // respiro entre pasadas

export default function initSkin(root) {
  const gsap = getGsap();
  if (!gsap || !window.ScrollTrigger) throw new Error('GSAP no disponible');

  const svg = root.querySelector('.lp-skin-svg');
  const rects = ['es-c1', 'es-c2', 'es-c3'].map((id) => svg.querySelector(`#${id} rect`));
  const tools = ['.es-gun', '.es-polisher', '.es-roll'].map((s) => svg.querySelector(s));
  const mist = svg.querySelector('.es-mist');
  const padLines = svg.querySelector('.es-pad-lines');
  const sparks = svg.querySelectorAll('.es-sparks path');
  const bands = svg.querySelector('.es-bands');
  const layers = rects.map((r) => svg.querySelector(`[clip-path="url(#${r.parentNode.id})"]`));
  const items = Array.from(root.querySelectorAll('.lp-skin-steps li'));
  if (rects.some((r) => !r) || tools.some((t) => !t)) throw new Error('faltan piezas de la cabina');

  // Estado del servidor (franjas), para devolverlo si algo falla.
  const original = rects.map((r) => ({ x: r.getAttribute('x'), width: r.getAttribute('width') }));
  const restore = () => {
    rects.forEach((r, i) => {
      r.setAttribute('x', original[i].x);
      r.setAttribute('width', original[i].width);
    });
    tools.forEach((t) => t.removeAttribute('transform'));
    layers.forEach((l) => l && l.style.removeProperty('opacity'));
    [...tools, ...sparks].forEach((el) => el.style.removeProperty('opacity'));
    sparks.forEach((el) => el.style.removeProperty('transform'));
    items.forEach((li) => {
      li.classList.remove('is-active', 'is-done');
      li.style.removeProperty('--p');
    });
    root.classList.remove('is-pinned');
  };

  // Dónde está el borde de cada pasada y cómo se ve su herramienta ahí.
  const place = [
    // Pistola: arriba, con un leve vaivén de pintor y la nube que respira.
    (w) => {
      const y = 182 + Math.sin(w / 38) * 10;
      tools[0].setAttribute('transform', `translate(${X0 + w} ${y}) rotate(${Math.sin(w / 60) * 6})`);
      if (mist) mist.setAttribute('ry', String(78 + Math.sin(w / 9) * 10));
    },
    // Pulidora: sobre el tanque, el disco gira con el avance.
    (w) => {
      const y = 262 + Math.sin(w / 70) * 22;
      tools[1].setAttribute('transform', `translate(${X0 + w} ${y})`);
      if (padLines) padLines.setAttribute('transform', `rotate(${w * 4})`);
    },
    // Rollo de vinilo: de arriba abajo, pegado al borde.
    (w) => tools[2].setAttribute('transform', `translate(${X0 + w} 0)`),
  ];

  let tl;
  let killOffscreen = null;
  let mm;

  function build({ loop }) {
    const t = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
    rects.forEach((r, i) => {
      const proxy = { w: 0 };
      const start = i * (STEP + GAP);
      const update = () => {
        r.setAttribute('x', String(X0));
        r.setAttribute('width', String(Math.min(proxy.w, FULL)));
        place[i](proxy.w);
      };
      update();
      t.fromTo(tools[i], { opacity: 0 }, { opacity: 1, duration: 0.12 }, start);
      t.fromTo(proxy, { w: 0 }, { w: FULL + OVER, duration: STEP, ease: 'power1.inOut', onUpdate: update }, start);
      t.to(tools[i], { opacity: 0, duration: 0.12 }, start + STEP - 0.12);
    });
    // Destellos que deja el detailing, antes de que llegue el vinilo.
    const sparkAt = 1 * (STEP + GAP) + STEP * 0.55;
    t.fromTo(sparks, { opacity: 0, scale: 0 }, { opacity: 1, scale: 1, rotate: 45, duration: 0.18, stagger: 0.08, ease: 'back.out(3)' }, sparkAt);
    t.to(sparks, { opacity: 0, scale: 0.4, duration: 0.2, stagger: 0.05 }, sparkAt + 0.55);
    // Pausa con la moto ya forrada.
    t.to({}, { duration: 0.45 });
    if (loop) {
      // En bucle: las capas se desvanecen y vuelve "así llega".
      t.to(layers, { opacity: 0, duration: 0.35, ease: 'power1.in' });
      t.set(layers, { opacity: 1 });
      t.repeat(-1).repeatDelay(0.5);
    }
    // time() es el tiempo dentro de la vuelta actual (también en bucle).
    t.eventCallback('onUpdate', () => paintSteps(t.time()));
    return t;
  }

  // El paso activo y su barra de avance, según el tiempo de la línea.
  function paintSteps(time) {
    items.forEach((li, i) => {
      const start = i * (STEP + GAP);
      const p = Math.max(0, Math.min(1, (time - start) / STEP));
      li.style.setProperty('--p', p.toFixed(3));
      const active = time >= start - GAP / 2 && (i === items.length - 1 || time < start + STEP + GAP / 2);
      li.classList.toggle('is-active', active);
      li.classList.toggle('is-done', !active && p >= 1);
    });
  }

  try {
    root.classList.add('is-armed');
    gsap.set(bands, { opacity: 0 });

    mm = gsap.matchMedia();
    mm.add(MQ.desktop, () => {
      root.classList.add('is-pinned');
      tl = build({ loop: false });
      const st = window.ScrollTrigger.create({
        trigger: root,
        start: 'top top',
        end: '+=220%',
        pin: true,
        scrub: 0.6,
        animation: tl,
      });
      paintSteps(0);
      return () => {
        st.kill();
        tl.kill();
        root.classList.remove('is-pinned');
      };
    });
    mm.add(MQ.mobile, () => {
      tl = build({ loop: true });
      paintSteps(0);
      killOffscreen = pauseOffscreen(root, tl);
      return () => {
        if (killOffscreen) killOffscreen();
        killOffscreen = null;
        tl.kill();
      };
    });
  } catch (err) {
    if (mm) mm.revert();
    restore();
    throw err;
  }

  return {
    destroy() {
      if (mm) mm.revert();
      restore();
    },
  };
}
