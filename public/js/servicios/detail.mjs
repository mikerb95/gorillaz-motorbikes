// Motion de la ficha ampliada (/servicios/<slug>).
//
// Si llegaste desde /servicios, la transición de vista ya trajo la herramienta
// hasta su gancho (vt.js); al terminar, la rotuladora imprime las cintas de lo
// que incluye el servicio, igual que en las fichas del tablero.
// Si entraste directo, la herramienta se cuelga en su gancho (el mismo golpe
// seco de la entrada del tablero) y luego se imprimen las cintas.
//
// Sin JS o con movimiento reducido: herramienta colgada y cintas impresas.
// VERSIONES: caché inmutable en /static; al cambiar un import, sube su ?v=.

import { mount, prefersReduced, getGsap } from '../motion/core.mjs?v=1';
import { hideTapes, printTapes } from './dymo-print.mjs?v=1';

const html = document.documentElement;
const release = () => {
  clearTimeout(window.__svTapesTimer);
  html.classList.remove('sv-tapes-pending');
};

// pagereveal puede no llegar nunca (navegadores sin soporte): no esperar más de 1,5 s.
const revealed = () => Promise.race([
  window.__svRevealed || Promise.resolve(null),
  new Promise((r) => setTimeout(() => r(null), 1500)),
]);

function initDetail(page) {
  const gsap = getGsap();
  const card = page.querySelector('.sv-detail');
  if (!gsap || !card) {
    release();
    return { destroy() {} };
  }
  hideTapes(gsap, card);
  release();
  let tl = null;
  let alive = true;

  revealed().then((vt) => {
    const go = () => {
      if (!alive) return;
      tl = gsap.timeline();
      if (!vt) {
        const tool = card.querySelector('.sv-card-tool .sv-tool');
        tl.fromTo(tool,
          { opacity: 0, y: -40, rotation: -10, transformOrigin: '50% 0%' },
          { opacity: 1, y: 0, rotation: 0, duration: 0.6, ease: 'back.out(2.4)', clearProps: 'transform,opacity' });
      }
      const print = printTapes(gsap, card);
      if (print) tl.add(print, vt ? 0 : 0.35);
    };
    if (vt) vt.finished.then(go, go);
    else go();
  });

  return {
    destroy() {
      alive = false;
      tl?.kill();
      gsap.set(card.querySelectorAll('.sv-dymo, .sv-card-tool .sv-tool'), { clearProps: 'clipPath,transform,opacity' });
    },
  };
}

if (!prefersReduced()) {
  html.classList.add('motion-ok');
  if (!mount('[data-sv="detail"]', initDetail).length) release();
} else {
  release();
}
