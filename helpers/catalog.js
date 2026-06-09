'use strict';
// Catálogo de la tienda (categorías + productos).
//
// Antes vivía en data/catalog.js y se escribía con fs.writeFileSync, que en
// serverless (Vercel) no persiste: cada cold start revertía los cambios del
// admin. Ahora el valor canónico se guarda en app_settings (clave 'catalog') y
// data/catalog.js queda solo como SEED inicial para una BD vacía.
//
// `catalog` es un objeto ESTABLE y compartido: todos los consumidores hacen
//   const { catalog } = require('../helpers/catalog')
// y leen catalog.products / catalog.categories sobre esta misma referencia, así
// que siempre ven los datos vivos sin tener que cambiar cada sitio de lectura.
// loadCatalog() rellena este objeto desde la BD en cada cold start (lo encadena
// app.js tras settings.loadAll); saveCatalog() lo persiste.
//
// Limitación conocida: el stock se mantiene en este blob, así que entre
// instancias serverless es eventualmente consistente (igual que cuando era un
// archivo). El doble-descuento por orden ya lo evita claimStockDecrement en la
// BD. Un control de stock atómico exigiría una tabla `products` propia.

const seed = require('../data/catalog');
const settings = require('./settings');

const catalog = {
  categories: JSON.parse(JSON.stringify(seed.categories || [])),
  products:   JSON.parse(JSON.stringify(seed.products   || [])),
};

// Rellena el objeto estable desde app_settings si ya hay un catálogo guardado.
function loadCatalog() {
  const stored = settings.get('catalog');
  if (stored && typeof stored === 'object') {
    if (Array.isArray(stored.categories)) catalog.categories = stored.categories;
    if (Array.isArray(stored.products))   catalog.products   = stored.products;
  }
}

// Persiste el estado actual del catálogo en la BD (y en la caché de settings).
async function saveCatalog() {
  await settings.set('catalog', { categories: catalog.categories, products: catalog.products });
}

module.exports = { catalog, loadCatalog, saveCatalog };
