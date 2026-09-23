// Entrada del motion de la landing "Taller a la vista".
//
// Cada sección grande es un componente propio con su propio mecanismo (la
// cortina se enrolla, la moto avanza a golpes de trinquete, la ficha recibe
// sellos, la aguja del tacómetro barre los niveles, las etiquetas se mecen).
// `mount` aplica el contrato fail-open: si un componente falla, su sección
// vuelve al estado final del servidor y las demás siguen funcionando.
//
// VERSIONES: /static se sirve con caché inmutable de un año (vercel.json).
// Al cambiar cualquier módulo, sube su ?v= en los imports que lo usan (y el
// ?v= de main.mjs en home.ejs), igual que se hace con styles.css.
//
// Con prefers-reduced-motion no se monta nada animado: la página del servidor
// ya es el estado final. Solo se dibuja el dial del tacómetro, quieto.

import { mount, prefersReduced, getGsap } from '../motion/core.mjs?v=1';
import initHero from './hero-shutter.mjs?v=1';
import initServices from './service-bike.mjs?v=1';
import initTicket from './ticket-stamps.mjs?v=1';
import initClub from './club-tach.mjs?v=1';
import initShopTags from './shop-tags.mjs?v=1';

const reduced = prefersReduced();
const gsap = getGsap();

if (!reduced) {
  document.documentElement.classList.add('motion-ok');
  mount('[data-lp="hero"]', initHero);
  mount('[data-lp="services"]', initServices);
  mount('[data-lp="ticket"]', initTicket);
  mount('[data-lp="shop"]', initShopTags);
} else {
  document.documentElement.classList.remove('lp-shutter-pending');
}
// El dial del club se dibuja siempre (con movimiento reducido, quieto).
mount('[data-lp="club"]', initClub);

// Las imágenes y fuentes cambian alturas: recalcular los disparadores al final.
if (gsap && window.ScrollTrigger) {
  window.addEventListener('load', () => window.ScrollTrigger.refresh(), { once: true });
}
