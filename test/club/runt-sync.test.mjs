// Consulta automática del RUNT por proveedor (Verifik / PlacApi): normaliza
// las fechas, guarda el estado en la moto y solo gasta consultas cuando toca.
import { test, before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'gz-runt-'));
process.env.TURSO_URL = `file:${path.join(dir, 'test.db')}`;
process.env.TURSO_TOKEN = 'x';
process.env.NODE_ENV = 'test';

const { initDb, createUser, getUserById } = require('../../db.js');
const { consultarVehiculo, providerName } = require('../../helpers/runt-provider.js');
const { needsRefresh, syncVehicle, refreshDueVehicles } = require('../../helpers/club/runt-sync.js');

const realFetch = globalThis.fetch;
let calls = [];
function mockFetch(handler) {
  calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), opts });
    const [status, body] = handler(String(url), opts);
    return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  };
}

before(async () => { await initDb(); });
afterEach(() => {
  globalThis.fetch = realFetch;
  delete process.env.VERIFIK_API_TOKEN;
  delete process.env.PLACAPI_API_KEY;
  delete process.env.RUNT_PROVIDER;
});
after(() => rmSync(dir, { recursive: true, force: true }));

test('sin clave no hay proveedor', () => {
  assert.equal(providerName(), null);
});

test('Verifik: GET con Bearer y fechas DD/MM/YYYY normalizadas', async () => {
  process.env.VERIFIK_API_TOKEN = 'vk';
  mockFetch(() => [200, { data: { soat: { dueDate: '19/09/2027' }, techReview: { dueDate: '22/09/2026' } } }]);
  const r = await consultarVehiculo({ plate: 'abc 12d', docNumber: '1.020.304.050' });
  assert.deepEqual(r, { status: 'ok', soat: '2027-09-19', tecno: '2026-09-22' });
  const u = new URL(calls[0].url);
  assert.equal(u.searchParams.get('plate'), 'ABC12D');
  assert.equal(u.searchParams.get('documentNumber'), '1020304050');
  assert.equal(calls[0].opts.headers.authorization, 'Bearer vk');
});

test('PlacApi: toma la vigencia más lejana del histórico; 404 = notfound', async () => {
  process.env.PLACAPI_API_KEY = 'pk';
  mockFetch(() => [200, { data: {
    soat: [{ fechaVencimiento: '19/09/2025' }, { fechaVencimiento: '19/09/2026' }],
    tecnoMecanica: [],
  } }]);
  assert.deepEqual(await consultarVehiculo({ plate: 'ABC12D', docNumber: '123456' }), { status: 'ok', soat: '2026-09-19', tecno: null });
  assert.equal(calls[0].opts.headers['x-api-key'], 'pk');

  mockFetch(() => [404, { code: 'propietario_no_coincide' }]);
  assert.deepEqual(await consultarVehiculo({ plate: 'ABC12D', docNumber: '123456' }), { status: 'notfound', reason: 'propietario_no_coincide' });
  mockFetch(() => [502, { code: 'source_error' }]);
  assert.equal((await consultarVehiculo({ plate: 'ABC12D', docNumber: '123456' })).status, 'error');
});

test('needsRefresh: solo gasta consultas cuando hace falta', () => {
  const now = Date.parse('2026-10-06T15:00:00Z');
  const ago = (d) => new Date(now - d * 86400000).toISOString();
  const user = { cedula: '123456' };
  const ok = (soat, tecno, d) => ({ plate: 'A', runtStatus: 'ok', runtDoc: '123456', runtCheckedAt: ago(d), soatExpires: soat, tecnoExpires: tecno });
  assert.equal(needsRefresh({ plate: 'A' }, user, now, '2026-10-06'), true);              // nunca consultada
  assert.equal(needsRefresh({ plate: 'A' }, {}, now, '2026-10-06'), false);               // sin cédula
  assert.equal(needsRefresh({ ...ok('2027-05-01', '2027-05-01', 1), ownerDoc: '999999' }, user, now, '2026-10-06'), true); // cambió el documento
  assert.equal(needsRefresh(ok('2027-05-01', '2027-05-01', 30), user, now, '2026-10-06'), false); // todo vigente
  assert.equal(needsRefresh(ok('2027-05-01', '2027-05-01', 181), user, now, '2026-10-06'), true); // repaso semestral
  assert.equal(needsRefresh(ok('2026-10-10', '2027-05-01', 2), user, now, '2026-10-06'), false);  // por vencer, visto hace 2 días
  assert.equal(needsRefresh(ok('2026-10-10', '2027-05-01', 3), user, now, '2026-10-06'), true);   // por vencer, cada 3 días
  assert.equal(needsRefresh(ok('2026-10-06', '2027-05-01', 1), user, now, '2026-10-06'), true);   // vence hoy: a diario
  assert.equal(needsRefresh({ ...ok('', '', 400), runtStatus: 'notfound' }, user, now, '2026-10-06'), false); // mismo doc, mismo resultado
});

test('syncVehicle guarda fechas y estado; refreshDueVehicles respeta el tope', async () => {
  process.env.PLACAPI_API_KEY = 'pk';
  await createUser({ id: 'u-runt-1', name: 'Ana', email: 'ana-runt@test.co', cedula: '1020304050',
    vehicles: [{ plate: 'AAA11A', soatExpires: '2020-01-01' }, { plate: 'BBB22B', ownerDoc: '777777' }] });
  mockFetch((url, opts) => {
    const b = JSON.parse(opts.body);
    if (b.placa === 'BBB22B') return [404, { code: 'propietario_no_coincide' }];
    return [200, { data: { soat: [{ fechaVencimiento: '01/12/2026' }], tecnoMecanica: [{ fechaVencimiento: '15/03/2027' }] } }];
  });

  const v = await syncVehicle('u-runt-1', 'AAA11A');
  assert.equal(v.runtStatus, 'ok');
  assert.equal(v.soatExpires, '2026-12-01'); // la fecha vieja escrita a mano se reemplaza
  assert.equal(v.tecnoExpires, '2027-03-15');
  assert.equal(v.runtDoc, '1020304050');

  assert.equal(await refreshDueVehicles({ limit: 5 }), 1); // solo BBB22B estaba pendiente
  const bbb = (await getUserById('u-runt-1')).vehicles.find(x => x.plate === 'BBB22B');
  assert.equal(bbb.runtStatus, 'notfound');
  assert.equal(JSON.parse(calls.at(-1).opts.body).docNumber, "777777"); // usa la cédula del propietario
  // Las dos motos siguen ahí (sin pisarse) y ninguna necesita otra consulta.
  assert.equal((await getUserById('u-runt-1')).vehicles.length, 2);
  calls = [];
  assert.equal(await refreshDueVehicles({ limit: 5 }), 0);
  assert.equal(calls.length, 0);
});
