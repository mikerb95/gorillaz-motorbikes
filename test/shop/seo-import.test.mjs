// SEO de la tienda (títulos, JSON-LD), slugs, CSV e importación del catálogo.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
// Los helpers importan db.js de forma indirecta: BD en memoria, nunca la real.
process.env.TURSO_URL = 'file::memory:';
const { slugify, uniqueSlug } = require('../../helpers/shop/slug.js');
const { parseCSV, parseCSVObjects, toCSV } = require('../../helpers/csv.js');
const { rowsToProducts, productsToRows } = require('../../helpers/shop/import.js');
const { catalog } = require('../../helpers/catalog.js');
const shopSeo = require('../../helpers/shop/seo.js');
const { renderMarkdown } = require('../../helpers/guides.js');

const RAYA = String.fromCharCode(0x2014);

test('slugs descriptivos sin tildes y sin colisión con rutas reservadas', () => {
  assert.equal(slugify('Defensa Lateral para Yamaha MT-03 (2020+)'), 'defensa-lateral-para-yamaha-mt-03-2020');
  assert.equal(slugify('Ñandú & Cía'), 'nandu-y-cia');
  assert.equal(uniqueSlug('moto', new Set()), 'moto-2');
  assert.equal(uniqueSlug('casco', new Set(['casco'])), 'casco-2');
});

test('CSV: separador punto y coma, comillas y saltos de línea dentro de campos', () => {
  const rows = parseCSV('a;b\n"x;1";"línea 1\nlínea 2"\n"comilla ""doble""";z\n');
  assert.deepEqual(rows, [['a', 'b'], ['x;1', 'línea 1\nlínea 2'], ['comilla "doble"', 'z']]);
  const back = parseCSV(toCSV(rows));
  assert.deepEqual(back, rows);
});

function seedCatalog() {
  catalog.categories = [{ slug: 'cascos', name: 'Cascos' }, { slug: 'iluminacion', name: 'Iluminación y farolas' }];
  catalog.bikeModels = [{ id: 'm1', slug: 'yamaha-mt-03', brand: 'Yamaha', model: 'MT-03', cc: 321, yearFrom: 2016, yearTo: null }];
}

test('importación: variantes agrupadas, compatibilidad por slug y errores por línea', () => {
  seedCatalog();
  const csv = [
    'slug;nombre;categoria;precio;stock;estado;compatibilidad;variante_color;variante_talla;variante_stock',
    ';Farola LED;iluminacion;150.000;4;publicado;yamaha-mt-03:2018-2023;;;',
    'casco-x;Casco X;cascos;300000;;borrador;;Negro;M;2',
    'casco-x;Casco X;cascos;300000;;borrador;;Negro;L;1',
    ';Sin categoría;inexistente;1000;;;;;;',
    ';Precio malo;cascos;abc;;;;;;',
  ].join('\n');
  const { items, errors } = rowsToProducts(parseCSVObjects(csv), { categories: catalog.categories, bikeModels: catalog.bikeModels, existing: [] });
  assert.equal(items.length, 2);
  const farola = items.find((i) => i.product.slug === 'farola-led').product;
  assert.equal(farola.price, 150000);
  assert.equal(farola.ownStock, 4);
  assert.equal(farola.status, 'active');
  assert.deepEqual(farola.compat, [{ bikeModelId: 'm1', yearFrom: 2018, yearTo: 2023 }]);
  const casco = items.find((i) => i.product.slug === 'casco-x').product;
  assert.equal(casco.variants.length, 2);
  assert.equal(casco.ownStock, null); // con variantes, el stock va por variante
  assert.equal(errors.length, 2);
  assert.match(errors.join(' '), /Línea 5.*categoría/);
  assert.match(errors.join(' '), /Línea 6.*precio/);
});

test('exportar e importar conserva el producto', () => {
  seedCatalog();
  const p = { slug: 'farola-led', name: 'Farola LED', brand: 'Marca', sku: 'F1', category: 'iluminacion', price: 150000, discount: 5, clubDiscount: 0, ownStock: 3, status: 'active', description: 'Luz; blanca', tags: ['led'], bikeTypes: ['naked'], images: [{ url: 'https://x/y.webp' }], compat: [{ bikeModelId: 'm1', yearFrom: 2018, yearTo: null }], installable: true, installPrice: 25000, includes: 'Farola\nTornillos', variants: [] };
  const csv = toCSV(productsToRows([p], catalog.bikeModels));
  const { items, errors } = rowsToProducts(parseCSVObjects(csv), { categories: catalog.categories, bikeModels: catalog.bikeModels, existing: [] });
  assert.deepEqual(errors, []);
  const q = items[0].product;
  for (const k of ['slug', 'name', 'brand', 'sku', 'category', 'price', 'discount', 'ownStock', 'status', 'description', 'installable', 'installPrice', 'includes']) assert.deepEqual(q[k], p[k], k);
  assert.deepEqual(q.compat, p.compat);
});

test('title de ficha: "{Producto} para {moto} | Marca" solo si es específico', () => {
  seedCatalog();
  const base = { name: 'Defensa lateral', slug: 'defensa', url: '/tienda/defensa', price: 100000, discount: 0, compat: [{ bikeModelId: 'm1' }], gallery: [], variants: [] };
  assert.equal(shopSeo.productTitle(base), 'Defensa lateral para Yamaha MT-03 | Gorillaz Motorbikes');
  assert.equal(shopSeo.productTitle({ ...base, name: 'Defensa MT-03' }), 'Defensa MT-03 | Gorillaz Motorbikes');
  assert.equal(shopSeo.productTitle({ ...base, compat: [] }), 'Defensa lateral | Gorillaz Motorbikes');
  assert.ok(!shopSeo.productTitle(base).includes(RAYA));
});

test('JSON-LD de producto: Offer en COP, disponibilidad, sin marca inventada ni rating falso', () => {
  seedCatalog();
  const p = { id: 'p1', name: 'Casco', slug: 'casco', url: '/tienda/casco', price: 300000, discount: 10, stock: 0, sku: 'C1', brand: '', category: 'cascos', gallery: ['/images/c.webp'], variants: [], compat: [] };
  const ld = shopSeo.productJsonLd(p);
  assert.equal(ld.offers['@type'], 'Offer');
  assert.equal(ld.offers.price, 270000);
  assert.equal(ld.offers.priceCurrency, 'COP');
  assert.equal(ld.offers.availability, 'https://schema.org/OutOfStock');
  assert.equal(ld.brand, undefined);
  assert.equal(ld.aggregateRating, undefined);
  assert.match(ld.image[0], /^https:\/\//);
  const withReviews = shopSeo.productJsonLd({ ...p, brand: 'Marca' }, { reviews: { count: 2, average: 4.5, items: [] } });
  assert.equal(withReviews.brand.name, 'Marca');
  assert.equal(withReviews.aggregateRating.reviewCount, 2);
  const variants = shopSeo.productJsonLd({ ...p, stock: 3, variants: [{ id: 'v1', color: 'Negro', price: 300000, stock: 1 }, { id: 'v2', color: 'Rojo', price: 350000, stock: 2 }] });
  assert.equal(variants.offers['@type'], 'AggregateOffer');
  assert.equal(variants.offers.lowPrice, 270000);
  assert.equal(variants.offers.highPrice, 315000);
});

test('Markdown de guías escapa HTML y solo permite enlaces seguros', () => {
  const html = renderMarkdown('## Hola <b>\n\nTexto con [enlace](/tienda) y [malo](javascript:alert(1)) **fuerte**\n\n- uno\n- dos');
  assert.ok(html.includes('<h2>Hola &lt;b&gt;</h2>'));
  assert.ok(html.includes('<a href="/tienda">enlace</a>'));
  assert.ok(!html.includes('javascript:'.replace(':', ':"')) && !html.includes('href="javascript'));
  assert.ok(html.includes('<ul><li>uno</li><li>dos</li></ul>'));
});
