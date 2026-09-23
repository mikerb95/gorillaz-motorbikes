// Tienda: las etiquetas de precio cuelgan de un hilo y se mecen.
//
// En el mostrador del taller los precios van en etiquetas de cartón colgadas
// del producto. Aquí cada precio es una de esas etiquetas y responde a lo que
// hace el visitante: al pasar el cursor por la tarjeta la empuja en la
// dirección del movimiento, y en móvil la mueve la velocidad del scroll. Al
// aparecer la sección "las cuelgan" y se mecen hasta quedarse quietas.
//
// Mecanismo propio: péndulo amortiguado de verdad (lib/pendulum.mjs), no un
// tween. Cada etiqueta tiene un largo distinto (semilla del producto) para
// que no se muevan al unísono. El bucle se duerme cuando todas están quietas.

import { createLoop, getGsap } from '../motion/core.mjs?v=1';
import { stepPendulum, atRest } from '../motion/lib/pendulum.mjs?v=1';
import { hashString, mulberry32, between } from '../motion/lib/prng.mjs?v=1';

export default function initShopTags(root) {
  const cards = Array.from(root.querySelectorAll('.lp-product'));
  const tags = cards
    .map((card) => {
      const tag = card.querySelector('.lp-tag');
      if (!tag) return null;
      const id = card.querySelector('.btn-add-cart')?.dataset.id || card.textContent.slice(0, 20);
      const rand = mulberry32(hashString(id));
      return {
        card, tag,
        state: { angle: 0, velocity: 0 },
        push: 0,
        stiffness: between(rand, 26, 40), // etiquetas "más largas" oscilan más lento
        entrance: between(rand, 0.7, 1.2) * (rand() > 0.5 ? 1 : -1),
      };
    })
    .filter(Boolean);
  if (!tags.length) return { destroy() {} };

  const grid = root.querySelector('.lp-shop-grid') || root;
  const loop = createLoop(grid, (now, dt) => {
    let moving = false;
    for (const t of tags) {
      t.state = stepPendulum(t.state, { dt: dt / 1000, push: t.push, stiffness: t.stiffness, damping: 2.2, maxAngle: 0.45 });
      t.push = 0;
      t.tag.style.transform = `rotate(${((t.state.angle * 180) / Math.PI).toFixed(2)}deg)`;
      if (!atRest(t.state)) moving = true;
    }
    return moving;
  });

  // Cursor: empuja en la dirección en que se mueve sobre la tarjeta.
  const onMove = (e) => {
    if (e.pointerType !== 'mouse') return;
    const t = tags.find((x) => x.card === e.currentTarget);
    if (!t) return;
    t.push += Math.max(-60, Math.min(60, e.movementX * 4));
    loop.wake();
  };
  tags.forEach((t) => t.card.addEventListener('pointermove', onMove));

  // Scroll: la velocidad de la página las sacude un poco (sobre todo en móvil).
  const gsap = getGsap();
  let st = null;
  let entered = false;
  if (gsap && window.ScrollTrigger) {
    st = window.ScrollTrigger.create({
      trigger: root,
      start: 'top 85%',
      end: 'bottom top',
      onEnter: () => {
        if (entered) return;
        entered = true;
        // "Las cuelgan": cada una recibe su empujón, escalonado.
        tags.forEach((t, i) => setTimeout(() => {
          t.state.velocity += t.entrance * 3.2;
          loop.wake();
        }, i * 140));
      },
      onUpdate: (self) => {
        const v = self.getVelocity();
        if (Math.abs(v) < 250) return;
        tags.forEach((t, i) => (t.push += (v / 1000) * (i % 2 ? 7 : -7)));
        loop.wake();
      },
    });
  }

  return {
    destroy() {
      loop.destroy();
      st?.kill();
      tags.forEach((t) => {
        t.card.removeEventListener('pointermove', onMove);
        t.tag.style.removeProperty('transform');
      });
    },
  };
}
