'use strict';
const fs = require('fs');
const path = require('path');

// /static/* se sirve con cache-control immutable de un año (vercel.json), así
// que sin un query param que cambie con el archivo, una tablet que ya cargó
// kds.css una vez nunca vuelve a pedirlo aunque lo actualicemos.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const cache = new Map();

function assetVersion(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  let v = 'dev';
  try { v = String(fs.statSync(path.join(PUBLIC_DIR, relPath)).mtimeMs | 0); }
  catch { /* archivo no encontrado: se sirve sin versión */ }
  cache.set(relPath, v);
  return v;
}

module.exports = { assetVersion };
