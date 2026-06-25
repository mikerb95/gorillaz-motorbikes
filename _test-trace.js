require('dotenv').config();
const { initDb, db, getAllServiceOrders, getServiceOrderEvents } = require('./db');
(async () => {
  await initDb();
  const meta = await db.execute('SELECT version FROM schema_meta WHERE id=1');
  console.log('schema version =', meta.rows[0].version);
  const cols = await db.execute("SELECT name FROM pragma_table_info('service_order_events')");
  console.log('columnas service_order_events:', cols.rows.map(r => r.name).join(', '));
  const orders = await getAllServiceOrders();
  console.log('órdenes totales:', orders.length);
  if (orders.length) {
    const ev = await getServiceOrderEvents(orders[0].id);
    console.log(`eventos de ${orders[0].label}:`, ev.length, '(esperado 0 en órdenes viejas)');
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
