'use strict';
// Migración puntual: normaliza el estado de órdenes de servicio creadas antes
// del fix de conversión de cotización → orden.
//
// El bug: al convertir una cotización en orden, no se pasaba `status`, por lo
// que la orden nacía en 'pendiente' — un estado que NO existe en el flujo de
// taller (ingreso_taller → trabajo_en_curso → en_pausa → trabajo_completo →
// entregado). Eso dejaba el badge con texto crudo y el selector de estado sin
// opción marcada en el panel admin.
//
// Esta migración pasa esas órdenes a 'ingreso_taller', el primer estado real
// del flujo, dejándolas idénticas a las creadas correctamente.
//
// Solo modifica órdenes donde status = 'pendiente'. No toca ningún otro campo.
//
// Uso:
//   node migrate-order-status-pendiente.js          → dry-run (solo muestra)
//   node migrate-order-status-pendiente.js --apply  → aplica los cambios

require('dotenv').config();
const { createClient } = require('@libsql/client');

const APPLY = process.argv.includes('--apply');

const db = createClient({
  url: process.env.TURSO_URL || '',
  authToken: (process.env.TURSO_TOKEN || '').trim().replace(/^Bearer\s+/i, ''),
});

async function main() {
  if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
    console.error('[ERROR] TURSO_URL o TURSO_TOKEN no configurados. Aborta.');
    process.exit(1);
  }

  const { rows } = await db.execute(`
    SELECT id, consecutive, label
    FROM service_orders
    WHERE status = 'pendiente'
    ORDER BY consecutive
  `);

  console.log(`\nÓrdenes en estado 'pendiente' a normalizar: ${rows.length}\n`);

  for (const r of rows) {
    console.log(`  #${r.consecutive}  ${r.label || r.id}  →  'ingreso_taller'`);
  }

  if (rows.length === 0) {
    console.log('Nada que hacer.');
    return;
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] No se aplicó ningún cambio. Ejecuta con --apply para guardar.');
    return;
  }

  const r = await db.execute({
    sql: `UPDATE service_orders
          SET status = 'ingreso_taller',
              updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE status = 'pendiente'`,
  });
  console.log(`\n✅ Actualizadas ${r.rowsAffected} órdenes.`);
}

main().catch(err => {
  console.error('Error en la migración:', err);
  process.exit(1);
});
