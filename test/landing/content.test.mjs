// Consistencia entre el contenido de la landing, sus datos y el resto del sitio.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { cameraBox } from '../../public/js/motion/lib/camera.mjs';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const services = require('../../data/landing-services.js');
const bike = JSON.parse(read('data/bike-systems.json'));
const home = read('views/home.ejs');
const art = read('views/partials/landing/bike-art.ejs');
const css = read('public/css/landing.css');
// La raya (em dash) se arma con su código para no escribirla en el archivo.
const EM_DASH = String.fromCharCode(0x2014);

test('cada servicio de la landing tiene su sistema en la moto', () => {
  assert.equal(services.length, 11);
  for (const s of services) {
    const sys = bike.systems[s.slug];
    assert.ok(sys, `falta el sistema de ${s.slug}`);
    assert.match(css, new RegExp(`@property --on-${sys.system}\\b`), `sin @property para ${sys.system}`);
  }
  assert.deepEqual(Object.keys(bike.systems).sort(), services.map((s) => s.slug).sort(), 'sobran o faltan sistemas');
});

test('encuadres de las lupas: 16:10 y dentro del dibujo', () => {
  const [ax, ay, aw, ah] = bike.art;
  for (const [slug, { focus, lamp }] of Object.entries(bike.systems)) {
    const [x, y, w, h] = focus;
    assert.ok(Math.abs(w / h - 1.6) < 0.02, `${slug}: proporción ${w / h}`);
    assert.ok(x >= ax - 1 && y >= ay - 60 && x + w <= ax + aw + 1 && y + h <= ay + ah + 40, `${slug}: fuera del arte`);
    assert.equal(lamp.length, 3);
  }
});

test('las fotos de servicios existen', () => {
  for (const s of services) assert.ok(readFileSync(path.join(root, s.img.slice(1))).length > 1000, s.img);
});

test('las etapas de la ficha de ejemplo existen en /mi-orden', () => {
  const miOrden = read('views/mi-orden.ejs');
  const stages = [...home.matchAll(/<li data-status="([a-z_]+)"><span class="lp-stamp" data-m>([^<]+)<\/span>/g)];
  assert.equal(stages.length, 4);
  for (const [, key, label] of stages) {
    assert.match(miOrden, new RegExp(`${key}: '${label}'`), `"${label}" (${key}) no es un estado de /mi-orden`);
  }
});

test('la ficha y el recordatorio están marcados como ejemplo ilustrativo', () => {
  const start = home.indexOf('class="lp-ticket"');
  assert.match(home.slice(start, home.indexOf('</figure>', start)), /Ejemplo ilustrativo/);
  const r = home.indexOf('class="lp-reminder"');
  assert.match(home.slice(r, r + 400), /Ejemplo ilustrativo/);
});

test('el número de servicios del texto sale de la lista, no está escrito a mano', () => {
  assert.match(home, /<%= landingServices\.length %> servicios/);
  assert.doesNotMatch(home, /\b(8|11) servicios especializados/);
});

test('la landing no usa rayas (em dash) en el texto visible', () => {
  const visible = home.replace(/<script type="application\/ld\+json">[\s\S]*?<\/script>/, '').replace(/<%[#\-=]?[\s\S]*?%>/g, '');
  assert.ok(!visible.includes(EM_DASH), 'home.ejs tiene una raya en texto visible');
  assert.ok(!art.replace(/<%#[\s\S]*?%>/g, '').includes(EM_DASH), 'bike-art.ejs tiene una raya');
});

test('cámara: mantiene proporción, no sale del dibujo y no se acerca de más', () => {
  const ART = [0, 0, 1200, 700];
  const aspect = 1200 / 700;
  for (const [slug, { focus }] of Object.entries(bike.systems)) {
    const [x, y, w, h] = cameraBox(focus, ART, aspect);
    assert.ok(Math.abs(w / h - aspect) < 0.01, `${slug}: proporción`);
    assert.ok(x >= 0 && y >= 0 && x + w <= 1200.01 && y + h <= 700.01, `${slug}: fuera del dibujo ${[x, y, w, h]}`);
    assert.ok(w >= 540, `${slug}: demasiado cerca`);
  }
  // El centro de una parte pequeña (la manzana delantera) queda dentro del encuadre.
  const [x, y, w, h] = cameraBox([785, 407, 240, 150], ART, aspect);
  assert.ok(x <= 905 && x + w >= 905 && y <= 482 && y + h >= 482);
});
