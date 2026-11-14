// Prueba en navegador real del asistente del panel (Playwright + modelo
// SIMULADO). Solo desarrollo, US$0: levanta el sitio contra una base SQLite
// temporal (nunca la de producción), entra como admin con una sesión firmada
// con una clave de prueba y recorre: preguntar, aprobar, descartar, retomar,
// buscador sin IA y caja sin clave.
//
//   npm run test:e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const raizRepo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = mkdtempSync(path.join(tmpdir(), 'panel-ia-e2e-'));
const capturas = process.env.PANEL_IA_CAPTURAS || path.join(dir, 'capturas');
mkdirSync(capturas, { recursive: true });

const TURSO_URL = `file:${path.join(dir, 'e2e.db')}`;
const JWT_SECRET = 'e2e-secreto-solo-pruebas';
process.env.TURSO_URL = TURSO_URL;
process.env.TURSO_TOKEN = 'local';

const dbm = require('../../db.js');
const jwt = require('jsonwebtoken');
const { chromium } = require('playwright');

const ADMIN_ID = 'u-e2e-admin';
const servidores = [];
let navegador;
let ordenId;

function levantar(puerto, extra) {
  const env = { ...process.env, TURSO_URL, TURSO_TOKEN: 'local', JWT_SECRET, PORT: String(puerto), NODE_ENV: 'development', ...extra };
  delete env.VERCEL;
  const hijo = spawn(process.execPath, ['server.js'], { cwd: raizRepo, env, stdio: ['ignore', 'pipe', 'pipe'] });
  servidores.push(hijo);
  let log = '';
  hijo.stdout.on('data', (d) => { log += d; });
  hijo.stderr.on('data', (d) => { log += d; });
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`El servidor no arrancó:\n${log}`)), 30000);
    const mirar = setInterval(() => {
      if (log.includes('escuchando')) {
        clearInterval(mirar);
        clearTimeout(t);
        resolve(`http://localhost:${puerto}`);
      }
    }, 100);
  });
}

async function paginaAdmin(base) {
  const ctx = await navegador.newContext({ viewport: { width: 1280, height: 900 }, locale: 'es-CO' });
  const token = jwt.sign({ id: ADMIN_ID, tv: 0 }, JWT_SECRET, { expiresIn: '1h' });
  await ctx.addCookies([{ name: 'jwt', value: token, url: base }]);
  return ctx.newPage();
}

let BASE;
let BASE_SIN_CLAVE;

before(async () => {
  await dbm.initDb();
  await dbm.db.execute({ sql: "INSERT INTO users (id, name, first_name, email, role) VALUES (?, 'Ana Admin', 'Ana', 'ana-e2e@example.com', 'admin')", args: [ADMIN_ID] });
  const o = await dbm.createServiceOrder({
    items: [{ name: 'Cambio de aceite', type: 'service', price: 45000, qty: 1 }],
    total: 45000, motorcycle: `ABC12D ${String.fromCharCode(0x2014)} Pulsar NS200`, status: 'ingreso_taller', actor: 'E2E',
  });
  ordenId = o.id;
  await dbm.db.execute(`INSERT INTO products (id, slug, name, brand, sku, category, price, stock, status)
    VALUES ('p-casco-e2e','casco-e2e','Casco LS2 Rapid','LS2','LS2-R','cascos',350000,5,'active')`);
  [BASE, BASE_SIN_CLAVE] = await Promise.all([
    levantar(3917, { PANEL_IA_MODELO_FALSO: '1', ANTHROPIC_API_KEY: '' }),
    levantar(3918, { PANEL_IA_MODELO_FALSO: '0', ANTHROPIC_API_KEY: '' }),
  ]);
  navegador = await chromium.launch();
});

after(async () => {
  await navegador?.close();
  servidores.forEach((s) => s.kill());
  try { dbm.db.close(); } catch { /* ya cerrada */ }
  if (!process.env.PANEL_IA_CAPTURAS) rmSync(dir, { recursive: true, force: true });
});

const fila = async (sql, args = []) => (await dbm.db.execute({ sql, args })).rows[0];

test('pregunta, ve los pasos y la respuesta', async () => {
  const page = await paginaAdmin(BASE);
  await page.goto(`${BASE}/admin`);
  await page.getByRole('heading', { name: /Hola, Ana/ }).waitFor();
  await page.screenshot({ path: path.join(capturas, '1-vacia.png'), fullPage: false });
  await page.getByRole('button', { name: '¿Cómo va el taller hoy?' }).click();
  await page.locator('.pia-respuesta').filter({ hasText: 'órdenes en el panel' }).waitFor();
  assert.match(await page.locator('.pia-pasos').first().innerText(), /Revisando cómo va el taller/);
  assert.match(page.url(), /\?c=/);
  await page.screenshot({ path: path.join(capturas, '2-respuesta.png') });
  await page.context().close();
});

test('pide un cambio, ve la tarjeta, aprueba y el cambio queda en la base con auditoría', async () => {
  const page = await paginaAdmin(BASE);
  await page.goto(`${BASE}/admin`);
  await page.locator('#piaCampo').fill('comenta que el cliente autorizó cambiar pastillas');
  await page.keyboard.press('Enter');
  const tarjeta = page.locator('.pia-tarjeta');
  await tarjeta.waitFor();
  assert.match(await tarjeta.innerText(), /comentario en la orden/i);
  assert.match(await tarjeta.innerText(), /el cliente autorizó cambiar pastillas/);
  await page.screenshot({ path: path.join(capturas, '3-tarjeta.png') });
  // Antes de aprobar, nada en la base.
  assert.equal(Number((await fila("SELECT COUNT(*) AS n FROM service_order_events WHERE status = 'comentario'")).n), 0);
  await tarjeta.getByRole('button', { name: 'Publicar comentario' }).click();
  await tarjeta.locator('.pia-sello.is-ok').waitFor();
  await page.locator('.pia-respuesta').filter({ hasText: 'Listo' }).waitFor();
  const ev = await fila("SELECT detail, actor FROM service_order_events WHERE status = 'comentario' AND service_order_id = ?", [ordenId]);
  assert.equal(ev.detail, 'el cliente autorizó cambiar pastillas');
  assert.equal(ev.actor, 'Ana (asistente)');
  const aud = await fila("SELECT decision, ok FROM asistente_auditoria WHERE herramienta = 'comentar_orden'");
  assert.equal(aud.decision, 'aprobada');
  assert.equal(Number(aud.ok), 1);
  await page.screenshot({ path: path.join(capturas, '4-aprobada.png') });
  // El comentario se ve en la línea de tiempo de la orden.
  await page.goto(`${BASE}/admin/ordenes-servicio/${ordenId}`);
  await page.getByText('Comentario: el cliente autorizó cambiar pastillas').waitFor();
  await page.context().close();
});

test('descartar no cambia la base', async () => {
  const page = await paginaAdmin(BASE);
  await page.goto(`${BASE}/admin`);
  await page.locator('#piaCampo').fill('cambia el precio del casco a 400.000');
  await page.keyboard.press('Enter');
  const tarjeta = page.locator('.pia-tarjeta');
  await tarjeta.waitFor();
  assert.match(await tarjeta.innerText(), /publicado/);
  await page.screenshot({ path: path.join(capturas, '5-precio.png') });
  await tarjeta.getByRole('button', { name: 'Descartar' }).click();
  await tarjeta.locator('.pia-sello.is-no').waitFor();
  assert.equal(Number((await fila("SELECT price FROM products WHERE id = 'p-casco-e2e'")).price), 350000);
  await page.context().close();
});

test('recientes y retomar con ?c=', async () => {
  const page = await paginaAdmin(BASE);
  await page.goto(`${BASE}/admin`);
  const enlace = page.locator('#piaRecientes a').filter({ hasText: 'comenta que el cliente' });
  await enlace.waitFor();
  await enlace.click();
  await page.locator('.pia-pregunta').filter({ hasText: 'comenta que el cliente' }).waitFor();
  await page.locator('.pia-respuesta').filter({ hasText: 'Listo' }).waitFor();
  await page.screenshot({ path: path.join(capturas, '8-retomar.png'), fullPage: true });
  await page.context().close();
});

test('buscador sin IA: encuentra la orden por placa', async () => {
  const page = await paginaAdmin(BASE);
  await page.goto(`${BASE}/admin`);
  await page.locator('#piaCampo').pressSequentially('ABC12', { delay: 30 });
  const res = page.locator('.pia-resultado').filter({ hasText: 'Pulsar NS200' });
  await res.waitFor();
  await page.screenshot({ path: path.join(capturas, '6-buscador.png') });
  await page.context().close();
});

test('sin clave de API: la caja solo busca', async () => {
  const page = await paginaAdmin(BASE_SIN_CLAVE);
  await page.goto(`${BASE_SIN_CLAVE}/admin`);
  await page.locator('#piaNota').filter({ hasText: 'solo busca' }).waitFor();
  await page.locator('#piaCampo').pressSequentially('factur', { delay: 30 });
  await page.locator('.pia-resultado').filter({ hasText: 'Facturas' }).waitFor();
  assert.equal(await page.locator('.pia-resultado.is-ia').count(), 0);
  await page.context().close();
});

test('móvil: sin desborde horizontal', async () => {
  const ctx = await navegador.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-CO' });
  await ctx.addCookies([{ name: 'jwt', value: jwt.sign({ id: ADMIN_ID, tv: 0 }, JWT_SECRET), url: BASE }]);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin`);
  await page.locator('#piaCampo').fill('cambia el precio del casco a 410.000');
  await page.keyboard.press('Enter');
  await page.locator('.pia-tarjeta').waitFor();
  const desborde = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.screenshot({ path: path.join(capturas, '7-movil.png'), fullPage: true });
  assert.ok(desborde <= 1, `desborde horizontal de ${desborde}px`);
  await ctx.close();
});
