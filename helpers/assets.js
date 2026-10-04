'use strict';
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// /static/* se sirve con cache-control immutable de un año (vercel.json), así
// que sin un query param que cambie con el archivo, una tablet que ya cargó
// kds.css una vez nunca vuelve a pedirlo aunque lo actualicemos.
//
// La versión sale del CONTENIDO, no de la fecha de modificación: en Vercel
// todos los archivos del despliegue tienen la misma fecha fija (1980), así que
// con mtime la versión era idéntica en cada despliegue y los navegadores se
// quedaban con el CSS/JS viejo para siempre.
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const cache = new Map();

function assetVersion(relPath) {
  if (cache.has(relPath)) return cache.get(relPath);
  let v = 'dev';
  try {
    v = crypto.createHash('sha1').update(fs.readFileSync(path.join(PUBLIC_DIR, relPath))).digest('hex').slice(0, 10);
  } catch { /* archivo no encontrado: se sirve sin versión */ }
  cache.set(relPath, v);
  return v;
}

module.exports = { assetVersion };
