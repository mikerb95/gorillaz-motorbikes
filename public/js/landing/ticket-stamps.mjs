// Estado de tu moto: la ficha de trabajo recibe un sello por cada etapa.
//
// La sección afirma "revisa en qué etapa está el trabajo, sin llamar al
// taller". La prueba es la ficha misma: se escribe la placa (como en
// /mi-orden) y luego cae un sello de caucho por cada etapa real del sistema.
// Las filas aparecen cuando tienen sentido: los comentarios del taller con
// "Trabajo en curso", el valor total con "Listo para recoger" y los días de
// parqueadero con "Entregado".
//
// Mecanismo propio de esta sección: el IMPACTO. El sello baja acelerando
// (sale de fuera del papel, grande y ladeado), aplasta un poco la tinta y
// empuja la ficha, que cuelga de un gancho y se mece con física de péndulo.
//
// Escritorio: la sección se fija y el scroll marca el ritmo (se puede
// devolver). Móvil: la misma coreografía se reproduce una vez por tiempo.
// Todo es "Ejemplo ilustrativo" (así lo dice la ficha).

import { getGsap, MQ, createLoop } from '../motion/core.mjs?v=1';
import { ticketState, typedPlate } from '../motion/lib/ticket.mjs?v=1';
import { stepPendulum, atRest } from '../motion/lib/pendulum.mjs?v=1';
import { hashString, mulberry32, between } from '../motion/lib/prng.mjs?v=1';

const PLATE_SHARE = 0.18;

function build(root, gsap) {
  const ticket = root.querySelector('.lp-ticket');
  const stamps = Array.from(root.querySelectorAll('.lp-stamp'));
  const rows = Array.from(root.querySelectorAll('.lp-ticket-rows > div'));
  const top = root.querySelector('.lp-plate-top');
  const bottom = root.querySelector('.lp-plate-bottom');
  if (!ticket || !stamps.length || !top || !bottom) return null;
  const plate = top.dataset.plate + ' ' + bottom.dataset.plate;
  const n = stamps.length;
  const slot = (1 - PLATE_SHARE) / n;
  const landAt = (i) => PLATE_SHARE + slot * (i + 1);
  // Qué fila aparece con qué sello (la primera etapa no trae datos nuevos).
  const rowForStamp = [null, 0, 1, 2];

  // Péndulo de la ficha: gira alrededor del ojal.
  const baseTilt = -2.5;
  let swing = { angle: 0, velocity: 0 };
  let push = 0;
  const loop = createLoop(ticket, (now, dt) => {
    swing = stepPendulum(swing, { dt: dt / 1000, push, stiffness: 30, damping: 2.6, maxAngle: 0.35 });
    push = 0;
    ticket.style.transform = `rotate(${baseTilt + (swing.angle * 180) / Math.PI}deg)`;
    return !atRest(swing);
  });
  const kick = (strength) => {
    push = strength;
    loop.wake();
  };

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'none' } });
  // Fuera de la línea de tiempo global: la maneja ScrollTrigger (o un tween
  // en móvil) y así, pausada, no mantiene despierto el ticker de GSAP.
  gsap.globalTimeline.remove(tl);
  tl.set({}, {}, 1); // duración total = 1 (unidades de progreso)

  // Placa: se escribe carácter por carácter.
  const typing = { f: 0 };
  tl.fromTo(typing, { f: 0 }, {
    f: 1,
    duration: PLATE_SHARE * 0.9,
    onUpdate() {
      const t = typedPlate(plate, typing.f).replace(' ', '');
      top.textContent = t.slice(0, 3);
      bottom.textContent = t.slice(3);
    },
  }, 0);

  // Sellos: rotación con semilla (siempre la misma en cada visita).
  stamps.forEach((stamp, i) => {
    const li = stamp.closest('li');
    const rand = mulberry32(hashString(li.dataset.status || String(i)));
    const rot = between(rand, -5, 5);
    const land = landAt(i);
    stamp.style.setProperty('--rot', `${rot.toFixed(2)}deg`);
    gsap.set(stamp, { transformOrigin: '50% 60%' });
    tl.fromTo(stamp,
      { opacity: 0, scale: 2.3, rotation: rot + between(rand, 8, 14), y: -26, x: between(rand, -12, 12) },
      { opacity: 1, scale: 1, rotation: rot, y: 0, x: 0, duration: slot * 0.55, ease: 'power4.in' },
      land - slot * 0.55);
    // La tinta se aplasta un instante al golpear.
    tl.to(stamp, { scaleX: 1.05, scaleY: 0.94, duration: slot * 0.06, ease: 'power1.out' }, land);
    tl.to(stamp, { scaleX: 1, scaleY: 1, duration: slot * 0.12, ease: 'power2.out' }, land + slot * 0.06);
    const r = rowForStamp[i];
    if (r != null && rows[r]) {
      tl.fromTo(rows[r], { clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0% 0 0)', duration: slot * 0.4, ease: 'power2.out' }, land + slot * 0.05);
    }
  });

  let landed = 0;
  const onProgress = (p) => {
    const { stamped } = ticketState(p, n, PLATE_SHARE);
    if (stamped > landed) kick(26 + stamped * 4); // cada sello empuja un poco más
    landed = stamped;
  };

  const restore = () => {
    tl.kill();
    loop.destroy();
    top.textContent = top.dataset.plate;
    bottom.textContent = bottom.dataset.plate;
    [ticket, ...stamps, ...rows].forEach((node) => gsap.set(node, { clearProps: 'all' }));
    stamps.forEach((s) => s.style.removeProperty('--rot'));
  };
  return { tl, onProgress, restore };
}

export default function initTicket(root) {
  const gsap = getGsap();
  const ST = window.ScrollTrigger;
  if (!gsap || !ST) return { destroy() {} };
  const mm = gsap.matchMedia();

  mm.add({ desktop: MQ.desktop, mobile: MQ.mobile }, (ctx) => {
    const t = build(root, gsap);
    if (!t) return undefined;
    t.tl.progress(0);
    let st;
    if (ctx.conditions.desktop) {
      st = ST.create({
        trigger: root,
        // Centrada si cabe; si la ventana es baja, desde arriba (bajo la navbar).
        start: () => (root.offsetHeight > window.innerHeight - 40 ? 'top top' : 'center center'),
        end: '+=120%',
        pin: true,
        scrub: 0.6,
        animation: t.tl,
        onUpdate: (self) => t.onProgress(self.progress),
      });
    } else {
      // Móvil: sin fijar. Se reproduce una vez, a ritmo de tiempo.
      st = ST.create({
        trigger: root.querySelector('.lp-ticket'),
        start: 'top 78%',
        once: true,
        onEnter: () => {
          gsap.to(t.tl, {
            progress: 1, duration: 4.6, ease: 'none',
            onUpdate: () => t.onProgress(t.tl.progress()),
          });
        },
      });
    }
    return () => {
      st?.kill(true);
      t.restore();
    };
  });

  return { destroy: () => mm.revert() };
}
