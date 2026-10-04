'use strict';
// Importación y exportación del catálogo por CSV.
//
// Columnas (encabezados sin tildes, en cualquier orden):
//   slug, nombre, marca, sku, categoria, precio, descuento, descuento_club,
//   stock, estado, descripcion, etiquetas, tipos_moto, imagenes, compatibilidad,
//   instalable, precio_instalacion, minutos_instalacion, garantia,
//   tiempo_entrega, incluye, destacado,
//   variante_color, variante_talla, variante_sku, variante_precio, variante_stock
//
// Listas separadas por "|". Compatibilidad: "slug-modelo" o
// "slug-modelo:2019-2023". Varias filas con el mismo slug (o nombre) son
// variantes del mismo producto: la primera fila define el producto.

const { slugify } = require('./slug');
const { BIKE_TYPE_SLUGS } = require('./taxonomy');

const list = (v) => String(v || '').split('|').map((s) => s.trim()).filter(Boolean);
const intOrNull = (v) => {
  const s = String(v ?? '').replace(/[$\s.]/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Math.round(Number(s));
  return Number.isFinite(n) ? n : NaN;
};
const yes = (v) => /^(1|si|sí|true|x|yes)$/i.test(String(v || '').trim());

function parseCompat(v, modelsBySlug, errors, line) {
  const out = [];
  for (const item of list(v)) {
    const [slug, years] = item.split(':');
    const m = modelsBySlug.get(slug.trim());
    if (!m) { errors.push(`Línea ${line}: el modelo "${slug}" no existe (créalo en Modelos de moto).`); continue; }
    let yearFrom = null; let yearTo = null;
    if (years) {
      const [a, b] = years.split('-').map((x) => intOrNull(x));
      yearFrom = Number.isFinite(a) ? a : null;
      yearTo = Number.isFinite(b) ? b : null;
    }
    out.push({ bikeModelId: m.id, yearFrom, yearTo });
  }
  return out;
}

/**
 * Convierte filas CSV en productos listos para guardar.
 * @returns {{ items: Array<{action, product, line}>, errors: string[] }}
 */
function rowsToProducts(rows, { categories, bikeModels, existing }) {
  const errors = [];
  const catSlugs = new Set(categories.map((c) => c.slug));
  const modelsBySlug = new Map(bikeModels.map((m) => [m.slug, m]));
  const bySlug = new Map(existing.map((p) => [p.slug, p]));
  const bySku = new Map(existing.filter((p) => p.sku).map((p) => [p.sku, p]));
  const groups = new Map();

  for (const r of rows) {
    const name = r.nombre || r.name || '';
    const key = slugify(r.slug || name);
    if (!key) { errors.push(`Línea ${r.__line}: falta el nombre del producto.`); continue; }
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }

  const items = [];
  for (const [slug, groupRows] of groups) {
    const r = groupRows[0];
    const line = r.__line;
    const before = errors.length;
    const name = r.nombre || r.name;
    if (!name) errors.push(`Línea ${line}: falta el nombre.`);
    const price = intOrNull(r.precio);
    if (price === null || Number.isNaN(price) || price < 0) errors.push(`Línea ${line}: precio inválido.`);
    const category = slugify(r.categoria || '');
    if (!catSlugs.has(category)) errors.push(`Línea ${line}: la categoría "${r.categoria}" no existe.`);
    const stock = intOrNull(r.stock);
    if (Number.isNaN(stock)) errors.push(`Línea ${line}: stock inválido.`);
    const discount = intOrNull(r.descuento) || 0;
    const clubDiscount = intOrNull(r.descuento_club) || 0;
    const installPrice = intOrNull(r.precio_instalacion);
    const bikeTypes = list(r.tipos_moto).map(slugify).filter((t) => {
      if (!BIKE_TYPE_SLUGS.has(t)) { errors.push(`Línea ${line}: tipo de moto "${t}" desconocido.`); return false; }
      return true;
    });
    const compat = parseCompat(r.compatibilidad, modelsBySlug, errors, line);
    const status = ['active', 'draft', 'archived'].includes(r.estado) ? r.estado
      : (/^(publicado|activo)$/i.test(r.estado || '') ? 'active' : 'draft');

    const variants = groupRows
      .filter((v) => v.variante_color || v.variante_talla)
      .map((v) => {
        const vp = intOrNull(v.variante_precio);
        const vs = intOrNull(v.variante_stock);
        if (Number.isNaN(vp) || Number.isNaN(vs)) errors.push(`Línea ${v.__line}: precio o stock de variante inválido.`);
        return { color: v.variante_color || '', size: v.variante_talla || '', sku: v.variante_sku || '', price: Number.isNaN(vp) ? null : vp, stock: Number.isNaN(vs) ? null : vs };
      });

    if (errors.length > before) continue;

    const prev = bySlug.get(slug) || (r.sku ? bySku.get(r.sku) : null);
    items.push({
      line,
      action: prev ? 'actualizar' : 'crear',
      product: {
        ...(prev || {}),
        id: prev ? prev.id : undefined,
        slug: prev ? prev.slug : slug,
        name,
        brand: r.marca || '',
        sku: r.sku || '',
        category,
        price,
        discount: Math.min(100, Math.max(0, discount)),
        clubDiscount: Math.min(100, Math.max(0, clubDiscount)),
        ownStock: variants.length ? null : stock,
        status,
        description: r.descripcion || '',
        tags: list(r.etiquetas),
        bikeTypes,
        images: list(r.imagenes).length ? list(r.imagenes).map((url) => ({ url, alt: name })) : (prev ? prev.images : []),
        compat: r.compatibilidad !== undefined ? compat : (prev ? prev.compat : []),
        installable: yes(r.instalable),
        installPrice: Number.isNaN(installPrice) ? null : installPrice,
        installMinutes: intOrNull(r.minutos_instalacion) || null,
        warranty: r.garantia || '',
        deliveryTime: r.tiempo_entrega || '',
        includes: list(r.incluye).join('\n'),
        featured: yes(r.destacado),
        variants: variants.length ? variants : (prev ? prev.variants : []),
        isDemo: false,
      },
    });
  }
  return { items, errors };
}

const EXPORT_HEADERS = ['slug', 'nombre', 'marca', 'sku', 'categoria', 'precio', 'descuento', 'descuento_club', 'stock', 'estado',
  'descripcion', 'etiquetas', 'tipos_moto', 'imagenes', 'compatibilidad', 'instalable', 'precio_instalacion', 'minutos_instalacion',
  'garantia', 'tiempo_entrega', 'incluye', 'destacado', 'variante_color', 'variante_talla', 'variante_sku', 'variante_precio', 'variante_stock'];

function productsToRows(products, bikeModels) {
  const modelById = new Map(bikeModels.map((m) => [m.id, m]));
  const rows = [EXPORT_HEADERS];
  for (const p of products) {
    const compat = (p.compat || []).map((c) => {
      const m = modelById.get(c.bikeModelId);
      if (!m) return null;
      return c.yearFrom || c.yearTo ? `${m.slug}:${c.yearFrom || ''}-${c.yearTo || ''}` : m.slug;
    }).filter(Boolean).join('|');
    const base = [p.slug, p.name, p.brand, p.sku, p.category, p.price, p.discount, p.clubDiscount, p.ownStock ?? '', p.status,
      p.description, (p.tags || []).join('|'), (p.bikeTypes || []).join('|'), (p.images || []).map((i) => i.url).join('|'), compat,
      p.installable ? 'si' : '', p.installPrice ?? '', p.installMinutes ?? '', p.warranty, p.deliveryTime,
      String(p.includes || '').split('\n').filter(Boolean).join('|'), p.featured ? 'si' : ''];
    if (p.variants && p.variants.length) {
      for (const v of p.variants) rows.push([...base, v.color, v.size, v.sku, v.price ?? '', v.stock ?? '']);
    } else rows.push([...base, '', '', '', '', '']);
  }
  return rows;
}

module.exports = { rowsToProducts, productsToRows, EXPORT_HEADERS };
