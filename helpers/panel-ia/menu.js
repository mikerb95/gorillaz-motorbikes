'use strict';
// Menú del panel admin para "¿dónde veo...?" (herramienta buscar_en_panel y
// buscador sin IA). Se lee del propio menú lateral (views/partials/admin-head.ejs)
// para que no haya una segunda lista que se desincronice.

const fs = require('fs');
const path = require('path');

let cache = null;

function normalizar(t) {
  return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

function menuDelPanel() {
  if (cache) return cache;
  let html = '';
  try {
    html = fs.readFileSync(path.join(__dirname, '../../views/partials/admin-head.ejs'), 'utf8');
  } catch {
    html = '';
  }
  const out = [];
  const re = /<a class="crm-nav-link" href="(\/admin[^"]*)"[^>]*?(?:data-keywords="([^"]*)")?[^>]*>([\s\S]*?)<\/a>/g;
  for (const m of html.matchAll(re)) {
    const etiqueta = m[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (etiqueta) out.push({ etiqueta, enlace: m[1], claves: m[2] || '' });
  }
  // Subsecciones útiles que no están en el menú lateral.
  out.push(
    { etiqueta: 'Nueva orden de servicio', enlace: '/admin/ordenes-servicio/nueva', claves: 'crear orden taller' },
    { etiqueta: 'Nuevo producto de la tienda', enlace: '/admin/tienda/nuevo', claves: 'crear producto catálogo' },
    { etiqueta: 'Pedidos de la tienda', enlace: '/admin/pedidos', claves: 'ventas online compras' },
  );
  cache = out;
  return out;
}

/** Secciones cuyo nombre o palabras clave contienen todos los términos de `q`. */
function buscarEnMenu(q, limite = 6) {
  const terminos = normalizar(q).split(/\s+/).filter((t) => t.length >= 2);
  if (!terminos.length) return [];
  return menuDelPanel()
    .map((s) => {
      const hay = normalizar(`${s.etiqueta} ${s.claves}`);
      const aciertos = terminos.filter((t) => hay.includes(t)).length;
      return { s, aciertos };
    })
    .filter((x) => x.aciertos > 0)
    .sort((a, b) => b.aciertos - a.aciertos)
    .slice(0, limite)
    .map(({ s }) => ({ etiqueta: s.etiqueta, enlace: s.enlace }));
}

module.exports = { menuDelPanel, buscarEnMenu, normalizar };
