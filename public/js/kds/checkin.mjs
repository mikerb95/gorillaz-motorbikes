// Motion del check-in del KDS.
//
// El check-in afirma "en cinco pasos quedas registrado". Cada paso entra
// deslizándose en la dirección en que va el cliente (adelante desde la
// derecha, atrás desde la izquierda), así se siente que avanza y no que la
// pantalla parpadea. Al terminar, su placa aparece en una ficha y cae un
// sello de caucho: "Registrado" (o "Confirmado" si tenía cita).
//
// No toca la lógica del formulario (vive en checkin.ejs): observa las clases
// que esa lógica ya cambia. Si este módulo falla, el formulario sigue igual.
//
// VERSIONES: /static va con caché inmutable; al cambiar un import, sube su ?v=.

import { mount, prefersReduced, getGsap } from '../motion/core.mjs?v=1';

const gsap = getGsap();

function initSteps(card) {
  const steps = Array.from(card.querySelectorAll('.cw-step'));
  const appt = card.querySelector('.cw-appointment');
  let active = steps.findIndex((s) => s.classList.contains('is-active'));

  function enterStep(el, dir) {
    gsap.fromTo(el, { x: 56 * dir, opacity: 0 }, { x: 0, opacity: 1, duration: 0.45, ease: 'power3.out', clearProps: 'transform,opacity' });
    // El campo llega un instante después que la etiqueta: se lee qué se pide.
    const field = el.querySelector('input, .kds-checkin-phone');
    if (field) gsap.fromTo(field, { y: 10 }, { y: 0, duration: 0.5, delay: 0.08, ease: 'power3.out', clearProps: 'transform' });
  }

  function enterAppointment() {
    const icon = appt.querySelector('.icon');
    const rest = Array.from(appt.children).filter((c) => c !== icon);
    gsap.fromTo(icon, { y: -40, rotation: -12, opacity: 0 }, { y: 0, rotation: 0, opacity: 1, duration: 0.7, ease: 'bounce.out', clearProps: 'transform,opacity' });
    gsap.fromTo(rest, { y: 16, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, stagger: 0.06, delay: 0.15, ease: 'power3.out', clearProps: 'transform,opacity' });
  }

  const mo = new MutationObserver(() => {
    const now = steps.findIndex((s) => s.classList.contains('is-active'));
    if (now !== -1 && now !== active) {
      enterStep(steps[now], now > active ? 1 : -1);
      active = now;
    }
  });
  steps.forEach((s) => mo.observe(s, { attributes: true, attributeFilter: ['class'] }));

  let apptOpen = appt && appt.classList.contains('is-active');
  const moAppt = appt && new MutationObserver(() => {
    const open = appt.classList.contains('is-active');
    if (open && !apptOpen) enterAppointment();
    apptOpen = open;
  });
  if (moAppt) moAppt.observe(appt, { attributes: true, attributeFilter: ['class'] });

  return { destroy() { mo.disconnect(); if (moAppt) moAppt.disconnect(); } };
}

// La ficha recibe el sello: baja grande y ladeado, golpea y la ficha se sacude.
function stamp(box) {
  const ticket = box.querySelector('.kds-ok-ticket');
  const mark = box.querySelector('.kds-ok-stamp');
  const text = Array.from(box.children).filter((c) => c !== ticket);
  const tl = gsap.timeline();
  if (ticket && mark) {
    tl.fromTo(ticket, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.45, ease: 'power3.out' })
      .fromTo(mark, { scale: 2.6, rotation: -26, y: -50, opacity: 0 }, { scale: 1, rotation: -10, y: 0, opacity: 1, duration: 0.32, ease: 'power4.in' }, '+=0.15')
      // Impacto: la tinta se aplasta un poco y la ficha acusa el golpe.
      .to(mark, { scaleY: 0.9, scaleX: 1.06, duration: 0.07, yoyo: true, repeat: 1, ease: 'power1.out' })
      .fromTo(ticket, { x: 0 }, { keyframes: { x: [-7, 6, -3, 2, 0] }, duration: 0.35, ease: 'none' }, '<');
  }
  tl.fromTo(text, { y: 18, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.08, ease: 'power3.out', clearProps: 'transform,opacity' }, ticket ? '-=0.15' : 0);
  return tl;
}

function initSuccess(box) {
  const shown = () => box.style.display !== 'none' && box.offsetParent !== null;
  if (shown()) {
    stamp(box);
    return null;
  }
  // El de la cita aparece después (cuando el inline le quita display:none).
  const mo = new MutationObserver(() => {
    if (shown()) { mo.disconnect(); stamp(box); }
  });
  mo.observe(box, { attributes: true, attributeFilter: ['style'] });
  return { destroy() { mo.disconnect(); } };
}

if (gsap && !prefersReduced()) {
  document.documentElement.classList.add('motion-ok');
  mount('[data-kds-checkin]', initSteps);
  mount('[data-kds-success]', initSuccess);
}
