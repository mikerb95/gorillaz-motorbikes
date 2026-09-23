// Club: la aguja del tacómetro recorre los niveles reales del club.
//
// El texto dice "sube de nivel con cada rodada". Para un motero, subir de
// nivel es subir de revoluciones: el dial es un tacómetro donde los puntos son
// las rpm y el último nivel (Gorilla Legend) es la zona roja. Los niveles y
// sus umbrales salen de la configuración real (data-levels, que el servidor
// llena desde helpers/score.js), así que si el admin los cambia, el dial se
// redibuja solo.
//
// Mecanismo propio: la aguja tiene inercia (persigue su objetivo con amortiguación, no la
// teletransporta) y en la zona roja vibra, como una moto acelerada. Al cruzar
// cada umbral se enciende su nivel en la lista y el visor central cambia,
// como el indicador de marcha de un tablero.
//
// El recordatorio de SOAT (ejemplo ilustrativo) usa tambores de odómetro que
// ruedan hasta el número.
//
// Con movimiento reducido el dial se dibuja igual, quieto y con la aguja en el
// último nivel (estado final). Sin JS queda la lista de niveles.

import { getGsap, prefersReduced, createLoop } from '../motion/core.mjs?v=1';
import { levelBands, dialMaxFor, pointsToAngle, levelAt, arcPath, polar } from '../motion/lib/tach.mjs?v=1';

const NS = 'http://www.w3.org/2000/svg';
const START = -132;
const END = 132;
const CX = 200;
const CY = 206;
const BAND_COLORS = ['#3b3e45', '#565b63', '#858b94', '#c9ced4', '#F25C05'];

const el = (tag, attrs = {}, parent) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
  if (parent) parent.appendChild(n);
  return n;
};
const fmt = (n) => Math.round(n).toLocaleString('es-CO');

/** Dibuja el dial completo; devuelve las piezas que se animan. */
export function drawDial(host, levels) {
  const max = dialMaxFor(levels);
  const bands = levelBands(levels, max);
  const svg = el('svg', { viewBox: '0 0 400 400', 'aria-hidden': 'true', focusable: 'false' });
  const defs = el('defs', {}, svg);
  const bezel = el('linearGradient', { id: 'lp-g-bezel', x1: '0', y1: '0', x2: '0', y2: '1' }, defs);
  el('stop', { offset: '0', 'stop-color': '#f4f5f6' }, bezel);
  el('stop', { offset: '.5', 'stop-color': '#8d939b' }, bezel);
  el('stop', { offset: '1', 'stop-color': '#3a3e44' }, bezel);
  const face = el('radialGradient', { id: 'lp-g-face', cx: '.5', cy: '.42', r: '.6' }, defs);
  el('stop', { offset: '0', 'stop-color': '#24262b' }, face);
  el('stop', { offset: '1', 'stop-color': '#0b0c0e' }, face);

  el('circle', { cx: CX, cy: CY, r: 188, fill: 'url(#lp-g-bezel)' }, svg);
  el('circle', { cx: CX, cy: CY, r: 178, fill: 'url(#lp-g-face)' }, svg);

  // Tramos de cada nivel: un arco por nivel, el último es la zona roja.
  bands.forEach((b, i) => {
    el('path', {
      d: arcPath(CX, CY, 150, pointsToAngle(b.min, max, START, END) + 0.6, pointsToAngle(b.max, max, START, END) - 0.6),
      fill: 'none', stroke: BAND_COLORS[Math.min(i, BAND_COLORS.length - 1)], 'stroke-width': i === bands.length - 1 ? 16 : 10,
      class: 'lp-tach-band', 'data-level': b.name,
    }, svg);
  });

  // Marcas cada 100 puntos; números cada 500 (en "×100", como las rpm).
  for (let p = 0; p <= max; p += 100) {
    const a = pointsToAngle(p, max, START, END);
    const major = p % 500 === 0;
    const o = polar(CX, CY, 138, a);
    const inn = polar(CX, CY, major ? 118 : 128, a);
    el('line', { x1: inn.x, y1: inn.y, x2: o.x, y2: o.y, stroke: p >= bands.at(-1).min ? '#F25C05' : '#e9e6e1', 'stroke-width': major ? 4 : 2, 'stroke-linecap': 'round' }, svg);
    if (major) {
      const t = polar(CX, CY, 98, a);
      const label = el('text', { x: t.x, y: t.y + 7, 'text-anchor': 'middle', fill: '#f4f1ec', 'font-size': 22, 'font-weight': 800, 'font-family': 'Montserrat, Arial, sans-serif' }, svg);
      label.textContent = String(p / 100);
    }
  }
  const unit = el('text', { x: CX, y: CY - 46, 'text-anchor': 'middle', fill: '#8d939b', 'font-size': 11, 'font-weight': 800, 'letter-spacing': 2, 'font-family': 'Montserrat, Arial, sans-serif' }, svg);
  unit.textContent = '×100 PUNTOS';

  // Visor central: nivel actual y puntos, como el indicador de marcha.
  el('rect', { x: CX - 96, y: CY + 88, width: 192, height: 58, rx: 10, fill: '#050506', stroke: '#2c2f35', 'stroke-width': 2 }, svg);
  const levelText = el('text', { x: CX, y: CY + 113, 'text-anchor': 'middle', fill: '#F25C05', 'font-size': 16, 'font-weight': 900, 'letter-spacing': 1, 'font-family': 'Montserrat, Arial, sans-serif' }, svg);
  const pointsText = el('text', { x: CX, y: CY + 134, 'text-anchor': 'middle', fill: '#c9ced4', 'font-size': 13, 'font-weight': 700, 'font-family': 'Montserrat, Arial, sans-serif' }, svg);

  // Aguja: apunta hacia arriba (0°) y gira alrededor del centro.
  const needle = el('g', { class: 'lp-tach-needle' }, svg);
  el('path', { d: `M${CX - 5} ${CY + 22} L${CX - 2} ${CY - 150} L${CX + 2} ${CY - 150} L${CX + 5} ${CY + 22} Z`, fill: '#F25C05' }, needle);
  el('circle', { cx: CX, cy: CY, r: 20, fill: '#1b1d21', stroke: '#8d939b', 'stroke-width': 3 }, svg);
  el('circle', { cx: CX, cy: CY, r: 6, fill: '#F25C05' }, svg);

  host.replaceChildren(svg);
  return { svg, needle, levelText, pointsText, max, bands };
}

/** Tambores de odómetro: cada dígito es una tira 0–9 que rueda hasta su valor. */
function buildOdometer(odo) {
  const value = odo.dataset.value || odo.textContent.trim();
  const digits = Array.from(odo.querySelectorAll('.lp-odo-digit'));
  const sr = document.createElement('span');
  sr.className = 'sr-only';
  sr.textContent = value;
  odo.before(sr);
  odo.setAttribute('aria-hidden', 'true');
  return digits.map((d) => {
    const target = Number(d.textContent);
    const strip = document.createElement('span');
    strip.className = 'lp-odo-strip';
    // Dos vueltas de números para que la unidad dé una vuelta completa antes de parar.
    for (let k = 0; k < 20; k++) {
      const s = document.createElement('span');
      s.textContent = String(k % 10);
      strip.appendChild(s);
    }
    d.replaceChildren(strip);
    return { strip, target };
  });
}

export default function initClub(root) {
  const gsap = getGsap();
  const host = root.querySelector('.lp-tach');
  let levels = [];
  try {
    levels = JSON.parse(root.dataset.levels || '[]');
  } catch {}
  if (!host || !levels.length) return { destroy() {} };

  const dial = drawDial(host, levels);
  const items = Array.from(root.querySelectorAll('.lp-level-list li'));
  const show = (points) => {
    const lvl = levelAt(points, levels);
    dial.levelText.textContent = (lvl?.name || '').toUpperCase();
    dial.pointsText.textContent = `${fmt(points)} pts`;
    items.forEach((li) => li.classList.toggle('is-lit', points >= Number(li.dataset.min)));
  };
  const finalPoints = dial.bands.at(-1).min + (dial.max - dial.bands.at(-1).min) * 0.4;
  const setAngle = (deg) => dial.needle.setAttribute('transform', `rotate(${deg.toFixed(2)} ${CX} ${CY})`);

  // Movimiento reducido o sin GSAP: el dial quieto en su estado final.
  if (prefersReduced() || !gsap || !window.ScrollTrigger) {
    setAngle(pointsToAngle(finalPoints, dial.max, START, END));
    show(finalPoints);
    return { destroy() {} };
  }

  root.classList.add('is-armed');
  // La aguja persigue su objetivo con amortiguación exponencial (inercia):
  // no salta al valor del scroll, lo alcanza.
  const state = { points: 0, target: 0, jitter: 0 };
  const loop = createLoop(host, (now, dt) => {
    const k = 1 - Math.exp(-dt / 180);
    state.points += (state.target - state.points) * k;
    if (Math.abs(state.target - state.points) < 0.5) state.points = state.target;
    // En la zona roja la aguja vibra, como una moto acelerada.
    const red = state.points >= dial.bands.at(-1).min;
    state.jitter = red ? Math.sin(now / 23) * 0.9 + Math.sin(now / 11) * 0.5 : 0;
    setAngle(pointsToAngle(state.points, dial.max, START, END) + state.jitter);
    show(state.points);
    return red || state.points !== state.target;
  });
  const chase = (v) => {
    state.target = v;
    loop.wake();
  };
  setAngle(pointsToAngle(0, dial.max, START, END));
  show(0);

  const st = window.ScrollTrigger.create({
    trigger: root,
    start: 'top 75%',
    end: 'center 35%',
    onUpdate: (self) => chase(finalPoints * self.progress),
  });

  // Odómetro del recordatorio: rueda una vez cuando la tarjeta aparece.
  const odo = root.querySelector('.lp-odo');
  let odoTl = null;
  let odoST = null;
  if (odo) {
    const drums = buildOdometer(odo);
    drums.forEach(({ strip }) => gsap.set(strip, { yPercent: 0 }));
    // La línea de tiempo se crea al aparecer, no antes (pausada no deja dormir al ticker).
    odoST = window.ScrollTrigger.create({
      trigger: odo, start: 'top 85%', once: true,
      onEnter: () => {
        odoTl = gsap.timeline();
        drums.forEach(({ strip, target }, i) => {
          const last = i === drums.length - 1;
          const stop = last ? 10 + target : target; // la unidad da una vuelta extra
          odoTl.to(strip, { yPercent: -(stop * 100) / 20, duration: last ? 1.6 : 1.1, ease: 'power3.inOut' }, i * 0.15);
        });
      },
    });
  }

  return {
    destroy() {
      st.kill();
      odoST?.kill();
      odoTl?.kill();
      loop.destroy();
      root.classList.remove('is-armed');
      setAngle(pointsToAngle(finalPoints, dial.max, START, END));
      show(finalPoints);
    },
  };
}
