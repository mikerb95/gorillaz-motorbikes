// Entrada del motion de /servicios ("cada trabajo con su herramienta").
//
// Usa el mismo núcleo que la home (public/js/motion/core.mjs): contrato
// fail-open y bucles que se pausan solos. Un componente por pieza grande:
// el tablero de herramientas (entrada, vuelo a la ficha) y la rotuladora de
// cintas, que el tablero llama al abrir cada ficha.
//
// VERSIONES: /static se sirve con caché inmutable de un año (vercel.json).
// Al cambiar un módulo, sube su ?v= en los imports que lo usan (y el de este
// archivo en views/services.ejs).
//
// Con prefers-reduced-motion no se monta nada: el marcado ya es el estado final.

import { mount, prefersReduced, getGsap } from '../motion/core.mjs?v=1';
import initToolBoard from './tool-board.mjs?v=1';

const html = document.documentElement;

if (!prefersReduced()) {
  html.classList.add('motion-ok');
  const apis = mount('[data-sv="page"]', initToolBoard);
  // Si el tablero falló al montar, que no quede vacío esperando al temporizador.
  if (!apis.length) html.classList.remove('sv-enter-pending');
} else {
  html.classList.remove('sv-enter-pending');
}

const gsap = getGsap();
if (gsap && window.ScrollTrigger) {
  window.addEventListener('load', () => window.ScrollTrigger.refresh(), { once: true });
}
