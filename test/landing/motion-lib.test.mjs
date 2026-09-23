// Tests de la lógica pura del motion de la landing (sin DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { hashString, mulberry32, between } from '../../public/js/motion/lib/prng.mjs';
import { openingCurve, OPENING_SEGMENTS, shutterLayout, shutterEdge, textClipTop } from '../../public/js/motion/lib/shutter.mjs';
import { createResolutionGovernor } from '../../public/js/motion/lib/adaptive.mjs';
import { detentIndex, detentProgress, ratchetAngle } from '../../public/js/motion/lib/ratchet.mjs';
import { ticketState, formatMotoPlate, typedPlate } from '../../public/js/motion/lib/ticket.mjs';
import { levelBands, dialMaxFor, pointsToAngle, levelAt, arcPath, polar } from '../../public/js/motion/lib/tach.mjs';
import { stepPendulum, atRest } from '../../public/js/motion/lib/pendulum.mjs';

test('prng: misma semilla, misma secuencia; semillas distintas divergen', () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const sa = [a(), a(), a()], sb = [b(), b(), b()], sc = [c(), c(), c()];
  assert.deepEqual(sa, sb);
  assert.notDeepEqual(sa, sc);
  sa.forEach((x) => assert.ok(x >= 0 && x < 1));
  assert.equal(hashString('mecanica'), hashString('mecanica'));
  assert.notEqual(hashString('mecanica'), hashString('pintura'));
  const r = mulberry32(1);
  for (let i = 0; i < 200; i++) {
    const v = between(r, -3, 5);
    assert.ok(v >= -3 && v < 5);
  }
});

test('cortina: la apertura empieza cerrada, termina arriba y es continua', () => {
  assert.equal(openingCurve(0), 0);
  assert.equal(openingCurve(1), 1);
  assert.equal(openingCurve(-1), 0);
  assert.equal(openingCurve(2), 1);
  // Continuidad entre tramos: cada tramo empieza donde terminó el anterior.
  for (let i = 1; i < OPENING_SEGMENTS.length; i++) {
    assert.equal(OPENING_SEGMENTS[i][0], OPENING_SEGMENTS[i - 1][1]);
    assert.equal(OPENING_SEGMENTS[i][2], OPENING_SEGMENTS[i - 1][3]);
  }
  // Sin saltos: entre muestras cercanas el cambio es pequeño.
  let prev = openingCurve(0);
  for (let t = 0.001; t <= 1; t += 0.001) {
    const v = openingCurve(t);
    assert.ok(Math.abs(v - prev) < 0.02, `salto en t=${t}`);
    assert.ok(v >= 0 && v <= 1.02, `fuera de rango en t=${t}: ${v}`);
    prev = v;
  }
  // El cambio de agarre existe: la cortina cede un poco entre los empujones.
  assert.ok(openingCurve(0.43) > openingCurve(0.53));
  // Y el rebote del tope pasa un poco de 1.
  assert.ok(openingCurve(0.9) > 1);
});

test('cortina: medidas y borde inferior', () => {
  const L = shutterLayout({ height: 900, headerOffset: 92 });
  assert.ok(L.housing > 92, 'la caja queda bajo la navbar');
  assert.ok(L.slat >= 22 && L.slat <= 40);
  assert.equal(shutterEdge(0, { height: 900, ...L }), 900);
  assert.equal(shutterEdge(1, { height: 900, ...L }), L.housing + L.lip);
  assert.equal(shutterEdge(1, { height: 900, ...L }, 1), L.housing);
  const mobile = shutterLayout({ height: 800, headerOffset: 70 });
  assert.ok(mobile.slat >= 22);
  assert.equal(textClipTop(500, 600, 200), 0);
  assert.equal(textClipTop(700, 600, 200), 100);
  assert.equal(textClipTop(900, 600, 200), 200);
});

test('resolución adaptativa: baja rápido si va lento, sube despacio si sobra', () => {
  const g = createResolutionGovernor({ min: 0.5, max: 2, start: 2, windowSize: 10, cooldown: 5 });
  let changed = null;
  for (let i = 0; i < 10; i++) changed = g.sample(33) ?? changed; // ~30 fps
  assert.equal(changed, 1.85);
  // Durante el enfriamiento no vuelve a cambiar.
  for (let i = 0; i < 5; i++) assert.equal(g.sample(33), null);
  // Nunca baja del mínimo.
  for (let i = 0; i < 400; i++) g.sample(50);
  assert.equal(g.scale, 0.5);
  // Cuadros absurdos (pestaña en segundo plano) se ignoran.
  assert.equal(g.sample(5000), null);
  // Con margen de sobra sube, pero de a medio paso.
  let up = null;
  for (let i = 0; i < 40 && up === null; i++) up = g.sample(8);
  assert.ok(up > 0.55 && up < 0.6, 'sube medio paso: ' + up);
});

test('trinquete: paradas exactas y clic al final de cada tramo', () => {
  assert.equal(detentIndex(0, 11), 0);
  assert.equal(detentIndex(1, 11), 10);
  assert.equal(detentIndex(0.5, 11), 5);
  assert.equal(detentIndex(-3, 11), 0);
  assert.equal(detentIndex(0.3, 1), 0);
  for (let i = 0; i < 11; i++) assert.equal(detentIndex(detentProgress(i, 11), 11), i);
  // Quieto durante el 70 % del tramo, un diente completo al llegar a la parada.
  const step = 1 / 10;
  assert.equal(ratchetAngle(step * 0.5, 11, 24), 0);
  assert.equal(ratchetAngle(step, 11, 24), 15);
  assert.ok(ratchetAngle(step * 0.85, 11, 24) > 0 && ratchetAngle(step * 0.85, 11, 24) < 15);
});

test('ficha: placa primero, luego un sello por etapa', () => {
  assert.deepEqual(ticketState(0, 4), { typed: 0, stamped: 0, phase: 0 });
  const mid = ticketState(0.09, 4);
  assert.ok(mid.typed > 0.4 && mid.typed < 0.6 && mid.stamped === 0);
  assert.equal(ticketState(1, 4).stamped, 4);
  const s = ticketState(0.18 + 0.82 * (1.5 / 4), 4);
  assert.equal(s.stamped, 1);
  assert.ok(Math.abs(s.phase - 0.5) < 1e-9);
  assert.equal(formatMotoPlate('abc12d'), 'ABC 12D');
  assert.equal(formatMotoPlate('ABC 12D'), 'ABC 12D');
  assert.equal(formatMotoPlate('ABC123'), null, 'formato de carro, no de moto');
  assert.equal(typedPlate('ABC 12D', 0), '');
  assert.equal(typedPlate('ABC 12D', 1), 'ABC 12D');
  assert.equal(typedPlate('ABC 12D', 0.5), 'ABC ');
});

test('tacómetro: dial a partir de los niveles reales', () => {
  const levels = [
    { name: 'Gorilla Legend', min: 1500 }, { name: 'Gorilla', min: 700 }, { name: 'Rider', min: 300 },
    { name: 'Miembro', min: 100 }, { name: 'Prospecto', min: 0 },
  ];
  const max = dialMaxFor(levels);
  assert.equal(max, 2000);
  const bands = levelBands(levels, max);
  assert.deepEqual(bands.map((b) => b.name), ['Prospecto', 'Miembro', 'Rider', 'Gorilla', 'Gorilla Legend']);
  assert.equal(bands.at(-1).max, 2000);
  assert.equal(bands[1].max, 300);
  assert.equal(pointsToAngle(0, max), -132);
  assert.equal(pointsToAngle(2000, max), 132);
  assert.equal(pointsToAngle(9999, max), 132);
  assert.equal(levelAt(350, levels).name, 'Rider');
  assert.equal(levelAt(0, levels).name, 'Prospecto');
  const p = polar(100, 100, 50, 90);
  assert.ok(Math.abs(p.x - 150) < 1e-9 && Math.abs(p.y - 100) < 1e-9);
  assert.match(arcPath(100, 100, 50, -90, 90), /^M50 100A50 50 0 0 1 150 100$/);
});

test('péndulo: un empujón lo mueve, el amortiguamiento lo detiene', () => {
  let s = { angle: 0, velocity: 0 };
  s = stepPendulum(s, { dt: 1 / 60, push: 40 });
  assert.ok(s.angle > 0);
  let peak = 0;
  for (let i = 0; i < 60 * 8; i++) {
    s = stepPendulum(s, { dt: 1 / 60 });
    peak = Math.max(peak, Math.abs(s.angle));
  }
  assert.ok(peak <= 0.5, 'respeta el ángulo máximo');
  assert.ok(atRest(s), 'se queda quieto');
  // Un dt enorme (pestaña que vuelve) no lo hace explotar.
  const wild = stepPendulum({ angle: 0.4, velocity: 3 }, { dt: 5 });
  assert.ok(Math.abs(wild.angle) <= 0.5);
});
