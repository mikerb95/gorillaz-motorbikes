// Menú de la navbar: datos (data/nav-menu.js) y su pintado en views/partials/head.ejs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(path.join(root, p), 'utf8');

const { serviceGroups, shop } = require('../data/nav-menu.js');
const services = require('../data/landing-services.js');
const head = read('views/partials/head.ejs');
const mainJs = read('public/js/main.js');
const product = read('views/shop-product.ejs');
// La raya (em dash) se arma con su código para no escribirla en el archivo.
const EM_DASH = String.fromCharCode(0x2014);

test('el menú cubre todos los servicios de la landing, sin repetir', () => {
  const slugs = serviceGroups.flatMap((g) => g.items).map((i) => i.slug).filter(Boolean);
  assert.equal(new Set(slugs).size, slugs.length, 'hay slugs repetidos');
  assert.deepEqual([...slugs].sort(), services.map((s) => s.slug).sort(), 'sobran o faltan servicios');
});

test('cada ítem tiene destino, nombre, ícono del sprite y descripción corta', () => {
  const items = serviceGroups.flatMap((g) => g.items);
  for (const it of items) {
    assert.match(it.href, /^\//, `${it.label}: href relativo al sitio`);
    assert.ok(it.label && it.label !== it.slug, `${it.href}: sin nombre real`);
    assert.ok(it.desc && it.desc.length <= 28, `${it.label}: descripción larga o vacía`);
    assert.match(head, new RegExp(`<symbol id="ni-${it.icon}"`), `falta el símbolo ni-${it.icon}`);
  }
  for (const l of [...shop.categories, ...shop.quick]) assert.match(l.href, /^\/tienda/);
});

test('el badge del carrito y el de eventos tienen marcador propio', () => {
  assert.match(head, /data-count="cart"/);
  assert.match(head, /data-count="events"/);
  for (const [name, src] of [['main.js', mainJs], ['shop-product.ejs', product]]) {
    assert.doesNotMatch(src, /querySelectorAll\('\.cart-badge'\)/, `${name} sigue escribiendo en todos los .cart-badge`);
  }
});

test('la navbar no usa raya (em dash) en sus textos', () => {
  const nav = head.slice(head.indexOf('<header class="site-header">'), head.indexOf('</header>'));
  assert.ok(nav.length > 0);
  assert.ok(!nav.includes(EM_DASH), 'la navbar tiene em dash');
  const data = read('data/nav-menu.js');
  assert.ok(!data.includes(EM_DASH), 'nav-menu.js tiene em dash');
});

test('styles.css y main.js se piden con versión (caché immutable)', () => {
  assert.match(head, /styles\.css\?v=<%=/);
  assert.match(head, /main\.js\?v=<%=/);
});

test('el sprite de íconos va después de la etiqueta <body> completa, no dentro', () => {
  const bodyTag = head.match(/<body[^\n]*\n/)[0];
  assert.match(bodyTag, /<% } %>>\n$/, 'la etiqueta <body> quedó partida');
  assert.ok(head.indexOf('class="ni-sprite"') > head.indexOf(bodyTag) + bodyTag.length - 1);
});
