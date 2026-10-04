'use strict';
// Acceso a datos del catálogo (tablas v17). Las lecturas públicas pasan por la
// caché en memoria de helpers/catalog.js; aquí viven las consultas y escrituras.

const { v4: uuidv4 } = require('uuid');
const { db } = require('../../db');

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}
const numOrNull = (v) => (v === null || v === undefined ? null : Number(v));
const affected = (r) => (r.rowsAffected ?? r.changes ?? 0);

function rowToProduct(r) {
  return {
    id: r.id,
    slug: r.slug,
    legacyId: r.legacy_id || null,
    name: r.name,
    brand: r.brand || '',
    sku: r.sku || '',
    category: r.category || '',
    bikeTypes: safeJson(r.bike_types, []),
    tags: safeJson(r.tags, []),
    description: r.description || '',
    specs: safeJson(r.specs, []),
    includes: r.includes || '',
    warranty: r.warranty || '',
    deliveryTime: r.delivery_time || '',
    price: Number(r.price) || 0,
    discount: Number(r.discount) || 0,
    clubDiscount: Number(r.club_discount) || 0,
    ownStock: numOrNull(r.stock),
    featured: Number(r.featured) === 1,
    installable: Number(r.installable) === 1,
    installPrice: numOrNull(r.install_price),
    installMinutes: numOrNull(r.install_minutes),
    relatedServices: safeJson(r.related_services, []),
    seoTitle: r.seo_title || '',
    seoDescription: r.seo_description || '',
    status: r.status || 'draft',
    isDemo: Number(r.is_demo) === 1,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

function rowToVariant(r) {
  return {
    id: r.id, productId: r.product_id, sku: r.sku || '', color: r.color || '', size: r.size || '',
    price: numOrNull(r.price), stock: numOrNull(r.stock), position: Number(r.position) || 0,
  };
}

function rowToBikeModel(r) {
  return {
    id: r.id, slug: r.slug, brand: r.brand, model: r.model, cc: numOrNull(r.cc), bikeType: r.bike_type || '',
    yearFrom: numOrNull(r.year_from), yearTo: numOrNull(r.year_to), intro: r.intro || '',
    seoTitle: r.seo_title || '', seoDescription: r.seo_description || '',
  };
}

function rowToCombo(r) {
  return {
    id: r.id, slug: r.slug, name: r.name, kind: r.kind === 'kit' ? 'kit' : 'armable',
    description: r.description || '', tiers: safeJson(r.tiers, []), kitDiscount: Number(r.kit_discount) || 0,
    bikeModelId: r.bike_model_id || null, active: Number(r.active) === 1, items: [],
  };
}

// Una sola ida a la BD para todo el catálogo (cabe en memoria de sobra).
async function loadAll() {
  const [cats, prods, vars, imgs, models, compat, combos, comboItems] = await db.batch([
    'SELECT * FROM shop_categories ORDER BY position, name',
    'SELECT * FROM products ORDER BY created_at DESC',
    'SELECT * FROM product_variants ORDER BY position',
    'SELECT * FROM product_images ORDER BY position',
    'SELECT * FROM bike_models ORDER BY brand, model',
    'SELECT * FROM product_compat',
    'SELECT * FROM combos ORDER BY created_at',
    'SELECT * FROM combo_items',
  ], 'read');

  const products = prods.rows.map(rowToProduct);
  const byId = new Map(products.map((p) => [p.id, p]));
  for (const p of products) { p.variants = []; p.images = []; p.compat = []; }
  for (const v of vars.rows) byId.get(v.product_id)?.variants.push(rowToVariant(v));
  for (const i of imgs.rows) byId.get(i.product_id)?.images.push({ id: i.id, url: i.url, alt: i.alt || '' });
  for (const c of compat.rows) {
    byId.get(c.product_id)?.compat.push({ bikeModelId: c.bike_model_id, yearFrom: numOrNull(c.year_from), yearTo: numOrNull(c.year_to) });
  }

  const comboList = combos.rows.map(rowToCombo);
  const comboById = new Map(comboList.map((c) => [c.id, c]));
  for (const ci of comboItems.rows) comboById.get(ci.combo_id)?.items.push({ productId: ci.product_id, qty: Number(ci.qty) || 1 });

  return {
    categories: cats.rows.map((c) => ({
      slug: c.slug, name: c.name, position: Number(c.position) || 0, intro: c.intro || '',
      seoTitle: c.seo_title || '', seoDescription: c.seo_description || '',
    })),
    products,
    bikeModels: models.rows.map(rowToBikeModel),
    combos: comboList,
  };
}

// ── Productos ────────────────────────────────────────────────────────────

async function slugTaken(table, slug, exceptId) {
  const r = await db.execute({ sql: `SELECT id FROM ${table} WHERE slug = ? AND id != ?`, args: [slug, exceptId || ''] });
  return r.rows.length > 0;
}

// Crea o actualiza un producto con sus variantes, imágenes y compatibilidades
// en una sola transacción. Si el slug cambia, registra un 301 del anterior.
async function saveProduct(p) {
  const id = p.id || uuidv4();
  const prev = (await db.execute({ sql: 'SELECT slug FROM products WHERE id = ?', args: [id] })).rows[0];
  const now = new Date().toISOString();
  const row = {
    id, slug: p.slug, legacy_id: p.legacyId || null, name: p.name, brand: p.brand || '', sku: p.sku || '',
    category: p.category || '', bike_types: JSON.stringify(p.bikeTypes || []), tags: JSON.stringify(p.tags || []),
    description: p.description || '', specs: JSON.stringify(p.specs || []), includes: p.includes || '',
    warranty: p.warranty || '', delivery_time: p.deliveryTime || '', price: p.price || 0, discount: p.discount || 0,
    club_discount: p.clubDiscount || 0, stock: p.ownStock ?? null, featured: p.featured ? 1 : 0,
    installable: p.installable ? 1 : 0, install_price: p.installPrice ?? null, install_minutes: p.installMinutes ?? null,
    related_services: JSON.stringify(p.relatedServices || []), seo_title: p.seoTitle || '', seo_description: p.seoDescription || '',
    status: p.status || 'draft', is_demo: p.isDemo ? 1 : 0, updated_at: now,
  };
  const cols = Object.keys(row);
  const stmts = [{
    sql: `INSERT INTO products (${cols.join(',')}, created_at) VALUES (${cols.map(() => '?').join(',')}, ?)
          ON CONFLICT(id) DO UPDATE SET ${cols.filter((c) => c !== 'id').map((c) => `${c} = excluded.${c}`).join(', ')}`,
    args: [...cols.map((c) => row[c]), now],
  }];
  stmts.push({ sql: 'DELETE FROM product_variants WHERE product_id = ?', args: [id] });
  (p.variants || []).forEach((v, i) => stmts.push({
    sql: 'INSERT INTO product_variants (id, product_id, sku, color, size, price, stock, position) VALUES (?,?,?,?,?,?,?,?)',
    args: [v.id || uuidv4(), id, v.sku || '', v.color || '', v.size || '', v.price ?? null, v.stock ?? null, i],
  }));
  stmts.push({ sql: 'DELETE FROM product_images WHERE product_id = ?', args: [id] });
  (p.images || []).forEach((img, i) => stmts.push({
    sql: 'INSERT INTO product_images (id, product_id, url, alt, position) VALUES (?,?,?,?,?)',
    args: [img.id || uuidv4(), id, img.url, img.alt || '', i],
  }));
  stmts.push({ sql: 'DELETE FROM product_compat WHERE product_id = ?', args: [id] });
  for (const c of p.compat || []) {
    stmts.push({
      sql: 'INSERT OR IGNORE INTO product_compat (product_id, bike_model_id, year_from, year_to) VALUES (?,?,?,?)',
      args: [id, c.bikeModelId, c.yearFrom ?? null, c.yearTo ?? null],
    });
  }
  if (prev && prev.slug && prev.slug !== p.slug) {
    stmts.push({
      sql: `INSERT INTO url_redirects (from_path, to_path) VALUES (?, ?)
            ON CONFLICT(from_path) DO UPDATE SET to_path = excluded.to_path`,
      args: [`/tienda/${prev.slug}`, `/tienda/${p.slug}`],
    });
    // Los 301 que apuntaban al slug viejo pasan a apuntar al nuevo (sin cadenas).
    stmts.push({ sql: 'UPDATE url_redirects SET to_path = ? WHERE to_path = ?', args: [`/tienda/${p.slug}`, `/tienda/${prev.slug}`] });
    stmts.push({ sql: 'DELETE FROM url_redirects WHERE from_path = ?', args: [`/tienda/${p.slug}`] });
  }
  await db.batch(stmts, 'write');
  return id;
}

async function setProductStatus(id, status) {
  await db.execute({ sql: "UPDATE products SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?", args: [status, id] });
}

async function getRedirect(fromPath) {
  const r = await db.execute({ sql: 'SELECT to_path FROM url_redirects WHERE from_path = ?', args: [fromPath] });
  return r.rows[0] ? r.rows[0].to_path : null;
}

// ── Stock ────────────────────────────────────────────────────────────────
// lines: [{ productId, variantId|null, qty }]. Las filas con stock NULL no
// controlan inventario. La reserva es todo o nada: si una línea no alcanza, se
// revierte la transacción y se devuelve qué faltó.

async function reserveStock(lines) {
  const tx = await db.transaction('write');
  try {
    for (const l of lines) {
      const r = l.variantId
        ? await tx.execute({
          sql: 'UPDATE product_variants SET stock = stock - ? WHERE id = ? AND product_id = ? AND (stock IS NULL OR stock >= ?)',
          args: [l.qty, l.variantId, l.productId, l.qty],
        })
        : await tx.execute({
          sql: 'UPDATE products SET stock = stock - ? WHERE id = ? AND (stock IS NULL OR stock >= ?)',
          args: [l.qty, l.productId, l.qty],
        });
      if (affected(r) === 0) {
        await tx.rollback();
        return { ok: false, failed: l };
      }
    }
    await tx.commit();
    return { ok: true };
  } catch (err) {
    try { await tx.rollback(); } catch { /* ya cerrada */ }
    throw err;
  }
}

async function releaseStock(lines) {
  const stmts = lines.map((l) => (l.variantId
    ? { sql: 'UPDATE product_variants SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL', args: [l.qty, l.variantId] }
    : { sql: 'UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL', args: [l.qty, l.productId] }));
  if (stmts.length) await db.batch(stmts, 'write');
}

// Pedidos antiguos (sin reserva previa) que se confirman pagados: se descuenta
// sin condición, sin bajar de cero.
async function forceDecrementStock(lines) {
  const stmts = lines.map((l) => (l.variantId
    ? { sql: 'UPDATE product_variants SET stock = MAX(0, stock - ?) WHERE id = ? AND stock IS NOT NULL', args: [l.qty, l.variantId] }
    : { sql: 'UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ? AND stock IS NOT NULL', args: [l.qty, l.productId] }));
  if (stmts.length) await db.batch(stmts, 'write');
}

// ── Categorías ───────────────────────────────────────────────────────────

async function saveCategory(c) {
  await db.execute({
    sql: `INSERT INTO shop_categories (slug, name, position, intro, seo_title, seo_description) VALUES (?,?,?,?,?,?)
          ON CONFLICT(slug) DO UPDATE SET name = excluded.name, position = excluded.position, intro = excluded.intro,
            seo_title = excluded.seo_title, seo_description = excluded.seo_description`,
    args: [c.slug, c.name, c.position || 0, c.intro || '', c.seoTitle || '', c.seoDescription || ''],
  });
}

// Solo se borra una categoría sin productos (ni archivados): nunca se dejan
// productos huérfanos.
async function deleteCategory(slug) {
  const n = Number((await db.execute({ sql: 'SELECT COUNT(*) AS n FROM products WHERE category = ?', args: [slug] })).rows[0].n);
  if (n > 0) return false;
  await db.execute({ sql: 'DELETE FROM shop_categories WHERE slug = ?', args: [slug] });
  return true;
}

// ── Modelos de moto ──────────────────────────────────────────────────────

async function saveBikeModel(m) {
  const id = m.id || uuidv4();
  await db.execute({
    sql: `INSERT INTO bike_models (id, slug, brand, model, cc, bike_type, year_from, year_to, intro, seo_title, seo_description)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, brand = excluded.brand, model = excluded.model, cc = excluded.cc,
            bike_type = excluded.bike_type, year_from = excluded.year_from, year_to = excluded.year_to, intro = excluded.intro,
            seo_title = excluded.seo_title, seo_description = excluded.seo_description`,
    args: [id, m.slug, m.brand, m.model, m.cc ?? null, m.bikeType || '', m.yearFrom ?? null, m.yearTo ?? null,
      m.intro || '', m.seoTitle || '', m.seoDescription || ''],
  });
  return id;
}

async function deleteBikeModel(id) {
  await db.batch([
    { sql: 'DELETE FROM product_compat WHERE bike_model_id = ?', args: [id] },
    { sql: 'UPDATE combos SET bike_model_id = NULL WHERE bike_model_id = ?', args: [id] },
    { sql: 'DELETE FROM bike_models WHERE id = ?', args: [id] },
  ], 'write');
}

// ── Combos ───────────────────────────────────────────────────────────────

async function saveCombo(c) {
  const id = c.id || uuidv4();
  const stmts = [{
    sql: `INSERT INTO combos (id, slug, name, kind, description, tiers, kit_discount, bike_model_id, active)
          VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(id) DO UPDATE SET slug = excluded.slug, name = excluded.name, kind = excluded.kind,
            description = excluded.description, tiers = excluded.tiers, kit_discount = excluded.kit_discount,
            bike_model_id = excluded.bike_model_id, active = excluded.active`,
    args: [id, c.slug, c.name, c.kind, c.description || '', JSON.stringify(c.tiers || []), c.kitDiscount || 0,
      c.bikeModelId || null, c.active ? 1 : 0],
  }, { sql: 'DELETE FROM combo_items WHERE combo_id = ?', args: [id] }];
  for (const it of c.items || []) {
    stmts.push({ sql: 'INSERT OR IGNORE INTO combo_items (combo_id, product_id, qty) VALUES (?,?,?)', args: [id, it.productId, it.qty || 1] });
  }
  await db.batch(stmts, 'write');
  return id;
}

async function deleteCombo(id) {
  await db.batch([
    { sql: 'DELETE FROM combo_items WHERE combo_id = ?', args: [id] },
    { sql: 'DELETE FROM combos WHERE id = ?', args: [id] },
  ], 'write');
}

// "Comprados juntos": productos que aparecen en los mismos pedidos pagados.
async function boughtTogetherCounts(limitOrders = 500) {
  const r = await db.execute({
    sql: "SELECT items FROM orders WHERE status = 'paid' ORDER BY created_at DESC LIMIT ?",
    args: [limitOrders],
  });
  const pairs = new Map();
  for (const row of r.rows) {
    const ids = [...new Set(safeJson(row.items, []).map((i) => i.productId || i.id).filter(Boolean))];
    for (const a of ids) {
      for (const b of ids) {
        if (a === b) continue;
        const m = pairs.get(a) || new Map();
        m.set(b, (m.get(b) || 0) + 1);
        pairs.set(a, m);
      }
    }
  }
  return pairs;
}

module.exports = {
  loadAll, slugTaken, saveProduct, setProductStatus, getRedirect,
  reserveStock, releaseStock, forceDecrementStock,
  saveCategory, deleteCategory, saveBikeModel, deleteBikeModel, saveCombo, deleteCombo,
  boughtTogetherCounts,
};
