// Tests de la lógica pura del motion del KDS (sin DOM).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import {
  stageCounts, planMoves, tokenLayout, rollPath, clockParts,
  boardSignature, changedStatus,
} from '../../public/js/motion/lib/kds.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const { EMP_STATUS } = require('../../helpers/service-order-status.js');
const { boardMarkup, elapsedLabel, escapeHtml } = require('../../public/js/kds/board-markup.js');
const STAGES = EMP_STATUS.map((s) => s.v);

test('conteo por etapa: ignora estados que no son del taller', () => {
  const orders = [
    { status: 'ingreso_taller' }, { status: 'ingreso_taller' },
    { status: 'trabajo_completo' }, { status: 'facturado' }, null,
  ];
  assert.deepEqual(stageCounts(orders, STAGES), [2, 0, 0, 1]);
});

test('planMoves: una moto avanza de etapa', () => {
  assert.deepEqual(planMoves([2, 1, 0, 0], [1, 2, 0, 0]), { moves: [{ from: 0, to: 1 }], enters: [], exits: [] });
});

test('planMoves: prefiere avanzar, y vuelve atrás solo si no hay destino delante', () => {
  // "en pausa" → "en curso": el único destino está detrás.
  assert.deepEqual(planMoves([0, 0, 1, 0], [0, 1, 0, 0]).moves, [{ from: 2, to: 1 }]);
  // Desde "en curso" con destinos delante y detrás, avanza.
  assert.deepEqual(planMoves([0, 1, 0, 0], [0, 0, 0, 1]).moves, [{ from: 1, to: 3 }]);
});

test('planMoves: entradas y salidas cuadran el total', () => {
  const prev = [1, 2, 0, 3];
  const next = [2, 1, 1, 1];
  const { moves, enters, exits } = planMoves(prev, next);
  const sum = (a) => a.reduce((s, x) => s + x, 0);
  assert.equal(sum(next) - sum(prev), enters.length - exits.length);
  // Aplicar el plan al conteo previo da exactamente el siguiente.
  const out = prev.slice();
  moves.forEach(({ from, to }) => { out[from]--; out[to]++; });
  enters.forEach((i) => out[i]++);
  exits.forEach((i) => out[i]--);
  assert.deepEqual(out, next);
});

test('planMoves: sin cambios, sin movimientos', () => {
  assert.deepEqual(planMoves([1, 1, 1, 1], [1, 1, 1, 1]), { moves: [], enters: [], exits: [] });
});

test('tokenLayout: tope de fichas con "+N"', () => {
  assert.deepEqual(tokenLayout(0), { shown: 0, extra: 0 });
  assert.deepEqual(tokenLayout(8), { shown: 8, extra: 0 });
  assert.deepEqual(tokenLayout(12), { shown: 7, extra: 5 });
  assert.deepEqual(tokenLayout(-3), { shown: 0, extra: 0 });
});

test('rollPath: siempre rueda hacia delante', () => {
  assert.deepEqual(rollPath(3, 7), { from: -15, to: -35, reset: null });
  assert.deepEqual(rollPath(5, 5), { from: -25, to: -25, reset: null });
  // 9 → 0 pasa por la segunda copia y salta a la primera.
  assert.deepEqual(rollPath(9, 0), { from: -45, to: -50, reset: -0 });
  const p = rollPath(8, 2);
  assert.ok(p.to < p.from, 'el recorrido baja la tira (avanza)');
  assert.equal(p.reset, -10);
});

test('clockParts: hora de Bogotá en 12 h, cuatro dígitos', () => {
  // 15:07 UTC = 10:07 a. m. en Bogotá (UTC-5, sin horario de verano).
  const c = clockParts(new Date('2026-10-04T15:07:00Z'));
  assert.equal(c.hh, '10');
  assert.equal(c.mm, '07');
  assert.deepEqual(c.digits, [1, 0, 0, 7]);
  assert.match(c.ampm, /a.*m/i);
  const pm = clockParts(new Date('2026-10-04T02:30:00Z')); // 9:30 p. m. del día anterior
  assert.equal(pm.hh, '09');
  assert.match(pm.ampm, /p.*m/i);
});

test('tablero: el marcado compartido escapa los datos de usuario', () => {
  const evil = { id: 'a"b', label: '<img src=x onerror=alert(1)>', motorcycle: "ABC'12", mechanic: '<b>x</b>', status: 'ingreso_taller', itemCount: 2, createdAt: '2026-10-04T15:00:00Z' };
  const html = boardMarkup([evil], EMP_STATUS, Date.parse('2026-10-04T16:05:00Z'));
  assert.ok(!html.includes('<img'), 'la etiqueta no puede inyectar HTML');
  assert.ok(!html.includes('<b>x'), 'el mecánico no puede inyectar HTML');
  assert.ok(html.includes('data-flip-id="a&quot;b"'));
  assert.ok(html.includes('href="/kds/orden/a%22b"'));
  assert.ok(html.includes('<span data-elapsed>1h 5min</span>'));
  // Una columna por estado; las vacías dicen "Sin órdenes".
  assert.equal((html.match(/class="kds-col"/g) || []).length, EMP_STATUS.length);
  assert.equal((html.match(/Sin órdenes/g) || []).length, EMP_STATUS.length - 1);
  assert.equal(escapeHtml(null), '');
});

test('elapsedLabel: mismo formato que el tablero', () => {
  assert.equal(elapsedLabel(0), '0 min');
  assert.equal(elapsedLabel(59 * 60000), '59 min');
  assert.equal(elapsedLabel(65 * 60000), '1h 5min');
  assert.equal(elapsedLabel(-5000), '0 min');
});

test('tablero: la firma ignora el tiempo y detecta cambios de estado', () => {
  const a = [{ id: '1', label: 'OS-1', status: 'ingreso_taller', itemCount: 1, createdAt: 'x' }];
  const b = [{ ...a[0], createdAt: 'y' }];
  const c = [{ ...a[0], status: 'trabajo_en_curso' }];
  assert.equal(boardSignature(a), boardSignature(b));
  assert.notEqual(boardSignature(a), boardSignature(c));
  assert.deepEqual(changedStatus(a, c), ['1']);
  assert.deepEqual(changedStatus(a, [...c, { id: '2', status: 'ingreso_taller' }]), ['1']);
});

test('el feed público del kiosco solo expone conteos', () => {
  const src = read('routes/kds.js');
  const m = src.match(/router\.get\('\/en-vivo\.json'[\s\S]*?\n\}\);/);
  assert.ok(m, 'falta la ruta /en-vivo.json');
  for (const campo of ['motorcycle', 'label', 'mechanic', 'clientPhone', 'total', '.id']) {
    assert.ok(!m[0].includes(campo), `/en-vivo.json no debe tocar ${campo}`);
  }
  // Su polling no debe alargar la sesión de PIN de la tablet.
  assert.match(src, /touchPinSession\(\[[^\]]*'\/en-vivo\.json'/);
});
