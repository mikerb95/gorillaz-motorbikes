'use strict';
const { catalog, saveCatalog } = require('./catalog');

async function decrementStock(orderItems) {
  if (!Array.isArray(orderItems) || orderItems.length === 0) return;
  let changed = false;
  for (const { id, qty } of orderItems) {
    const p = catalog.products.find(x => x.id === id);
    if (p && typeof p.stock === 'number') {
      p.stock = Math.max(0, p.stock - qty);
      changed = true;
    }
  }
  if (changed) await saveCatalog();
}

module.exports = { decrementStock };
