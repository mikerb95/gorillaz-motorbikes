// Precios, descuentos, precio club, combos, cupones, instalación y entrega
// (helpers/shop/pricing.js). Funciones puras: sin BD ni red.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Los helpers importan db.js de forma indirecta: BD en memoria, nunca la real.
process.env.TURSO_URL = 'file::memory:';
const { unitPrice, computeCart, applyCombos, couponDiscount } = require('../../helpers/shop/pricing.js');
const { normalize } = require('../../helpers/shop/delivery.js');

const P = (o) => ({ id: o.id, name: o.id, slug: o.id, price: 100000, discount: 0, clubDiscount: 0, installable: false, installPrice: null, ...o });
const line = (product, qty = 1, extra = {}) => ({ key: product.id, product, variant: null, qty, ...extra });

test('precio unitario: descuento normal con redondeo a peso', () => {
  const u = unitPrice(P({ id: 'a', price: 99990, discount: 15 }));
  assert.equal(u.base, 99990);
  assert.equal(u.final, 84992); // 99990 * 0.85 = 84991.5 → 84992
  assert.equal(u.pct, 15);
});

test('precio club: se ve para todos, se aplica solo a miembros y gana el mejor', () => {
  const p = P({ id: 'a', price: 200000, discount: 5, clubDiscount: 12 });
  assert.equal(unitPrice(p).final, 190000);
  assert.equal(unitPrice(p).club, 176000);
  assert.equal(unitPrice(p, null, { member: true }).final, 176000);
  assert.equal(unitPrice(p, null, { member: true }).isClubApplied, true);
  // Si el descuento normal es mayor, el club no empeora el precio.
  const q = P({ id: 'b', price: 200000, discount: 20, clubDiscount: 10 });
  assert.equal(unitPrice(q, null, { member: true }).final, 160000);
  assert.equal(unitPrice(q).club, null);
});

test('la variante con precio propio reemplaza el precio base', () => {
  const p = P({ id: 'a', price: 100000, discount: 10 });
  assert.equal(unitPrice(p, { id: 'v', price: 120000 }).final, 108000);
  assert.equal(unitPrice(p, { id: 'v', price: null }).final, 90000);
});

test('descuentos fuera de rango se acotan a 0..100', () => {
  assert.equal(unitPrice(P({ id: 'a', discount: 150 })).final, 0);
  assert.equal(unitPrice(P({ id: 'a', discount: -5 })).final, 100000);
});

test('combo armable: escalón según unidades elegibles', () => {
  const a = P({ id: 'a', price: 100000 });
  const b = P({ id: 'b', price: 50000 });
  const combo = { id: 'c', name: 'Arma tu kit', kind: 'armable', active: true, tiers: [{ min: 2, pct: 5 }, { min: 3, pct: 10 }], items: [{ productId: 'a' }, { productId: 'b' }] };
  let r = computeCart({ lines: [line(a), line(b)], combos: [combo] });
  assert.equal(r.discountTotal, 7500); // 5 % de 150.000
  r = computeCart({ lines: [line(a, 2), line(b)], combos: [combo] });
  assert.equal(r.discountTotal, 25000); // 10 % de 250.000
  r = computeCart({ lines: [line(a)], combos: [combo] });
  assert.equal(r.discountTotal, 0); // una unidad no alcanza el primer escalón
});

test('kit: descuento solo con todas las piezas y por kits completos', () => {
  const a = P({ id: 'a', price: 100000 });
  const b = P({ id: 'b', price: 40000 });
  const kit = { id: 'k', name: 'Kit', kind: 'kit', active: true, kitDiscount: 10, items: [{ productId: 'a', qty: 1 }, { productId: 'b', qty: 2 }] };
  assert.equal(computeCart({ lines: [line(a), line(b)], combos: [kit] }).discountTotal, 0);
  assert.equal(computeCart({ lines: [line(a), line(b, 2)], combos: [kit] }).discountTotal, 18000);
  // 2 de "a" y 3 de "b": solo cabe un kit completo.
  assert.equal(computeCart({ lines: [line(a, 2), line(b, 3)], combos: [kit] }).discountTotal, 18000);
});

test('una unidad no recibe dos descuentos de combo (kit primero)', () => {
  const a = P({ id: 'a', price: 100000 });
  const b = P({ id: 'b', price: 100000 });
  const kit = { id: 'k', name: 'Kit', kind: 'kit', active: true, kitDiscount: 20, items: [{ productId: 'a', qty: 1 }, { productId: 'b', qty: 1 }] };
  const arm = { id: 'm', name: 'Armable', kind: 'armable', active: true, tiers: [{ min: 2, pct: 10 }], items: [{ productId: 'a' }, { productId: 'b' }] };
  const d = applyCombos([{ key: 'a', productId: 'a', qty: 1, unitPrice: 100000 }, { key: 'b', productId: 'b', qty: 1, unitPrice: 100000 }], [arm, kit]);
  assert.deepEqual(d.map((x) => x.comboId), ['k']);
  assert.equal(d[0].amount, 40000);
});

test('combos inactivos no aplican', () => {
  const a = P({ id: 'a' });
  const combo = { id: 'c', name: 'x', kind: 'armable', active: false, tiers: [{ min: 2, pct: 50 }], items: [{ productId: 'a' }] };
  assert.equal(computeCart({ lines: [line(a, 3)], combos: [combo] }).discountTotal, 0);
});

test('cupón: porcentaje, valor fijo tope y compra mínima', () => {
  assert.equal(couponDiscount({ kind: 'pct', value: 10 }, 85000), 8500);
  assert.equal(couponDiscount({ kind: 'amount', value: 50000 }, 30000), 30000);
  assert.equal(couponDiscount({ kind: 'pct', value: 10, minSubtotal: 100000 }, 99999), 0);
});

test('el cupón se aplica después del combo y no sobre la entrega', () => {
  const a = P({ id: 'a', price: 100000 });
  const b = P({ id: 'b', price: 100000 });
  const combo = { id: 'c', name: 'x', kind: 'armable', active: true, tiers: [{ min: 2, pct: 10 }], items: [{ productId: 'a' }, { productId: 'b' }] };
  const delivery = { config: normalize({ local: { enabled: true, zones: [{ slug: 'kennedy', enabled: true, fee: 9000 }] } }), method: 'local', zone: 'kennedy' };
  const r = computeCart({ lines: [line(a), line(b)], combos: [combo], coupon: { code: 'X', kind: 'pct', value: 10 }, delivery });
  assert.equal(r.itemsSubtotal, 200000);
  assert.equal(r.comboDiscounts[0].amount, 20000);
  assert.equal(r.couponAmount, 18000);
  assert.equal(r.deliveryFee, 9000);
  assert.equal(r.total, 200000 - 20000 - 18000 + 9000);
});

test('instalación: suma solo si tiene precio; si no, queda pendiente', () => {
  const a = P({ id: 'a', installable: true, installPrice: 30000 });
  const b = P({ id: 'b', installable: true, installPrice: null });
  const c = P({ id: 'c', installable: false, installPrice: 99999 });
  const r = computeCart({ lines: [line(a, 2, { install: true }), line(b, 1, { install: true }), line(c, 1, { install: true })] });
  assert.equal(r.installationTotal, 60000);
  assert.equal(r.installationPending, true);
  assert.equal(r.lines.find((l) => l.productId === 'c').install, false); // no instalable: se ignora
  assert.equal(r.total, 400000 + 60000); // 4 unidades + instalación con precio
});

test('envío gratis desde el umbral, evaluado sobre productos con descuentos', () => {
  const a = P({ id: 'a', price: 100000 });
  const config = normalize({ local: { enabled: true, freeOver: 150000, zones: [{ slug: 'suba', enabled: true, fee: 12000 }] } });
  assert.equal(computeCart({ lines: [line(a)], delivery: { config, method: 'local', zone: 'suba' } }).deliveryFee, 12000);
  assert.equal(computeCart({ lines: [line(a, 2)], delivery: { config, method: 'local', zone: 'suba' } }).deliveryFee, 0);
  // Con un cupón que deja la mercancía bajo el umbral, se cobra el domicilio.
  const r = computeCart({ lines: [line(a, 2)], coupon: { code: 'Z', kind: 'amount', value: 60000 }, delivery: { config, method: 'local', zone: 'suba' } });
  assert.equal(r.deliveryFee, 12000);
});

test('ahorro mostrado = descuento de producto + combos + cupón', () => {
  const a = P({ id: 'a', price: 100000, discount: 10 });
  const r = computeCart({ lines: [line(a, 2)], coupon: { code: 'C', kind: 'amount', value: 5000 } });
  assert.equal(r.savings, 20000 + 5000);
  assert.equal(r.total, 175000);
});
