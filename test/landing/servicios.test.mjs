// Tests de /servicios: lógica pura del motion y fidelidad del contenido.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { flightFrame, rectCenter } from '../../public/js/motion/lib/flight.mjs';
import { feedSteps, feedDuration, printSchedule } from '../../public/js/motion/lib/dymo.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');
const EM_DASH = String.fromCharCode(0x2014);

test('vuelo: sale del tablero, pasa por arriba y llega a su sitio', () => {
  const from = { left: 100, top: 400, width: 120, height: 72 };
  const to = { left: 800, top: 500, width: 240, height: 144 };
  const a = flightFrame(0, from, to);
  const z = flightFrame(1, from, to);
  assert.deepEqual([a.x, a.y], [rectCenter(from).x, rectCenter(from).y]);
  assert.deepEqual([z.x, z.y], [rectCenter(to).x, rectCenter(to).y]);
  assert.equal(a.scale, 0.5, 'arranca al tamaño del tablero');
  assert.equal(z.scale, 1);
  assert.ok(Math.abs(a.rotation) < 1e-9 && Math.abs(z.rotation) < 1e-9, 'sale y llega derecha');
  const mid = flightFrame(0.5, from, to);
  assert.ok(mid.y < rectCenter(from).y && mid.y < rectCenter(to).y, 'el arco pasa por encima de los dos extremos');
  assert.ok(Math.abs(mid.rotation) > 10, 'gira mientras va en la mano');
  assert.deepEqual(flightFrame(-1, from, to), a);
  assert.deepEqual(flightFrame(2, from, to), z);
});

test('rotuladora: un salto por carácter, con topes de duración', () => {
  assert.equal(feedSteps('Frenos'), 6);
  assert.equal(feedSteps('Cunas de dirección'), 18);
  assert.equal(feedSteps(''), 1);
  assert.equal(feedDuration('Eje'), 0.22, 'mínimo');
  assert.equal(feedDuration('x'.repeat(200)), 0.95, 'máximo');
  const plan = printSchedule(['Frenos', 'Motor']);
  assert.equal(plan[0].at, 0);
  assert.ok(plan[1].at > plan[0].duration, 'la segunda cinta espera el corte de la primera');
  assert.equal(plan[1].steps, 5);
});

test('/servicios: cada servicio tiene herramienta y lo que incluye sale de su texto real', () => {
  const tools = read('views/partials/servicios/tools.ejs');
  const services = require('../../data/landing-services.js');
  const detail = require('../../data/services-detail.js');
  const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  for (const { slug } of services) {
    assert.match(tools, new RegExp(`<symbol id="sv-t-${slug}"`), `falta la herramienta de ${slug}`);
    const entry = detail.find((d) => d.slug === slug);
    assert.ok(entry, `${slug} sin ficha en data/services-detail.js`);
    assert.ok(entry.includes?.length, `${slug} sin includes`);
    assert.ok([].concat(entry.details || []).length, `${slug} sin details (la ficha ampliada quedaría vacía)`);
    const words = norm([entry.title, entry.desc, ...[].concat(entry.details)].join(' '));
    for (const tag of entry.includes) {
      const stems = norm(tag).split(/\s+/).filter((w) => w.length >= 4).map((w) => w.slice(0, 5));
      assert.ok(stems.some((st) => words.includes(st)), `"${tag}" (${slug}) no aparece en el texto del servicio`);
    }
  }
});

test('ficha ampliada: una sola plantilla, agenda con ?servicio= y nombres de transición solo por JS', () => {
  const view = read('views/services/service-detail.ejs');
  assert.match(view, /agendar\?servicio=<%= encodeURIComponent\(service\.name\) %>/);
  assert.doesNotMatch(view, /images\/services\//, 'sin fotos de banco');
  assert.doesNotMatch(view.replace(/<%#[\s\S]*?%>/g, ''), /<main/, 'head.ejs ya abre <main>');
  for (const v of ['lavado-motos', 'lavado-cascos', 'detailing-motos']) {
    assert.throws(() => read(`views/services/${v}.ejs`), `${v} debe usar la ficha común`);
  }
  // Once fichas con el mismo view-transition-name anulan la transición: los
  // nombres los pone vt.js en la ficha implicada, nunca el CSS.
  const css = read('public/css/servicios.css');
  assert.doesNotMatch(css, /view-transition-name/);
  const vt = read('public/js/servicios/vt.js');
  for (const n of ['sv-card', 'sv-board', 'sv-tool', 'sv-title', 'sv-tool-back']) {
    assert.ok(vt.includes(`'${n}'`), `vt.js no nombra ${n}`);
    assert.match(css, new RegExp(`::view-transition-group\\(${n}\\)`), `servicios.css no anima ${n}`);
  }
  for (const f of ['views/services/service-detail.ejs', 'views/partials/servicios/board.ejs', 'public/js/servicios/vt.js', 'public/js/servicios/detail.mjs']) {
    assert.ok(!read(f).includes(EM_DASH), `${f} tiene una raya`);
  }
});

test('/servicios: sin fotos de banco ni marcas de agua, sin rayas en el texto', () => {
  const view = read('views/services.ejs');
  assert.doesNotMatch(view, /images\/services\//, 'la vista no usa las fotos de banco');
  const home = require('../../data/landing-services.js');
  assert.notEqual(home.find((s) => s.slug === 'mecanica').img, '/images/landing/servicios/mecanica.webp', 'la home no usa la foto con marca de agua');
  const visible = view.replace(/<%[#\-=]?[\s\S]*?%>/g, '');
  assert.ok(!visible.includes(EM_DASH), 'services.ejs tiene una raya');
  assert.ok(!read('views/partials/servicios/tools.ejs').replace(/<%#[\s\S]*?%>/g, '').includes(EM_DASH));
});

test('/servicios/agendar preselecciona el servicio que llega por ?servicio=', () => {
  const view = read('views/services_schedule.ejs');
  assert.match(view, /preselect === s\) \? ' selected'/);
  const src = read('routes/services.js');
  const names = require('../../data/landing-services.js').map((s) => s.name);
  const list = src.match(/const SERVICES = \[([^\]]+)\]/)[1];
  for (const n of names) assert.ok(list.includes(`'${n}'`), `"${n}" no es una opción del selector de agendar`);
});
