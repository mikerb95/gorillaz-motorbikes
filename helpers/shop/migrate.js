'use strict';
// Migración v17: el catálogo pasa del blob app_settings('catalog') a tablas.
//
// Es solo aditiva e idempotente:
//   - las categorías se siembran si la tabla está vacía;
//   - los productos se importan una única vez, si la tabla está vacía;
//   - el blob original se copia a app_settings('catalog_backup_v16') y no se
//     borra ni se modifica.
// Los productos del seed de desarrollo (data/catalog.js) se marcan is_demo=1:
// en producción no se publican (ver helpers/catalog.js → isPublic).

const { v4: uuidv4 } = require('uuid');
const seed = require('../../data/catalog');
const { DEFAULT_CATEGORIES, BIKE_TYPE_SLUGS, DEMO_CATEGORY_MAP } = require('./taxonomy');
const { uniqueSlug } = require('./slug');

const PLACEHOLDER_IMAGE = '/images/download.png';
const SEED_IDS = new Set((seed.products || []).map((p) => p.id));

function int(v) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

// Convierte un producto del formato blob a las filas de las tablas nuevas.
function blobProductToRows(p, { categorySlugs, takenSlugs }) {
  const legacyCat = String(p.category || '');
  let category = '';
  const bikeTypes = [];
  if (DEMO_CATEGORY_MAP[p.id]) category = DEMO_CATEGORY_MAP[p.id];
  else if (categorySlugs.has(legacyCat)) category = legacyCat;
  if (BIKE_TYPE_SLUGS.has(legacyCat)) bikeTypes.push(legacyCat);

  const slug = uniqueSlug(p.name || p.id, takenSlugs);
  takenSlugs.add(slug);

  const id = String(p.id || uuidv4());
  const images = [...new Set([...(p.gallery || []), p.image].filter(Boolean))]
    .filter((url) => url !== PLACEHOLDER_IMAGE);

  return {
    product: {
      id,
      slug,
      legacy_id: p.id ? String(p.id) : null,
      name: String(p.name || 'Producto'),
      brand: String(p.brand || ''),
      sku: String(p.sku || ''),
      category,
      bike_types: JSON.stringify(bikeTypes),
      tags: JSON.stringify(Array.isArray(p.tags) ? p.tags : []),
      description: String(p.description || ''),
      price: Math.max(0, int(p.price) || 0),
      discount: Math.min(100, Math.max(0, int(p.discount) || 0)),
      stock: typeof p.stock === 'number' ? Math.max(0, Math.trunc(p.stock)) : null,
      status: 'active',
      is_demo: SEED_IDS.has(p.id) ? 1 : 0,
      created_at: p.createdAt || new Date().toISOString(),
      updated_at: p.updatedAt || new Date().toISOString(),
    },
    images: images.map((url, i) => ({ id: uuidv4(), product_id: id, url, alt: '', position: i })),
  };
}

async function migrateCatalogToTables(db) {
  const catCount = Number((await db.execute('SELECT COUNT(*) AS n FROM shop_categories')).rows[0].n);
  const prodCount = Number((await db.execute('SELECT COUNT(*) AS n FROM products')).rows[0].n);

  const blobRow = (await db.execute({ sql: 'SELECT value FROM app_settings WHERE key = ?', args: ['catalog'] })).rows[0];
  let blob = null;
  if (blobRow) { try { blob = JSON.parse(blobRow.value); } catch { blob = null; } }

  const stmts = [];

  if (catCount === 0) {
    const cats = [...DEFAULT_CATEGORIES];
    const known = new Set(cats.map((c) => c.slug));
    // Categorías creadas por el admin en el blob que no están en la taxonomía.
    for (const c of (blob && blob.categories) || []) {
      if (c && c.slug && !known.has(c.slug) && !BIKE_TYPE_SLUGS.has(c.slug)) {
        cats.push({ slug: String(c.slug), name: String(c.name || c.slug) });
        known.add(c.slug);
      }
    }
    cats.forEach((c, i) => stmts.push({
      sql: 'INSERT OR IGNORE INTO shop_categories (slug, name, position) VALUES (?,?,?)',
      args: [c.slug, c.name, i],
    }));
  }

  if (prodCount === 0) {
    let source = null;
    if (blob && Array.isArray(blob.products)) {
      source = blob.products;
      stmts.push({
        sql: 'INSERT OR IGNORE INTO app_settings (key, value) VALUES (?, ?)',
        args: ['catalog_backup_v16', blobRow.value],
      });
    } else if (process.env.NODE_ENV !== 'production') {
      source = seed.products || []; // solo seed de desarrollo
    }

    if (source && source.length) {
      const categorySlugs = new Set([
        ...DEFAULT_CATEGORIES.map((c) => c.slug),
        ...((blob && blob.categories) || []).map((c) => c && c.slug).filter(Boolean),
      ]);
      const takenSlugs = new Set();
      for (const p of source) {
        if (!p || !p.name) continue;
        const { product, images } = blobProductToRows(p, { categorySlugs, takenSlugs });
        const cols = Object.keys(product);
        stmts.push({
          sql: `INSERT OR IGNORE INTO products (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`,
          args: cols.map((c) => product[c]),
        });
        for (const img of images) {
          stmts.push({
            sql: 'INSERT OR IGNORE INTO product_images (id, product_id, url, alt, position) VALUES (?,?,?,?,?)',
            args: [img.id, img.product_id, img.url, img.alt, img.position],
          });
        }
      }
    }
  }

  if (stmts.length) await db.batch(stmts, 'write');
}

module.exports = { migrateCatalogToTables, blobProductToRows };
