// Motion de la landing del club: "Cose tu chaleco".
//
// La página afirma tres cosas y el chaleco las demuestra mientras se leen:
//   1. "Cada salida suma": la pestaña del chaleco cuenta los puntos de la
//      lista a medida que cada actividad pasa por la mitad de la pantalla.
//   2. "Tu nivel va en la espalda": la pestaña se borda con cada nivel real
//      (nombre y color de la configuración del admin).
//   3. "Insignias que se ganan rodando": cada fila de insignia que pasa cose
//      su parche; al devolverse, se descose y queda la tiza.
//
// Escritorio: el chaleco queda fijo (CSS sticky) y el scroll marca el ritmo.
// Móvil: el chaleco va arriba del titular y la coreografía corre una vez por
// tiempo al cargar (el chaleco no acompaña al texto en una pantalla angosta).
// Con movimiento reducido no se monta nada: el servidor ya pinta el chaleco
// completo, que es el estado final.

import { mount, prefersReduced, getGsap, MQ } from '../motion/core.mjs?v=1';
import { stitch, unstitch, setLevelTab } from './vest.mjs?v=1';

function init(root) {
  const gsap = getGsap();
  const ST = window.ScrollTrigger;
  if (!gsap || !ST) return null;
  const vest = root.querySelector('.cl-vest');
  if (!vest) return null;

  const patches = Array.from(vest.querySelectorAll('.cl-patch'));
  const label = vest.querySelector('.cl-lvl-text');
  const fill = vest.querySelector('.cl-lvl-fill');
  const original = { text: label ? label.textContent : '', color: fill ? fill.getAttribute('style') : '' };
  const levelRows = Array.from(root.querySelectorAll('[data-level]'));
  const first = levelRows[0];
  const base = first ? { text: first.dataset.name, color: first.dataset.color } : { text: original.text };
  const earnStep = root.querySelector('[data-step="earn"]');
  const totals = earnStep ? JSON.parse(earnStep.dataset.steps || '[]') : [];
  const earnRows = Array.from(root.querySelectorAll('[data-earn]'));
  const badgeRows = Array.from(root.querySelectorAll('[data-badge-row]'));
  const parts = vest.querySelectorAll('[data-part]');

  root.classList.add('is-armed');
  patches.forEach((p) => unstitch(gsap, p));

  // Entrada: el chaleco cae sobre el gancho y se asientan rocker, logo y
  // pestaña. Es el único momento que ocurre sin que el visitante haga nada.
  const intro = gsap.timeline();
  intro.from(vest, { y: -24, rotation: -2, opacity: 0, duration: 0.7, ease: 'power3.out', transformOrigin: '50% 0%', clearProps: 'transform,opacity' });
  intro.from(parts, { opacity: 0, scale: 1.12, duration: 0.35, stagger: 0.12, ease: 'power2.out', transformOrigin: '50% 50%', clearProps: 'transform,opacity' }, '-=0.25');

  const mm = gsap.matchMedia();
  const triggers = [];

  mm.add(MQ.desktop, () => {
    // 1. Puntos: la pestaña muestra el acumulado de las filas ya leídas.
    earnRows.forEach((row, i) => {
      triggers.push(ST.create({
        trigger: row,
        start: 'top 58%',
        end: 'bottom 58%',
        onToggle: (self) => row.classList.toggle('is-on', self.isActive),
        onEnter: () => setLevelTab(vest, { text: `${totals[i]} pts`, color: '#F25C05' }),
        onLeaveBack: () => setLevelTab(vest, i === 0 ? base : { text: `${totals[i - 1]} pts`, color: '#F25C05' }),
      }));
    });
    // 2. Niveles: cada fila que pasa borda su nivel en la pestaña.
    levelRows.forEach((row, i) => {
      triggers.push(ST.create({
        trigger: row,
        start: 'top 55%',
        end: 'bottom 55%',
        onToggle: (self) => row.classList.toggle('is-on', self.isActive),
        onEnter: () => setLevelTab(vest, { text: row.dataset.name, color: row.dataset.color }),
        onLeaveBack: () => {
          const prev = levelRows[i - 1];
          if (prev) setLevelTab(vest, { text: prev.dataset.name, color: prev.dataset.color });
          else setLevelTab(vest, { text: `${totals[totals.length - 1] || 0} pts`, color: '#F25C05' });
        },
      }));
    });
    // 3. Insignias: cada fila cose su parche; hacia atrás se descose.
    badgeRows.forEach((row) => {
      const patch = vest.querySelector(`[data-badge="${row.dataset.badgeRow}"]`);
      if (!patch) return;
      triggers.push(ST.create({
        trigger: row,
        start: 'top 62%',
        onEnter: () => stitch(gsap, patch),
        onLeaveBack: () => unstitch(gsap, patch),
      }));
    });
    return () => {
      triggers.splice(0).forEach((t) => t.kill());
      patches.forEach((p) => unstitch(gsap, p));
      earnRows.concat(levelRows).forEach((r) => r.classList.remove('is-on'));
      setLevelTab(vest, base);
    };
  });

  mm.add(MQ.mobile, () => {
    // Una sola pasada por tiempo: los parches se cosen en fila tras la entrada.
    const tl = gsap.timeline({ delay: 0.9 });
    patches.forEach((p, i) => tl.add(stitch(gsap, p, { speed: 1.6 }), i * 0.16));
    return () => tl.kill();
  });

  return {
    destroy() {
      mm.revert();
      intro.kill();
      if (label) label.textContent = original.text;
      if (fill) fill.setAttribute('style', original.color || '');
    },
  };
}

if (!prefersReduced()) {
  document.documentElement.classList.add('motion-ok');
  mount('[data-club="landing"]', init);
  if (window.ScrollTrigger) window.addEventListener('load', () => window.ScrollTrigger.refresh(), { once: true });
}
