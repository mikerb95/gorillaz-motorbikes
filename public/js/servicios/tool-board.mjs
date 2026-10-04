// Tablero de herramientas de /servicios.
//
// La página afirma "cada trabajo con su herramienta". El tablero lo muestra:
// cada servicio es la herramienta con que se hace, colgada sobre su silueta
// pintada, como en el tablero real del taller.
//
// ENTRADA (primera visita de la sesión): primero se pintan las siluetas y
// luego cada herramienta se cuelga en su gancho con un golpe seco (entra
// ladeada y encaja). No es un fundido: es la herramienta llegando a su sitio.
//
// ESCRITORIO (≥1024 px): el tablero queda fijo (sticky). Cuando una ficha
// llega al centro de la pantalla, su herramienta se descuelga (el gancho
// queda vacío y se ve la silueta), viaja en arco hasta la ficha y aterriza;
// ahí se imprimen las cintas de lo que incluye el servicio. Al pasar a otra
// ficha, la herramienta anterior vuelve a su gancho.
//
// MÓVIL: el tablero no se fija y no hay vuelos. Cada ficha tiene su propio
// retazo de tablero: al aparecer, la herramienta se descuelga de su silueta
// (sube y se ladea, como cuando la tomas) y se imprimen las cintas.
//
// VUELTA DESDE LA FICHA AMPLIADA: la transición de vista (vt.js) ya devolvió
// la herramienta a su ficha, así que esa ficha llega abierta, con sus cintas
// impresas, sin repetir el vuelo desde el tablero.
//
// Sin JS o con movimiento reducido: tablero completo y fichas con su
// herramienta y sus cintas, quietas (marcado del servidor).

import { getGsap, MQ } from '../motion/core.mjs?v=1';
import { flightFrame } from '../motion/lib/flight.mjs?v=1';
import { hashString, mulberry32, between } from '../motion/lib/prng.mjs?v=1';
import { hideTapes, printTapes } from './dymo-print.mjs?v=1';

const NS = 'http://www.w3.org/2000/svg';

/** Entrada del tablero: siluetas pintadas y herramientas que se cuelgan. */
function enterBoard(gsap, board) {
  const html = document.documentElement;
  const pending = html.classList.contains('sv-enter-pending');
  clearTimeout(window.__svEnterTimer);
  if (!pending) return null;
  const slots = Array.from(board.querySelectorAll('.sv-slot[data-slug]'));
  const sils = slots.map((s) => s.querySelector('.sv-sil'));
  const tools = slots.map((s) => s.querySelector('.sv-tool'));
  const names = slots.map((s) => s.querySelector('.sv-slot-name'));
  // Mismo estado que la clase de espera, ahora en manos de GSAP.
  gsap.set(sils, { clipPath: 'inset(0% 100% 0% 0%)' });
  gsap.set([...tools, ...names], { opacity: 0 });
  html.classList.remove('sv-enter-pending');
  try {
    sessionStorage.setItem('sv-tablero', '1');
  } catch {}

  const tl = gsap.timeline({ delay: 0.15 });
  // 1) La pintura de las siluetas, en orden de lectura.
  tl.to(sils, { clipPath: 'inset(0% 0% 0% 0%)', duration: 0.38, ease: 'power2.out', stagger: 0.045 }, 0);
  // 2) Cada herramienta se cuelga: entra ladeada (con semilla) y encaja en el gancho.
  tools.forEach((tool, i) => {
    const rand = mulberry32(hashString(slots[i].dataset.slug));
    tl.fromTo(tool,
      { opacity: 0, y: -34, x: between(rand, -8, 8), rotation: between(rand, -14, 14), transformOrigin: '50% 0%' },
      { opacity: 1, y: 0, x: 0, rotation: 0, duration: 0.55, ease: 'back.out(2.4)', clearProps: 'transform,opacity' },
      0.3 + i * 0.07);
  });
  // 3) Las cintas con el nombre, al final.
  tl.to(names, { opacity: 1, duration: 0.2, stagger: 0.04, clearProps: 'opacity' }, 0.55);
  return tl;
}

function setupDesktop(page, gsap, returning) {
  const ST = window.ScrollTrigger;
  const board = page.querySelector('.sv-board');
  const cards = Array.from(page.querySelectorAll('.sv-card'));
  if (!ST || !board || !cards.length) return () => {};
  const slotOf = (slug) => board.querySelector(`.sv-slot[data-slug="${slug}"]`);
  const cardOf = (slug) => page.querySelector(`.sv-card[data-slug="${slug}"]`);

  page.classList.add('is-armed');
  cards.forEach((c) => (c.dataset.slug === returning ? (c.dataset.printed = 'yes') : hideTapes(gsap, c)));

  // Una sola herramienta "en vuelo", reutilizada: vive fuera de las fichas
  // (que recortan su contenido) para poder cruzar la pantalla.
  const flyer = document.createElementNS(NS, 'svg');
  flyer.setAttribute('class', 'sv-flyer');
  flyer.setAttribute('viewBox', '0 0 200 120');
  flyer.setAttribute('aria-hidden', 'true');
  flyer.setAttribute('focusable', 'false');
  const flyerUse = document.createElementNS(NS, 'use');
  flyer.appendChild(flyerUse);
  flyer.style.visibility = 'hidden';
  document.body.appendChild(flyer);

  let active = null;
  let flight = null;
  const endFlight = () => {
    flight?.kill();
    flight = null;
    flyer.style.visibility = 'hidden';
  };

  function activate(slug) {
    if (slug === active) return;
    const prev = active;
    active = slug;
    endFlight();
    if (prev) {
      // La herramienta anterior vuelve a su gancho (la transición CSS la encaja).
      slotOf(prev)?.classList.remove('is-out');
      cardOf(prev)?.classList.remove('has-tool');
    }
    if (!slug) return;
    const slot = slotOf(slug);
    const card = cardOf(slug);
    if (!slot || !card) return;
    if (slug === returning) {
      // Ya viene en la ficha (la trajo la transición de vista): sin vuelo.
      returning = null;
      slot.classList.add('is-out');
      card.classList.add('has-tool');
      return;
    }
    const fromRect = slot.querySelector('.sv-tool').getBoundingClientRect();
    const target = card.querySelector('.sv-card-tool .sv-tool');
    slot.classList.add('is-out');

    flyerUse.setAttribute('href', `#sv-t-${slug}`);
    const proxy = { t: 0 };
    const place = () => {
      const to = target.getBoundingClientRect(); // la ficha se mueve si hay scroll: se relee cada cuadro
      const f = flightFrame(proxy.t, fromRect, to, { lift: 110, tilt: -16 });
      flyer.style.width = `${to.width}px`;
      flyer.style.height = `${to.height}px`;
      flyer.style.transform = `translate(${f.x - to.width / 2}px, ${f.y - to.height / 2}px) rotate(${f.rotation}deg) scale(${f.scale})`;
    };
    place();
    flyer.style.visibility = 'visible';
    flight = gsap.to(proxy, {
      t: 1,
      duration: 0.8,
      ease: 'power2.inOut',
      onUpdate: place,
      onComplete: () => {
        flyer.style.visibility = 'hidden';
        flight = null;
        card.classList.add('has-tool');
        // Aterrizaje: un pequeño asentamiento en su sitio.
        gsap.fromTo(target, { scale: 1.06, rotation: -2 }, { scale: 1, rotation: 0, duration: 0.45, ease: 'back.out(3)', transformOrigin: '50% 50%', clearProps: 'transform' });
        printTapes(gsap, card);
      },
    });
  }

  // Cada ficha se "abre" cuando cruza el centro de la pantalla.
  const triggers = cards.map((card) => ST.create({
    trigger: card,
    start: 'top 55%',
    end: 'bottom 45%',
    onToggle: (self) => {
      if (self.isActive) activate(card.dataset.slug);
      else if (active === card.dataset.slug) activate(null);
    },
  }));

  return () => {
    triggers.forEach((t) => t.kill());
    endFlight();
    flyer.remove();
    page.classList.remove('is-armed');
    board.querySelectorAll('.sv-slot.is-out').forEach((s) => s.classList.remove('is-out'));
    cards.forEach((c) => {
      c.classList.remove('has-tool');
      gsap.set(c.querySelectorAll('.sv-dymo'), { clearProps: 'clipPath,transform' });
      delete c.dataset.printed;
    });
  };
}

function setupMobile(page, gsap, returning) {
  const ST = window.ScrollTrigger;
  const cards = Array.from(page.querySelectorAll('.sv-card'));
  if (!ST || !cards.length) return () => {};
  cards.forEach((c) => (c.dataset.slug === returning ? (c.dataset.printed = 'yes') : hideTapes(gsap, c)));
  const triggers = cards.map((card) => ST.create({
    trigger: card,
    start: 'top 78%',
    once: true,
    onEnter: () => {
      const tool = card.querySelector('.sv-card-tool .sv-tool');
      // Tomar la herramienta: se descuelga de su silueta y queda en la mano.
      gsap.to(tool, { y: -14, x: 8, rotation: -7, duration: 0.6, ease: 'back.out(2)', delay: 0.1 });
      printTapes(gsap, card)?.delay(0.35);
    },
  }));
  return () => {
    triggers.forEach((t) => t.kill());
    cards.forEach((c) => {
      gsap.set(c.querySelectorAll('.sv-dymo, .sv-card-tool .sv-tool'), { clearProps: 'clipPath,transform' });
      delete c.dataset.printed;
    });
  };
}

export default function initToolBoard(page) {
  const gsap = getGsap();
  if (!gsap) {
    document.documentElement.classList.remove('sv-enter-pending');
    return { destroy() {} };
  }
  const board = page.querySelector('.sv-board');
  const enter = board ? enterBoard(gsap, board) : null;
  // La ficha ampliada deja aquí su slug al volver a /servicios (vt.js). Solo
  // cuenta para el primer montaje: si cambia el ancho, todo arranca normal.
  let returning = null;
  try {
    returning = sessionStorage.getItem('sv-return');
    sessionStorage.removeItem('sv-return');
  } catch {}
  const mm = gsap.matchMedia();
  mm.add({ desktop: MQ.desktop, mobile: MQ.mobile }, (ctx) => {
    const back = returning;
    returning = null;
    return ctx.conditions.desktop ? setupDesktop(page, gsap, back) : setupMobile(page, gsap, back);
  });
  return {
    destroy() {
      enter?.kill();
      mm.revert();
      document.documentElement.classList.remove('sv-enter-pending');
    },
  };
}
