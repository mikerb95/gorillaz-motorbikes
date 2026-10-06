// Lógica pura del club: niveles, documentos, racha, reto del mes, insignias.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';

const require = createRequire(import.meta.url);
const lib = require('../../helpers/club/lib.js');
const { DEFAULTS } = { DEFAULTS: {
  levels: [
    { name: 'Gorilla Legend', min: 1500 }, { name: 'Gorilla', min: 700 }, { name: 'Rider', min: 300 },
    { name: 'Miembro', min: 100 }, { name: 'Prospecto', min: 0 },
  ],
} };

test('levelProgress usa los niveles configurados (desordenados) y calcula lo que falta', () => {
  const p = lib.levelProgress(180, DEFAULTS.levels);
  assert.equal(p.current.name, 'Miembro');
  assert.equal(p.next.name, 'Rider');
  assert.equal(p.remaining, 120);
  assert.equal(p.pct, 40);
  assert.equal(p.levels[0].name, 'Prospecto');
});

test('levelProgress en el nivel máximo no tiene siguiente y queda al 100 %', () => {
  const p = lib.levelProgress(9999, DEFAULTS.levels);
  assert.equal(p.current.name, 'Gorilla Legend');
  assert.equal(p.next, null);
  assert.equal(p.pct, 100);
  assert.equal(p.remaining, 0);
});

test('levelProgress respeta umbrales cambiados por el admin', () => {
  const p = lib.levelProgress(60, [{ name: 'A', min: 0 }, { name: 'B', min: 50 }, { name: 'C', min: 80 }]);
  assert.equal(p.current.name, 'B');
  assert.equal(p.remaining, 20);
});

test('docState y docLabel', () => {
  assert.equal(lib.docState(null), 'none');
  assert.equal(lib.docState(-1), 'expired');
  assert.equal(lib.docState(0), 'soon');
  assert.equal(lib.docState(30), 'soon');
  assert.equal(lib.docState(31), 'ok');
  assert.equal(lib.docLabel(-1), 'Vencido hace 1 día');
  assert.equal(lib.docLabel(0), 'Vence hoy');
  assert.equal(lib.docLabel(12), 'Vence en 12 días');
});

test('plateFromOrder separa la placa del campo combinado', () => {
  const dash = String.fromCharCode(0x2014);
  assert.equal(lib.plateFromOrder(`abc 12d ${dash} Pulsar NS 200`), 'ABC12D');
  assert.equal(lib.modelFromOrder(`ABC12D ${dash} Pulsar NS 200`), 'Pulsar NS 200');
  assert.equal(lib.plateFromOrder('XYZ98A'), 'XYZ98A');
});

test('monthlyStreak no se rompe el día 1 si el mes anterior estuvo activo', () => {
  const h = [
    { date: '2026-09-20', points: 30 },
    { date: '2026-08-02', points: 10 },
    { date: '2026-07-15', points: 25 },
    { date: '2026-05-01', points: 10 },
  ];
  assert.deepEqual(lib.monthlyStreak(h, '2026-10-01'), { months: 3, currentActive: false });
  assert.deepEqual(lib.monthlyStreak([...h, { date: '2026-10-03', points: 10 }], '2026-10-06'), { months: 4, currentActive: true });
  assert.equal(lib.monthlyStreak(h, '2026-12-01').months, 0);
});

test('monthlyStreak cruza el cambio de año', () => {
  const h = [{ date: '2026-01-05', points: 10 }, { date: '2025-12-20', points: 10 }];
  assert.equal(lib.monthlyStreak(h, '2026-01-10').months, 2);
});

test('monthlyChallenge cuenta solo el mes en curso y los conceptos del reto', () => {
  const ch = lib.monthlyChallenge([
    { date: '2026-01-04', points: 30, concept: 'rodada' },
    { date: '2025-12-30', points: 30, concept: 'rodada' },
  ], '2026-01-10');
  assert.equal(ch.id, 'rodar');
  assert.equal(ch.value, 1);
  assert.equal(ch.done, true);
  assert.equal(ch.daysLeft, 22);
  const oct = lib.monthlyChallenge([{ date: '2026-10-02', points: 10, concept: 'rodada' }], '2026-10-31');
  assert.equal(oct.id, 'taller');
  assert.equal(oct.done, false);
  assert.equal(oct.daysLeft, 1);
});

test('computeBadges marca ganadas y topa el progreso en la meta', () => {
  const b = lib.computeBadges({ rodadas: 7, servicios: 0, streak: 3, daysInClub: 400 });
  const by = Object.fromEntries(b.map(x => [x.id, x]));
  assert.equal(by['primera-rodada'].earned, true);
  assert.equal(by.rodador.earned, true);
  assert.equal(by.manada.earned, false);
  assert.equal(by.manada.value, 7);
  assert.equal(by['primera-rodada'].value, 1);
  assert.equal(by['racha-3'].earned, true);
  assert.equal(by['aniversario-1'].earned, true);
  assert.equal(by['primer-servicio'].earned, false);
  assert.equal(new Set(b.map(x => x.id)).size, b.length);
});

test('daysSince con fechas solo día', () => {
  assert.equal(lib.daysSince('2025-10-06', '2026-10-06'), 365);
  assert.equal(lib.daysSince('', '2026-10-06'), 0);
  assert.equal(lib.daysUntil('2026-10-18', '2026-10-06'), 12);
  assert.equal(lib.daysUntil('2026-10-01', '2026-10-06'), -5);
  assert.equal(lib.daysUntil('', '2026-10-06'), null);
});

test('código de miembro: formato y sin caracteres ambiguos', () => {
  for (let i = 0; i < 200; i++) {
    const c = lib.newMemberCode(randomBytes);
    assert.ok(lib.isMemberCode(c), c);
    assert.doesNotMatch(c.slice(2), /[01OIL]/);
  }
  assert.equal(lib.isMemberCode('GZ12345O'), false);
  assert.equal(lib.isMemberCode("GZABCDEF' OR 1"), false);
});
