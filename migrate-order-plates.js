'use strict';
// Migración puntual: repuebla la placa en órdenes de servicio creadas a partir
// de una cotización antes del fix de conversión.
//
// El bug: al convertir una cotización en orden, solo se copiaba `motorcycle`
// (sin la `plate`), por lo que el campo combinado quedaba como "NombreMoto" en
// vez de "PLACA — NombreMoto", y el formulario de edición mostraba el nombre de
// la moto duplicado en ambos campos.
//
// Esta migración reconstruye `motorcycle` como "PLACA — NombreMoto" usando la
// placa de la cotización original (enlazada por quotation_id).
//
// Solo modifica órdenes donde:
//   - existe quotation_id y la cotización tiene una placa,
//   - el campo motorcycle actual NO contiene ya el separador " — "
//     (así no toca órdenes ya corregidas o creadas correctamente).
//
// Uso:
//   node migrate-order-plates.js          → dry-run (solo muestra cambios)
//   node migrate-order-plates.js --apply  → aplica los cambios

require('dotenv').config();
const { createClient } = require('@libsql/client');

const APPLY = process.argv.includes('--apply');
const SEP = ' — ';

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
    SELECT so.id            AS order_id,
           so.consecutive   AS consecutive,
           so.motorcycle    AS order_motorcycle,
           q.plate          AS quote_plate,
           q.motorcycle     AS quote_motorcycle
    FROM service_orders so
    JOIN quotations q ON q.id = so.quotation_id
    WHERE so.quotation_id IS NOT NULL
  `);

  const updates = [];
  for (const r of rows) {
    const current = r.order_motorcycle || '';
    const plate = (r.quote_plate || '').trim();
    const moto = (r.quote_motorcycle || '').trim();

    // Salta las que ya tienen separador (ya combinadas o corregidas a mano).
    if (current.includes(SEP)) continue;
    // Sin placa en la cotización no hay nada que reconstruir.
    if (!plate) continue;

    const rebuilt = [plate, moto].filter(Boolean).join(SEP);
    if (rebuilt === current) continue; // sin cambios reales

    updates.push({ id: r.order_id, consecutive: r.consecutive, from: current, to: rebuilt });
  }

  console.log(`\nÓrdenes con cotización analizadas: ${rows.length}`);
  console.log(`Órdenes a corregir: ${updates.length}\n`);

  for (const u of updates) {
    console.log(`  #${u.consecutive}  "${u.from || '(vacío)'}"  →  "${u.to}"`);
  }

  if (updates.length === 0) {
    console.log('\nNada que hacer.');
    return;
  }

  if (!APPLY) {
    console.log('\n[DRY-RUN] No se aplicó ningún cambio. Ejecuta con --apply para guardar.');
    return;
  }

  let n = 0;
  for (const u of updates) {
    await db.execute({
      sql: `UPDATE service_orders
            SET motorcycle = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
            WHERE id = ?`,
      args: [u.to, u.id],
    });
    n++;
  }
  console.log(`\n✅ Actualizadas ${n} órdenes.`);
}

main().catch(err => {
  console.error('Error en la migración:', err);
  process.exit(1);
});
