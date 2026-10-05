'use strict';
// Feeds de productos para catálogos de compras de buscadores y redes sociales.
//   /feeds/productos.xml  RSS 2.0 con el espacio de nombres estándar de feeds de compras
//   /feeds/productos.csv  mismo contenido en CSV (formato de columnas de catálogo)
// Solo productos publicados y con foto propia (las plataformas rechazan ítems sin imagen).

const express = require('express');
const { refreshIfStale, publicProducts, categoryBySlug } = require('../helpers/catalog');
const { unitPrice, variantLabel } = require('../helpers/shop/pricing');
const { abs, clip } = require('../helpers/seo');
const { toCSV } = require('../helpers/csv');

const router = express.Router();

const xml = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const money = (n) => `${Math.round(n)} COP`;

// Un ítem por producto, o uno por variante agrupados con item_group_id.
function feedItems() {
  const items = [];
  for (const p of publicProducts()) {
    if (!p.image) continue;
    const cat = categoryBySlug(p.category);
    const base = {
      title: p.name,
      description: clip(p.description || p.name, 4900),
      link: abs(p.url),
      image: abs(p.image),
      extraImages: (p.gallery || []).slice(1, 10).map(abs),
      brand: p.brand || '',
      category: cat ? cat.name : '',
      utm: '',
    };
    const variants = p.variants || [];
    if (!variants.length) {
      const u = unitPrice(p);
      items.push({ ...base, id: p.sku || p.id, price: u.base, sale: u.final < u.base ? u.final : null, available: p.stock === null || p.stock > 0, mpn: p.sku });
    } else {
      for (const v of variants) {
        const u = unitPrice(p, v);
        items.push({
          ...base, id: v.sku || `${p.id}-${v.id}`, title: `${p.name} ${variantLabel(v)}`.trim(), groupId: p.sku || p.id,
          color: v.color, size: v.size, price: u.base, sale: u.final < u.base ? u.final : null, available: v.stock === null || v.stock > 0, mpn: v.sku,
        });
      }
    }
  }
  return items;
}

router.get('/feeds/productos.xml', async (req, res) => {
  await refreshIfStale();
  const body = feedItems().map((i) => `    <item>
      <g:id>${xml(i.id)}</g:id>
      <title>${xml(i.title)}</title>
      <description>${xml(i.description)}</description>
      <link>${xml(i.link)}</link>
      <g:image_link>${xml(i.image)}</g:image_link>
${i.extraImages.map((u) => `      <g:additional_image_link>${xml(u)}</g:additional_image_link>`).join('\n')}
      <g:availability>${i.available ? 'in_stock' : 'out_of_stock'}</g:availability>
      <g:price>${money(i.price)}</g:price>
${i.sale ? `      <g:sale_price>${money(i.sale)}</g:sale_price>\n` : ''}      <g:condition>new</g:condition>
${i.brand ? `      <g:brand>${xml(i.brand)}</g:brand>\n` : '      <g:identifier_exists>no</g:identifier_exists>\n'}${i.mpn ? `      <g:mpn>${xml(i.mpn)}</g:mpn>\n` : ''}${i.category ? `      <g:product_type>${xml(i.category)}</g:product_type>\n` : ''}${i.groupId ? `      <g:item_group_id>${xml(i.groupId)}</g:item_group_id>\n` : ''}${i.color ? `      <g:color>${xml(i.color)}</g:color>\n` : ''}${i.size ? `      <g:size>${xml(i.size)}</g:size>\n` : ''}    </item>`).join('\n');
  res.set('Content-Type', 'application/xml; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
  res.send(`<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Tienda Gorillaz Motorbikes</title>
    <link>${abs('/tienda')}</link>
    <description>Accesorios y repuestos para moto con instalación en Bogotá</description>
${body}
  </channel>
</rss>
`);
});

router.get('/feeds/productos.csv', async (req, res) => {
  await refreshIfStale();
  const rows = [['id', 'title', 'description', 'availability', 'condition', 'price', 'sale_price', 'link', 'image_link', 'brand', 'mpn', 'product_type', 'item_group_id', 'color', 'size']];
  for (const i of feedItems()) {
    rows.push([i.id, i.title, i.description, i.available ? 'in stock' : 'out of stock', 'new', money(i.price), i.sale ? money(i.sale) : '', i.link, i.image, i.brand, i.mpn || '', i.category, i.groupId || '', i.color || '', i.size || '']);
  }
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Cache-Control', 'public, max-age=1800, s-maxage=1800');
  res.send(toCSV(rows, ','));
});

module.exports = router;
