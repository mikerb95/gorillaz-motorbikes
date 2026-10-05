// Entregas por localidad (helpers/shop/delivery.js) y horario único del
// negocio en hora de Bogotá (helpers/business.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Los helpers importan db.js de forma indirecta: BD en memoria, nunca la real.
process.env.TURSO_URL = 'file::memory:';
const { normalize, availableMethods, quoteDelivery, BOGOTA_LOCALIDADES } = require('../../helpers/shop/delivery.js');
const { openStatus, hoursSummary, openingHoursSpecification, localBusinessJsonLd, DEFAULTS } = require('../../helpers/business.js');
const { availableDates, isValidSlot } = require('../../helpers/shop/install-slots.js');

test('sin configurar, solo existe recoger en el taller (no se inventan tarifas)', () => {
  const cfg = normalize({});
  assert.deepEqual(availableMethods(cfg), ['pickup']);
  assert.equal(cfg.local.zones.length, BOGOTA_LOCALIDADES.length);
  assert.ok(cfg.local.zones.every((z) => z.fee === null && !z.enabled));
});

test('una localidad sin tarifa no se ofrece aunque esté marcada', () => {
  const cfg = normalize({ local: { enabled: true, zones: [{ slug: 'usme', enabled: true, fee: null }, { slug: 'bosa', enabled: true, fee: 8000 }] } });
  assert.deepEqual(availableMethods(cfg), ['pickup', 'local']);
  assert.equal(quoteDelivery(cfg, { method: 'local', zone: 'usme' }).ok, false);
  assert.equal(quoteDelivery(cfg, { method: 'local', zone: 'bosa' }).fee, 8000);
});

test('envío nacional requiere tarifa', () => {
  assert.ok(!availableMethods(normalize({ national: { enabled: true } })).includes('national'));
  assert.equal(quoteDelivery(normalize({ national: { enabled: true, fee: 15000 } }), { method: 'national' }).fee, 15000);
});

const biz = { ...DEFAULTS, hours: { mon: [['09:00', '18:00']], tue: [['09:00', '18:00']], wed: [['09:00', '18:00']], thu: [['09:00', '18:00']], fri: [['09:00', '18:00']], sat: [['10:00', '16:00']], sun: [] } };

test('abierto/cerrado se calcula en hora de Bogotá (UTC-5)', () => {
  // Lunes 5 oct 2026, 14:00 UTC = 9:00 en Bogotá → abierto.
  assert.equal(openStatus(biz, new Date('2026-10-05T14:00:00Z')).open, true);
  // Lunes 13:59 UTC = 8:59 en Bogotá → cerrado, abre hoy.
  const s = openStatus(biz, new Date('2026-10-05T13:59:00Z'));
  assert.equal(s.open, false);
  assert.match(s.label, /Abre hoy/);
  // Domingo → abre mañana.
  assert.match(openStatus(biz, new Date('2026-10-04T17:00:00Z')).label, /mañana/);
  // Sábado 23:00 UTC = 18:00 Bogotá → cerrado (cierra a las 4 p. m.).
  assert.equal(openStatus(biz, new Date('2026-10-03T23:00:00Z')).open, false);
});

test('resumen agrupa días iguales y JSON-LD omite lo no configurado', () => {
  const sum = hoursSummary(biz);
  assert.deepEqual(sum.map((h) => h.days), ['Lun - Vie', 'Sáb', 'Dom']);
  assert.equal(sum[2].text, 'Cerrado');
  assert.equal(openingHoursSpecification(biz)[0].dayOfWeek.length, 5);
  const ld = localBusinessJsonLd('https://ejemplo.co', biz);
  assert.equal(ld.geo, undefined); // sin coordenadas no se publica geo
  assert.equal(ld.aggregateRating, undefined);
  assert.equal(ld.address.streetAddress, 'Tv. 42a #5i 20');
  assert.equal(ld['@type'], 'MotorcycleRepair');
});

test('agenda de instalación: solo días con horario, desde la anticipación mínima', () => {
  const dates = availableDates(biz, { minLeadDays: 1, daysAhead: 7 }, new Date('2026-10-03T15:00:00Z')); // sábado
  assert.ok(!dates.some((d) => d.date === '2026-10-04')); // domingo cerrado
  assert.equal(dates[0].date, '2026-10-05');
  assert.deepEqual(dates[0].slots.slice(0, 2), ['09:00', '10:00']);
  assert.equal(dates[0].slots.at(-1), '17:00');
  assert.equal(isValidSlot(biz, { minLeadDays: 1, daysAhead: 7 }, '2026-10-03', '10:00', new Date('2026-10-03T15:00:00Z')), false);
});
