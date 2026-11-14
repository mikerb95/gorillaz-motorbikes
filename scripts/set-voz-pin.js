// Fija el PIN compartido de la página de voz del mecánico (/taller/voz).
// Lo guarda cifrado con bcrypt en app_settings('voz_pin_hash') de la base que
// diga el .env (TURSO_URL). Nunca imprime credenciales ni el PIN.
//
//   node scripts/set-voz-pin.js 1234
'use strict';
require('dotenv').config({ quiet: true });
const bcrypt = require('bcryptjs');

(async () => {
  const pin = String(process.argv[2] || '').trim();
  if (!/^\d{4,6}$/.test(pin)) {
    console.error('Uso: node scripts/set-voz-pin.js <PIN de 4 a 6 números>');
    process.exit(1);
  }
  const { db } = require('../db');
  const settings = require('../helpers/settings');
  await settings.set('voz_pin_hash', await bcrypt.hash(pin, 10));
  const r = await db.execute({ sql: "SELECT key, updated_at FROM app_settings WHERE key = 'voz_pin_hash'" });
  const fila = r.rows[0];
  const destino = (process.env.TURSO_URL || '').startsWith('file:') ? 'base local' : 'base remota (Turso)';
  console.log(fila ? `PIN de la página de voz guardado en la ${destino} (${fila.updated_at}).` : 'No se pudo comprobar el guardado.');
  db.close();
})().catch((err) => {
  console.error('Falló:', err.message);
  process.exit(1);
});
