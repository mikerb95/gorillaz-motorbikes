// Checkout de punta a punta contra un SQLite de archivo y la pasarela simulada:
// invitado con recogida, pago rechazado (libera stock), domicilio + instalación
// + combo (el monto que va a la pasarela es el del carrito), webhook firmado e
// idempotente, sobreventa, reserva concurrente y seguimiento del pedido.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'gz-checkout-'));
process.env.TURSO_URL = `file:${path.join(dir, 'test.db')}`;
process.env.TURSO_TOKEN = 'x';
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-checkout';
process.env.BOLD_API_KEY = 'test-key';
process.env.BOLD_SECRET_KEY = 'test-secret';
process.env.RESEND_API_KEY = '';

// Pasarela simulada: guarda lo que se le pidió cobrar.
const realFetch = globalThis.fetch;
const boldCalls = [];
globalThis.fetch = async (url, opts) => {
  if (String(url).includes('bold.co')) {
    boldCalls.push(JSON.parse(opts.body));
    return new Response(JSON.stringify({ payload: { payment_link: 'https://pago.test/link', payment_id: 'p1' } }), { status: 200 });
  }
  return realFetch(url, opts);
};

let server; let base; let app; let db; let repo; let settings; let catalogMod;
const ids = {};

before(async () => {
  app = require('../../app.js');
  await new Promise((r) => { server = app.listen(0, r); });
  base = `http://127.0.0.1:${server.address().port}`;
  await realFetch(`${base}/tienda/pedido`); // dispara initDb + carga de catálogo
  ({ db } = require('../../db.js'));
  repo = require('../../helpers/shop/repo.js');
  settings = require('../../helpers/settings.js');
  catalogMod = require('../../helpers/catalog.js');

  ids.casco = await repo.saveProduct({ slug: 'casco-test', name: 'Casco Test', category: 'cascos', price: 100000, ownStock: 3, status: 'active', installable: true, installPrice: 20000 });
  ids.guante = await repo.saveProduct({ slug: 'guante-test', name: 'Guante Test', category: 'guantes', price: 50000, ownStock: 1, status: 'active' });
  ids.borrador = await repo.saveProduct({ slug: 'borrador-test', name: 'Borrador', category: 'cascos', price: 1000, ownStock: 5, status: 'draft' });
  await repo.saveCombo({ slug: 'combo-test', name: 'Combo test', kind: 'armable', tiers: [{ min: 2, pct: 10 }], active: true,
    items: [{ productId: ids.casco, qty: 1 }, { productId: ids.guante, qty: 1 }] });
  await settings.set('shop_delivery', { pickup: { enabled: true }, local: { enabled: true, zones: [{ slug: 'kennedy', enabled: true, fee: 8000 }] } });
  await catalogMod.loadCatalog();
});

after(async () => {
  globalThis.fetch = realFetch;
  await new Promise((r) => server.close(r));
  rmSync(dir, { recursive: true, force: true });
});

// Cliente con cookies (carrito, CSRF, pago pendiente).
function client() {
  const jar = { _csrf: 'csrf-test-token' };
  const cookie = () => Object.entries(jar).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('; ');
  const store = (res) => {
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const i = pair.indexOf('=');
      const k = pair.slice(0, i); const v = decodeURIComponent(pair.slice(i + 1));
      if (v === '' || /Expires=Thu, 01 Jan 1970/.test(c)) delete jar[k]; else jar[k] = v;
    }
    return res;
  };
  return {
    jar,
    get: (p) => realFetch(base + p, { headers: { cookie: cookie() }, redirect: 'manual' }).then(store),
    json: (p, body) => realFetch(base + p, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: cookie(), 'content-type': 'application/json', accept: 'application/json', 'x-csrf-token': jar._csrf },
      body: JSON.stringify(body),
    }).then(store),
    form: (p, body) => realFetch(base + p, {
      method: 'POST', redirect: 'manual',
      headers: { cookie: cookie(), 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ _csrf: jar._csrf, ...body }).toString(),
    }).then(store),
  };
}

const stockOf = async (id) => Number((await db.execute({ sql: 'SELECT stock FROM products WHERE id = ?', args: [id] })).rows[0].stock);
const lastOrder = async () => {
  const { getOrderById } = require('../../db.js');
  const r = await db.execute('SELECT id FROM orders ORDER BY rowid DESC LIMIT 1');
  return getOrderById(r.rows[0].id);
};
const sign = (orderId, amount, status) => crypto.createHmac('sha256', 'test-secret').update(`${orderId}${amount}${status}`).digest('hex');

const contact = { customer_name: 'Cliente Prueba', customer_email: 'cliente@prueba.co', customer_phone: '3001234567', accept_terms: '1' };

test('no se puede agregar un producto en borrador', async () => {
  const c = client();
  const r = await c.json('/cart/add', { id: ids.borrador, qty: 1 });
  assert.equal(r.status, 400);
});

test('invitado + recogida: reserva stock y cobra exactamente el total', async () => {
  const c = client();
  const add = await (await c.json('/cart/add', { id: ids.guante, qty: 1 })).json();
  assert.equal(add.ok, true);
  assert.equal(add.cartCount, 1);
  const r = await c.form('/pagar', { ...contact, delivery_method: 'pickup' });
  assert.equal(r.status, 303);
  assert.equal(r.headers.get('location'), 'https://pago.test/link');
  const order = await lastOrder();
  assert.equal(order.total, 50000);
  assert.equal(order.deliveryMethod, 'pickup');
  assert.equal(order.stockReserved, true);
  assert.match(order.publicCode, /^GZ-[A-Z0-9]{6}$/);
  assert.equal(boldCalls.at(-1).amount.total_amount, 50000);
  assert.equal(await stockOf(ids.guante), 0);

  // Pago rechazado: se libera la reserva una sola vez.
  await c.get('/payment/return?bold-tx-status=REJECTED&bold-order-id=x');
  assert.equal(await stockOf(ids.guante), 1);
  await require('../../helpers/shop/orders.js').markFailed(order.id, null);
  assert.equal(await stockOf(ids.guante), 1);
});

test('checkout sin datos obligatorios responde 400 y no crea pedido', async () => {
  const c = client();
  await c.json('/cart/add', { id: ids.casco, qty: 1 });
  const before = Number((await db.execute('SELECT COUNT(*) AS n FROM orders')).rows[0].n);
  const r = await c.form('/pagar', { customer_name: '', delivery_method: 'pickup' });
  assert.equal(r.status, 400);
  assert.equal(Number((await db.execute('SELECT COUNT(*) AS n FROM orders')).rows[0].n), before);
});

test('domicilio + instalación + combo: el carrito, el pedido y la pasarela cuadran', async () => {
  const { getBusiness } = require('../../helpers/business.js');
  const { getShopConfig } = require('../../helpers/shop/config.js');
  const { availableDates } = require('../../helpers/shop/install-slots.js');
  const day = availableDates(getBusiness(), getShopConfig().install)[0];

  const c = client();
  await c.json('/cart/add', { id: ids.casco, qty: 1, install: '1' });
  await c.json('/cart/add', { id: ids.guante, qty: 1 });
  const quote = await (await c.json('/checkout/cotizar', { delivery_method: 'local', delivery_zone: 'kennedy' })).json();
  // 150.000 en productos − 10 % de combo + 20.000 de instalación + 8.000 de domicilio
  assert.equal(quote.total, 150000 - 15000 + 20000 + 8000);

  const r = await c.form('/pagar', {
    ...contact, delivery_method: 'local', delivery_zone: 'kennedy', customer_address: 'Calle 1 # 2-3',
    install_date: day.date, install_time: day.slots[0], install_plate: 'ABC12D',
  });
  assert.equal(r.status, 303);
  const order = await lastOrder();
  assert.equal(order.total, 163000);
  assert.equal(order.discountTotal, 15000);
  assert.equal(order.deliveryFee, 8000);
  assert.equal(order.customerCity, 'Bogotá');
  assert.equal(order.installation.date, day.date);
  assert.equal(boldCalls.at(-1).amount.total_amount, 163000);
  assert.equal(await stockOf(ids.guante), 0);

  // Webhook firmado: confirma una sola vez (cita de instalación única).
  const payload = { order_id: order.id, status: 'APPROVED', amount: { total_amount: 163000 } };
  for (let i = 0; i < 2; i++) {
    const w = await realFetch(`${base}/payment/webhook`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, signature: sign(order.id, 163000, 'APPROVED') }),
    });
    assert.equal(w.status, 200);
  }
  const paid = await lastOrder();
  assert.equal(paid.status, 'paid');
  assert.equal(paid.fulfillmentStatus, 'confirmado');
  assert.ok(paid.appointmentId);
  const appts = await db.execute({ sql: 'SELECT COUNT(*) AS n FROM appointments WHERE plate = ?', args: ['ABC12D'] });
  assert.equal(Number(appts.rows[0].n), 1);
  assert.equal(await stockOf(ids.guante), 0); // la reserva quedó como venta

  // Un webhook sin firma válida no toca nada.
  const bad = await realFetch(`${base}/payment/webhook`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...payload, signature: 'abcd' }) });
  assert.equal(bad.status, 401);

  // Seguimiento con código + últimos 4 del celular (y sin enumeración).
  const t = client();
  const ok = await t.form('/tienda/pedido', { code: paid.publicCode, tel4: '4567' });
  assert.equal(ok.status, 200);
  assert.match(await ok.text(), /Pago confirmado/);
  const no = await t.form('/tienda/pedido', { code: paid.publicCode, tel4: '0000' });
  assert.equal(no.status, 404);
});

test('sin stock no se puede agregar ni pagar (no hay sobreventa)', async () => {
  await catalogMod.loadCatalog();
  const c = client();
  const r = await c.json('/cart/add', { id: ids.guante, qty: 1 });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).message, 'Producto agotado');
});

test('reservas concurrentes de la última unidad: solo una gana', async () => {
  const id = await repo.saveProduct({ slug: 'ultima-unidad', name: 'Última unidad', category: 'cascos', price: 10000, ownStock: 1, status: 'active' });
  const results = await Promise.allSettled([1, 2, 3].map(() => repo.reserveStock([{ productId: id, variantId: null, qty: 1 }])));
  const wins = results.filter((x) => x.status === 'fulfilled' && x.value.ok).length;
  assert.equal(wins, 1);
  assert.equal(await stockOf(id), 0);
});

test('URLs antiguas redirigen 301 y las páginas privadas no se indexan', async () => {
  const c = client();
  const legacy = await c.get('/tienda?cat=cascos');
  assert.equal(legacy.status, 301);
  assert.equal(legacy.headers.get('location'), '/tienda/c/cascos');
  const cart = await (await c.get('/carrito')).text();
  assert.match(cart, /<meta name="robots" content="noindex/);
  const ficha = await (await c.get('/tienda/casco-test')).text();
  assert.match(ficha, /<link rel="canonical" href="https:\/\/gorillazmotorbikes\.com\/tienda\/casco-test"/);
  assert.match(ficha, /"@type":"Product"/);
  assert.match(ficha, /"priceCurrency":"COP"/);
  const filtered = await (await c.get('/tienda/c/cascos?sort=precio-asc')).text();
  assert.match(filtered, /noindex, follow/);
  assert.match(filtered, /rel="canonical" href="https:\/\/gorillazmotorbikes\.com\/tienda\/c\/cascos"/);
  const sitemap = await (await c.get('/sitemap.xml')).text();
  assert.match(sitemap, /\/tienda\/casco-test</);
  assert.match(sitemap, /\/tienda\/c\/cascos</);
  assert.doesNotMatch(sitemap, /borrador-test/);
});
