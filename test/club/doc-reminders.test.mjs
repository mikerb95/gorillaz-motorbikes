// Avisos de SOAT/tecnomecánica: escalones (30, 7, 0 días), sin repetir, que
// vuelvan a empezar al renovar y que respeten las notificaciones apagadas.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const dir = mkdtempSync(path.join(tmpdir(), 'gz-docs-'));
process.env.TURSO_URL = `file:${path.join(dir, 'test.db')}`;
process.env.TURSO_TOKEN = 'x';
process.env.NODE_ENV = 'test';
process.env.RESEND_API_KEY = 're_test_docs';

const { initDb, createUser, getUserById, updateUser } = require('../../db.js');
const { resendClient } = require('../../config');
const { remindExpiringDocs, dueDocs, stepFor } = require('../../helpers/club/doc-reminders.js');
const { consultarHistorialRunt } = require('../../helpers/runt.js');

const sent = [];
resendClient.emails.send = async (msg) => { sent.push(msg); return { id: 'x' }; };

before(async () => { await initDb(); });
after(() => rmSync(dir, { recursive: true, force: true }));

test('stepFor: escalón alcanzado, nada lejos ni muy vencido', () => {
  assert.equal(stepFor(45), null);
  assert.equal(stepFor(30), 30);
  assert.equal(stepFor(12), 30);
  assert.equal(stepFor(7), 7);
  assert.equal(stepFor(1), 7);
  assert.equal(stepFor(0), 0);
  assert.equal(stepFor(-2), 0);
  assert.equal(stepFor(-10), null);
  assert.equal(stepFor(null), null);
});

test('dueDocs no repite un escalón ya avisado para la misma fecha', () => {
  const v = [{ plate: 'ABC12D', soatExpires: '2026-10-10', reminded: { soat: '2026-10-10@7' } }];
  assert.equal(dueDocs(v, '2026-10-05').length, 0); // 5 días: escalón 7, ya avisado
  assert.equal(dueDocs(v, '2026-10-10').length, 1); // vence hoy: escalón 0
  // Renovó: fecha nueva, la marca vieja no cuenta.
  const renewed = [{ ...v[0], soatExpires: '2027-10-08' }];
  assert.equal(dueDocs(renewed, '2027-10-01')[0].mark, '2027-10-08@7');
});

test('remindExpiringDocs: un correo por usuario, marca, y no repite al otro día', async () => {
  const a = await createUser({ id: 'u-docs-a', name: 'Ana', firstName: 'Ana', email: 'ana@test.co',
    vehicles: [{ plate: 'AAA11A', soatExpires: '2026-10-20', tecnoExpires: '2026-10-08' }] });
  await createUser({ id: 'u-docs-b', name: 'Beto', email: 'beto@test.co', clubNotifications: false,
    vehicles: [{ plate: 'BBB22B', soatExpires: '2026-10-08' }] });
  await createUser({ id: 'u-docs-c', name: 'Caro', email: 'caro@test.co',
    vehicles: [{ plate: 'CCC33C', soatExpires: '2027-05-01', tecnoExpires: '2025-01-01' }] });

  sent.length = 0;
  assert.equal(await remindExpiringDocs('2026-10-06'), 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, 'ana@test.co');
  assert.match(sent[0].html, /AAA11A/);
  assert.match(sent[0].html, /alistamiento-tecnomecanica/);

  const marks = (await getUserById(a.id ?? 'u-docs-a')).vehicles[0].reminded;
  assert.deepEqual(marks, { soat: '2026-10-20@30', tecno: '2026-10-08@7' });

  sent.length = 0;
  assert.equal(await remindExpiringDocs('2026-10-07'), 0);
  assert.equal(await remindExpiringDocs('2026-10-08'), 1); // la tecno vence hoy
  assert.match(sent[0].subject, /vencido/);

  // Editar la fecha a mano conserva las marcas viejas, pero ya no aplican.
  const u = await getUserById('u-docs-a');
  await updateUser(u.id, { vehicles: u.vehicles.map(v => ({ ...v, tecnoExpires: '2027-10-08' })) });
  sent.length = 0;
  assert.equal(await remindExpiringDocs('2026-10-14'), 1); // SOAT a 6 días: escalón 7
  assert.doesNotMatch(sent[0].html, /Tecnomecánica/);
});

test('consulta RUNT: la sesión del captcha sobrevive en la BD entre requests', async () => {
  const realFetch = globalThis.fetch;
  const seen = [];
  const json = (data, cookie) => new Response(JSON.stringify(data), {
    status: 200, headers: { 'content-type': 'application/json', ...(cookie ? { 'set-cookie': cookie } : {}) },
  });
  globalThis.fetch = async (url, opts = {}) => {
    seen.push({ url: String(url), cookie: opts.headers?.cookie || '' });
    if (url.endsWith('/configuracion-sesion')) return json({}, 'S=1; Path=/');
    if (url.endsWith('/captcha/libre-captcha/generar')) return json({ id: 'cap-1', imagen: 'data:image/png;base64,AA' }, 'C=2; Path=/');
    if (url.endsWith('/auth')) return json({ token: 'tk' });
    if (url.endsWith('/soat')) return json([{ estado: 'VIGENTE', fechaVencimSoat: '20/03/2027' }]);
    if (url.includes('/rtms')) return json({ revisiones: [{ vigente: 'SI', fechaVencimientoRvt: '2027-01-15' }] });
    throw new Error('url inesperada ' + url);
  };
  try {
    const { generarCaptcha } = require('../../helpers/runt.js');
    await generarCaptcha();
    const r = await consultarHistorialRunt('abc12d', '1020304050', 'cap-1', 'XYZ');
    assert.equal(r.success, true, r.error);
    assert.deepEqual(r.data, { soat_vencimiento: '2027-03-20', tecno_vencimiento: '2027-01-15' });
    const auth = seen.find(s => s.url.endsWith('/auth'));
    assert.equal(auth.cookie, 'S=1; C=2');
  } finally {
    globalThis.fetch = realFetch;
  }
});
