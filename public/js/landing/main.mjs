// Entrada del motion de la landing "Taller a la vista".
//
// Cada sección grande es un componente propio con su propio mecanismo (la
// cortina se enrolla, la moto avanza a golpes de trinquete, la ficha recibe
// sellos, la aguja del tacómetro barre los niveles, las etiquetas se mecen).
// `mount` aplica el contrato fail-open: si un componente falla, su sección
// vuelve al estado final del servidor y las demás siguen funcionando.
//
// Con prefers-reduced-motion no se monta nada animado: la página del servidor
// ya es el estado final. Solo se dibuja el dial del tacómetro, quieto.

import { mount, prefersReduced, getGsap } from '../motion/core.mjs';
import initHero from './hero-shutter.mjs';

const reduced = prefersReduced();
const gsap = getGsap();

if (!reduced) {
  document.documentElement.classList.add('motion-ok');
  mount('[data-lp="hero"]', initHero);
} else {
  document.documentElement.classList.remove('lp-shutter-pending');
}

// Las imágenes y fuentes cambian alturas: recalcular los disparadores al final.
if (gsap && window.ScrollTrigger) {
  window.addEventListener('load', () => window.ScrollTrigger.refresh(), { once: true });
}
