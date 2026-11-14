// Avisos ntfy (helpers/ntfy.js): sin red, con un fetch falso.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { notify, buildPayload } = require('../helpers/ntfy.js');

function withEnv(vars, fn) {
  const prev = {};
  for (const k of Object.keys(vars)) { prev[k] = process.env[k]; if (vars[k] == null) delete process.env[k]; else process.env[k] = vars[k]; }
  return Promise.resolve(fn()).finally(() => { for (const k of Object.keys(prev)) { if (prev[k] == null) delete process.env[k]; else process.env[k] = prev[k]; } });
}

test('sin NTFY_TOPIC no llama a la red', () => withEnv({ NTFY_TOPIC: null }, async () => {
  let called = false;
  assert.equal(await notify({ message: 'x' }, { fetchImpl: async () => { called = true; } }), false);
  assert.equal(called, false);
}));

test('publica JSON en el servidor con tildes intactas y token opcional', () => withEnv({ NTFY_TOPIC: 'tema', NTFY_SERVER: 'https://ntfy.ejemplo/', NTFY_TOKEN: 'tk' }, async () => {
  let req;
  const ok = await notify({ title: 'Nueva cita: Mecánica', message: 'Año', tags: ['calendar'], click: 'https://x/admin' }, {
    fetchImpl: async (url, opts) => { req = { url, opts }; return { ok: true }; },
  });
  assert.equal(ok, true);
  assert.equal(req.url, 'https://ntfy.ejemplo');
  assert.equal(req.opts.headers.Authorization, 'Bearer tk');
  const body = JSON.parse(req.opts.body);
  assert.deepEqual(body, { topic: 'tema', title: 'Nueva cita: Mecánica', message: 'Año', tags: ['calendar'], click: 'https://x/admin' });
}));

test('un fallo de red no lanza', () => withEnv({ NTFY_TOPIC: 'tema' }, async () => {
  assert.equal(await notify({ message: 'x' }, { fetchImpl: async () => { throw new Error('caído'); } }), false);
  assert.equal(await notify({ message: 'x' }, { fetchImpl: async () => ({ ok: false, status: 403 }) }), false);
}));

test('recorta textos largos', () => withEnv({ NTFY_TOPIC: 'tema' }, () => {
  const p = buildPayload({ title: 'a'.repeat(500), message: 'b'.repeat(5000) });
  assert.equal(p.title.length, 200);
  assert.equal(p.message.length, 4000);
}));
