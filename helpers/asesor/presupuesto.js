'use strict';
// Tope de gasto diario del asesor con IA. Es un endpoint abierto a cualquiera
// que gasta créditos de la API: sin tope, un bot con paciencia vacía la cuenta
// aunque el rate limit por IP lo frene (basta con muchas IPs).
//
// Falla CERRADO: si no se puede leer cuánto se ha gastado hoy, el asesor no
// responde y la burbuja ofrece solo WhatsApp. Perder una conversación con la
// IA cuesta poco; una factura sin techo, no.
//
// Una sola fila en app_settings (`asesor_gasto`, valor "AAAA-MM-DD|usd") y no
// una por día: settings.loadAll() lee app_settings completa en cada cold
// start, y una fila diaria la iría engordando para siempre. El valor no es
// JSON, así que loadAll lo ignora (lo trata como corrupto) y no llega a la caché.
//
// El cliente de la base se inyecta para probarlo contra un SQLite de archivo.

const CLAVE_GASTO = 'asesor_gasto';
const TOPE_POR_DEFECTO_USD = 1;

function clienteDb() {
  return require('../../db').db;
}

function topeDiarioUsd() {
  const crudo = process.env.ASESOR_TOPE_DIARIO_USD;
  const v = Number(crudo);
  return crudo !== undefined && crudo !== '' && Number.isFinite(v) && v >= 0 ? v : TOPE_POR_DEFECTO_USD;
}

/** Fecha de hoy en Colombia: el día del tope empieza a medianoche de Bogotá, no de UTC. */
function hoyBogota(ahora = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(ahora);
}

/** Lee "AAAA-MM-DD|usd". Lo que no tenga esa forma, o sea de otro día, cuenta como cero. */
function gastoDelValor(valor, hoy) {
  if (!valor) return 0;
  const [fecha, usd] = String(valor).split('|');
  const n = Number(usd);
  return fecha === hoy && Number.isFinite(n) && n >= 0 ? n : 0;
}

/** USD que quedan hoy. Lanza si la base no responde (el que llama falla cerrado). */
async function presupuestoRestante(ahora = new Date(), db = clienteDb()) {
  const r = await db.execute({ sql: 'SELECT value FROM app_settings WHERE key = ?', args: [CLAVE_GASTO] });
  return topeDiarioUsd() - gastoDelValor(r.rows[0]?.value, hoyBogota(ahora));
}

/**
 * Suma un gasto de forma atómica: el día nuevo arranca de cero dentro del
 * mismo UPSERT, sin leer antes, para que dos preguntas a la vez no se pisen.
 */
async function sumarGasto(usd, ahora = new Date(), db = clienteDb()) {
  if (!(usd > 0)) return;
  const hoy = hoyBogota(ahora);
  const inicial = `${hoy}|${usd}`;
  await db.execute({
    sql: `INSERT INTO app_settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET
            value = CASE WHEN substr(app_settings.value, 1, 10) = ?
              THEN ? || '|' || (CAST(substr(app_settings.value, 12) AS REAL) + ?)
              ELSE ? END,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    args: [CLAVE_GASTO, inicial, hoy, hoy, usd, inicial],
  });
}

module.exports = { CLAVE_GASTO, topeDiarioUsd, hoyBogota, gastoDelValor, presupuestoRestante, sumarGasto };
