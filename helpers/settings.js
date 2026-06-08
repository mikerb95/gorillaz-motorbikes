'use strict';
// Caché en memoria de la configuración editable del admin (cotizador,
// parqueadero, PDF, puntos, catálogo de servicios). El valor canónico vive en
// la tabla app_settings de Turso; aquí lo mantenemos en memoria para que las
// lecturas sigan siendo síncronas (como cuando eran archivos JSON) sin pegarle
// a la BD en cada request.
//
// Ciclo de vida en serverless:
//   - loadAll() corre una vez por cold start (lo encadena app.js tras initDb),
//     poblando la caché desde la BD.
//   - get(key) lee de la caché (síncrono). Si la clave no existe en BD todavía,
//     devuelve undefined y el llamador usa su fallback (archivo/default).
//   - set(key, value) escribe en BD y actualiza la caché al instante.
//
// Consistencia: una escritura en una instancia se ve en otras instancias en su
// próximo cold start (o si se vuelve a llamar loadAll). Para config de admin
// editada esporádicamente, esa consistencia eventual es suficiente.

const { getAllSettings, setSetting } = require('../db');

const cache = new Map(); // key -> valor JSON ya parseado

async function loadAll() {
  try {
    const rows = await getAllSettings();
    cache.clear();
    for (const { key, value } of rows) {
      try { cache.set(key, JSON.parse(value)); }
      catch { /* valor corrupto: se ignora y aplica el fallback del llamador */ }
    }
  } catch (err) {
    console.error('[settings] No se pudo cargar app_settings:', err.message);
  }
}

// Devuelve el valor cacheado o undefined si la clave aún no está en BD.
function get(key) {
  return cache.has(key) ? cache.get(key) : undefined;
}

// Persiste en BD y refresca la caché.
async function set(key, value) {
  cache.set(key, value);
  await setSetting(key, JSON.stringify(value));
}

module.exports = { loadAll, get, set };
