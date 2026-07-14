'use strict';
// Restauración de la base desde un backup JSON descargado en /admin/dev/backup.
//
// Reconstruye una base vacía (o una nueva base Turso) dejando el sitio
// funcional: primero corre initDb() para crear el esquema al día y luego
// reinserta todas las filas de todas las tablas del backup.
//
// La tabla schema_meta NO se restaura: la gestiona initDb(). Si el backup
// viene de un esquema anterior, las columnas nuevas quedan con su DEFAULT.
//
// Uso:
//   node restore-backup.js gorillaz-backup-2026-07-14.json           → dry-run
//   node restore-backup.js gorillaz-backup-2026-07-14.json --apply   → restaura
//   ... --apply --force  → restaura aunque la base destino ya tenga datos
//
// Apunta a la base definida por TURSO_URL/TURSO_TOKEN en .env. Verifica dos
// veces que apuntas a la base correcta antes de usar --apply.

require('dotenv').config();
const fs = require('fs');
const { db, initDb } = require('./db');

const APPLY = process.argv.includes('--apply');
const FORCE = process.argv.includes('--force');
const file = process.argv[2];

// Filas por lote de db.batch: suficientemente chico para no exceder límites
// de tamaño de request de Turso con filas grandes (settings, invoices).
const BATCH_SIZE = 50;

async function main() {
  if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
    console.error('[ERROR] TURSO_URL o TURSO_TOKEN no configurados. Aborta.');
    process.exit(1);
  }
  if (!file || file.startsWith('--')) {
    console.error('Uso: node restore-backup.js <backup.json> [--apply] [--force]');
    process.exit(1);
  }

  const backup = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!backup.tables || typeof backup.tables !== 'object') {
    console.error('[ERROR] El archivo no parece un backup válido (falta "tables").');
    process.exit(1);
  }

  console.log(`Backup del ${backup.timestamp} (schemaVersion ${backup.schemaVersion ?? 'desconocida'})`);
  console.log(`Base destino: ${process.env.TURSO_URL}\n`);

  const tables = Object.entries(backup.tables).filter(([name]) => name !== 'schema_meta');
  let total = 0;
  for (const [name, rows] of tables) {
    console.log(`  ${name}: ${rows.length} filas`);
    total += rows.length;
  }
  console.log(`\nTotal: ${total} filas en ${tables.length} tablas.`);

  if (!APPLY) {
    console.log('\n[DRY-RUN] No se escribió nada. Ejecuta con --apply para restaurar.');
    return;
  }

  console.log('\nCreando/actualizando esquema (initDb)...');
  await initDb();

  // Freno de seguridad: si la base destino ya tiene usuarios, probablemente
  // no es la base vacía que crees. INSERT OR REPLACE sobrescribiría filas.
  if (!FORCE) {
    const r = await db.execute('SELECT COUNT(*) AS n FROM users');
    if (Number(r.rows[0].n) > 0) {
      console.error(
        `\n[ERROR] La base destino ya tiene ${r.rows[0].n} usuarios. ` +
        'Si de verdad quieres restaurar encima, repite con --force.'
      );
      process.exit(1);
    }
  }

  for (const [name, rows] of tables) {
    if (rows.length === 0) continue;
    const quoted = `"${name.replace(/"/g, '""')}"`;
    const stmts = rows.map(row => {
      const cols = Object.keys(row);
      return {
        sql: `INSERT OR REPLACE INTO ${quoted} (${cols.map(c => `"${c.replace(/"/g, '""')}"`).join(', ')})
              VALUES (${cols.map(() => '?').join(', ')})`,
        args: cols.map(c => row[c]),
      };
    });
    for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
      await db.batch(stmts.slice(i, i + BATCH_SIZE), 'write');
    }
    console.log(`  ✅ ${name}: ${rows.length} filas restauradas`);
  }

  console.log(`\n✅ Restauración completa: ${total} filas.`);
}

main().catch(err => {
  console.error('Error en la restauración:', err);
  process.exit(1);
});
