// Rotuladora: imprime las cintas de "lo que hacemos" de cada ficha.
//
// Cada cinta sale de la rotuladora a saltos, un salto por letra (la rotuladora
// real imprime con un apretón por carácter), y la siguiente arranca cuando se
// corta la anterior. Es el mecanismo propio de las fichas: no hay fundidos,
// la cinta simplemente no existe hasta que se imprime.
//
// Estado final (sin JS o movimiento reducido): las cintas ya impresas.

import { printSchedule } from '../motion/lib/dymo.mjs?v=1';

/** Deja las cintas de una ficha sin imprimir (para imprimirlas después). */
export function hideTapes(gsap, card) {
  const tapes = card.querySelectorAll('.sv-dymo');
  gsap.set(tapes, { clipPath: 'inset(0% 100% 0% 0%)' });
  card.dataset.printed = 'no';
}

/** Imprime las cintas de una ficha una sola vez. Devuelve la línea de tiempo. */
export function printTapes(gsap, card) {
  if (card.dataset.printed === 'yes') return null;
  card.dataset.printed = 'yes';
  const tapes = Array.from(card.querySelectorAll('.sv-dymo'));
  const plan = printSchedule(tapes.map((t) => t.textContent.trim()));
  const tl = gsap.timeline();
  tapes.forEach((tape, i) => {
    const { at, duration, steps } = plan[i];
    tl.fromTo(tape, { clipPath: 'inset(0% 100% 0% 0%)' }, { clipPath: 'inset(0% 0% 0% 0%)', duration, ease: `steps(${steps})` }, at)
      // El corte de la cinta: un golpecito seco al terminar.
      .fromTo(tape, { y: -2 }, { y: 0, duration: 0.14, ease: 'power2.out' }, at + duration);
  });
  tl.eventCallback('onComplete', () => gsap.set(tapes, { clearProps: 'clipPath,transform' }));
  return tl;
}
