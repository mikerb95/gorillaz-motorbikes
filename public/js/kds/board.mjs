// Tablero de órdenes del KDS: se actualiza solo y muestra qué cambió.
//
// El tablero afirma "esto es lo que pasa en el taller ahora". Antes se
// repintaba de golpe y había que buscar qué orden se había movido; ahora la
// tarjeta viaja de su columna vieja a la nueva (GSAP Flip) y llega con un
// destello del color de su estado. El tiempo de cada orden corre solo (antes
// se quedaba congelado hasta que alguna orden cambiaba).
//
// Lo funcional (polling, repintado, tiempo) no depende de GSAP: si GSAP no
// carga o hay movimiento reducido, el tablero se actualiza sin animación.
//
// VERSIONES: /static va con caché inmutable; al cambiar un import, sube su ?v=.

import { prefersReduced, getGsap } from '../motion/core.mjs?v=1';
import { boardSignature, changedStatus } from '../motion/lib/kds.mjs?v=1';

const POLL_MS = 8000;
const TICK_MS = 30000;
// Pausa tras un toque: si el refresco cae justo cuando el mecánico va a tocar
// una tarjeta, repintar se la movería bajo el dedo.
const TOUCH_GRACE_MS = 2500;

const board = document.querySelector('[data-kds-board]');
const dataEl = document.getElementById('kdsBoardData');
const markup = window.KdsBoardMarkup;

if (board && dataEl && markup) {
  const { statuses, orders: initial } = JSON.parse(dataEl.textContent);
  const gsap = getGsap();
  const Flip = window.Flip;
  if (gsap && Flip) gsap.registerPlugin(Flip);
  const animate = () => !!(gsap && Flip) && !prefersReduced();

  let current = initial;
  let lastSig = boardSignature(initial);
  let lastTouch = 0;
  board.addEventListener('pointerdown', () => { lastTouch = Date.now(); });

  // El tiempo corre en su sitio, sin repintar el tablero.
  function tickElapsed() {
    const now = Date.now();
    board.querySelectorAll('.kds-card[data-created]').forEach((card) => {
      const span = card.querySelector('[data-elapsed]');
      if (span) span.textContent = markup.sinceLabel(card.dataset.created, now);
    });
  }

  async function swap(fresh) {
    const moved = new Set(changedStatus(current, fresh));
    const before = new Set(current.map((o) => o.id));
    const after = new Set(fresh.map((o) => o.id));
    const countsBefore = statuses.map((s) => current.filter((o) => o.status === s.v).length);
    const html = markup.boardMarkup(fresh, statuses, Date.now());

    if (!animate()) {
      board.innerHTML = html;
      return;
    }

    // Las órdenes que salen del tablero (facturadas o entregadas) se van
    // primero, para que no desaparezcan de golpe.
    const leaving = Array.from(board.querySelectorAll('.kds-card')).filter((c) => !after.has(c.dataset.flipId));
    if (leaving.length) {
      await gsap.to(leaving, { opacity: 0, scale: 0.9, duration: 0.3, ease: 'power2.in' }).then();
    }

    const state = Flip.getState(board.querySelectorAll('.kds-card'));
    board.innerHTML = html;
    const cards = board.querySelectorAll('.kds-card');
    Flip.from(state, {
      targets: cards,
      duration: 0.75,
      ease: 'power3.inOut',
      // Se mueve por encima del resto mientras viaja entre columnas.
      zIndex: 5,
      onEnter: (els) => gsap.fromTo(els, { opacity: 0, y: -14, scale: 0.94 }, { opacity: 1, y: 0, scale: 1, duration: 0.5, ease: 'back.out(2)', clearProps: 'transform,opacity' }),
      onComplete: () => {
        // Llegada: destello del color del estado nuevo en las que cambiaron.
        cards.forEach((c) => {
          if (moved.has(c.dataset.flipId) || !before.has(c.dataset.flipId)) {
            c.classList.remove('is-arrived');
            void c.offsetWidth; // reinicia la animación CSS
            c.classList.add('is-arrived');
          }
        });
      },
    });

    // El número de cada columna da un golpe corto si cambió.
    board.querySelectorAll('.kds-col').forEach((col, i) => {
      const badge = col.querySelector('[data-col-count]');
      if (badge && Number(badge.textContent) !== countsBefore[i]) {
        gsap.fromTo(badge, { scale: 1.5 }, { scale: 1, duration: 0.5, delay: 0.5, ease: 'back.out(3)', clearProps: 'transform' });
      }
    });
  }

  let busy = false;
  async function poll() {
    if (busy || document.hidden) return;
    busy = true;
    try {
      const res = await fetch('/kds/orders.json', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const fresh = await res.json();
        const sig = boardSignature(fresh);
        // Solo se repinta si algo relevante cambió y no se acaba de tocar.
        if (sig !== lastSig && Date.now() - lastTouch >= TOUCH_GRACE_MS) {
          await swap(fresh);
          current = fresh;
          lastSig = sig;
        }
      }
    } catch { /* red intermitente: se reintenta en el próximo ciclo */ }
    busy = false;
  }

  setInterval(poll, POLL_MS);
  setInterval(tickElapsed, TICK_MS);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) { tickElapsed(); poll(); }
  });

  // Para verificar con capturas sin esperar al polling.
  board.kdsSwap = (fresh) => swap(fresh).then(() => { current = fresh; lastSig = boardSignature(fresh); });
}
