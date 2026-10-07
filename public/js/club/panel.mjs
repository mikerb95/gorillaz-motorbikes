// Panel del miembro: pestañas, credencial que se voltea y el chaleco propio.
//
// Pestañas: el servidor pinta las cuatro secciones seguidas (sin JS se leen
// todas). Aquí se convierten en pestañas por hash (#inicio, #garaje, #club,
// #cuenta), así los redirects del servidor (/club/panel#garaje) y el botón
// atrás del navegador caen en la pestaña correcta. Esto corre siempre, también
// con movimiento reducido: es navegación, no decoración.
//
// Motion (solo sin movimiento reducido): al entrar, los puntos cuentan hasta
// el total y la barra se llena hasta donde está el miembro. La primera vez que
// se abre "Club", el chaleco cose en orden las insignias que el miembro ya
// ganó (las demás quedan con la tiza).

import { mount, prefersReduced, getGsap } from '../motion/core.mjs?v=1';
import { stitch, unstitch } from './vest.mjs?v=1';

const TABS = ['inicio', 'garaje', 'club', 'cuenta'];

function init(root) {
  const reduced = prefersReduced();
  const gsap = reduced ? null : getGsap();
  const panels = Object.fromEntries(TABS.map((t) => [t, root.querySelector(`[data-panel="${t}"]`)]));
  const links = Array.from(root.querySelectorAll('[data-tab]'));
  const vest = root.querySelector('.clp-vest .cl-vest');
  const earned = vest ? Array.from(vest.querySelectorAll('.cl-patch.is-earned')) : [];
  let vestDone = !gsap || !earned.length;

  root.classList.add('is-tabbed');
  if (gsap && earned.length) {
    root.classList.add('is-armed');
    earned.forEach((p) => unstitch(gsap, p));
  }

  function show(tab, { focus = false } = {}) {
    if (!panels[tab]) tab = 'inicio';
    TABS.forEach((t) => { if (panels[t]) panels[t].hidden = t !== tab; });
    links.forEach((a) => {
      if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    if (focus) {
      const h = panels[tab].querySelector('h2');
      if (h) { h.setAttribute('tabindex', '-1'); h.focus({ preventScroll: true }); }
    }
    if (tab === 'club' && !vestDone) {
      vestDone = true;
      const tl = gsap.timeline({ delay: 0.25 });
      earned.forEach((p, i) => tl.add(stitch(gsap, p), i * 0.22));
    }
  }

  const fromHash = () => (location.hash || '').slice(1);
  const onHash = () => {
    const tab = fromHash();
    if (TABS.includes(tab)) show(tab, { focus: true });
  };
  // Enlaces internos (alertas, "ver historial") que llevan a otra pestaña.
  root.addEventListener('click', (e) => {
    const a = e.target.closest('a[href^="#"]');
    if (!a) return;
    const tab = a.getAttribute('href').slice(1);
    if (!TABS.includes(tab)) return;
    e.preventDefault();
    if (fromHash() !== tab) history.pushState(null, '', '#' + tab);
    show(tab, { focus: true });
    const tabs = root.querySelector('.clp-tabs');
    if (tabs && tabs.getBoundingClientRect().top < 0) tabs.scrollIntoView({ block: 'start' });
  });
  window.addEventListener('popstate', onHash);
  window.addEventListener('hashchange', onHash);
  show(TABS.includes(fromHash()) ? fromHash() : 'inicio');

  // Las pestañas se pegan justo debajo de la navbar del sitio, que cambia de
  // alto (barra de sesión, modo compacto al bajar). Se mide su borde real.
  const nav = document.querySelector('.nav-bar') || document.querySelector('header');
  let navRaf = 0;
  const stick = () => {
    navRaf = 0;
    const r = nav ? nav.getBoundingClientRect() : null;
    // Si la navbar se fue con el scroll (no es fija), su borde queda arriba de 0.
    const bottom = r && r.bottom > 0 && r.bottom < 260 ? Math.round(r.bottom + 4) : 0;
    root.style.setProperty('--clp-stick', bottom + 'px');
  };
  const onScroll = () => { if (!navRaf) navRaf = requestAnimationFrame(stick); };
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);
  stick();

  // Credencial: tocar para ver el QR (y otra vez para volver).
  const cred = root.querySelector('[data-cred]');
  if (cred) {
    cred.addEventListener('click', () => {
      const on = cred.classList.toggle('is-flipped');
      cred.setAttribute('aria-pressed', on ? 'true' : 'false');
      cred.setAttribute('aria-label', on ? 'Credencial del club con el código QR. Toca para volver' : 'Credencial del club. Toca para ver el código QR');
    });
  }

  // Entrada: los puntos cuentan y la barra se llena una sola vez.
  if (gsap) {
    const odo = root.querySelector('[data-odo]');
    const bar = root.querySelector('.clp-bar-fill');
    const total = odo ? Number(odo.dataset.odo) || 0 : 0;
    if (odo && total > 0) {
      const n = { v: 0 };
      odo.setAttribute('aria-label', odo.textContent);
      gsap.to(n, {
        v: total, duration: 1.1, ease: 'expo.out', delay: 0.15,
        onUpdate: () => { odo.textContent = Math.round(n.v).toLocaleString('es-CO'); },
      });
    }
    if (bar) gsap.from(bar, { width: '0%', duration: 1.1, ease: 'expo.out', delay: 0.25, clearProps: 'width' });
    if (cred) gsap.from(cred, { y: 16, rotation: -3, opacity: 0, duration: 0.7, ease: 'power3.out', clearProps: 'transform,opacity' });
  }

  return {
    destroy() {
      window.removeEventListener('popstate', onHash);
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
    },
  };
}

if (!prefersReduced()) document.documentElement.classList.add('motion-ok');
// Las pestañas se montan siempre; el motion lo decide init según la preferencia.
mount('[data-club="panel"]', init);
