'use strict';
const { createClient } = require('@libsql/client');
const { randomInt } = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { hoyCO } = require('./helpers/datetime');

if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
  console.warn('[WARN] TURSO_URL o TURSO_TOKEN no configurados');
}

const db = createClient({
  url: process.env.TURSO_URL || '',
  authToken: (process.env.TURSO_TOKEN || '').trim().replace(/^Bearer\s+/i, ''),
});

// ── Schema ────────────────────────────────────────────────────────────────

// Versión del esquema. Súbela en +1 cada vez que agregues una tabla, columna
// o índice nuevo abajo. initDb() compara este número contra el valor guardado
// en la tabla schema_meta y solo corre las migraciones cuando la base está
// desactualizada. Así un cold start con la base ya migrada cuesta 3 viajes
// baratos a la red en vez de los ~46 (16 CREATE + 25 ALTER + 5 INDEX) de antes.
// (Turso remoto no permite escribir PRAGMA user_version, por eso usamos tabla.)
const SCHEMA_VERSION = 15;

async function initDb() {
  // Control de versión del esquema (sentencias idempotentes y baratas).
  await db.execute(`CREATE TABLE IF NOT EXISTS schema_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    version INTEGER NOT NULL DEFAULT 0
  )`);
  await db.execute(`INSERT OR IGNORE INTO schema_meta (id, version) VALUES (1, 0)`);
  const meta = await db.execute('SELECT version FROM schema_meta WHERE id = 1');
  const currentVersion = Number(meta.rows[0]?.version ?? 0);
  if (currentVersion >= SCHEMA_VERSION) return; // esquema al día → nada que hacer

  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      first_name TEXT NOT NULL DEFAULT '',
      last_name TEXT NOT NULL DEFAULT '',
      email TEXT UNIQUE NOT NULL,
      password TEXT,
      role TEXT NOT NULL DEFAULT 'user',
      cedula TEXT,
      phone TEXT,
      city TEXT,
      department TEXT,
      birthdate TEXT,
      nickname TEXT,
      blood_type TEXT,
      club_notifications INTEGER NOT NULL DEFAULT 1,
      membership TEXT NOT NULL DEFAULT '{}',
      visits TEXT NOT NULL DEFAULT '[]',
      vehicles TEXT NOT NULL DEFAULT '[]',
      emergency_name TEXT,
      emergency_phone TEXT,
      reset_token TEXT,
      reset_token_expiry INTEGER,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL DEFAULT '',
      email TEXT NOT NULL DEFAULT '',
      phone TEXT,
      service TEXT NOT NULL DEFAULT '',
      date TEXT NOT NULL DEFAULT '',
      time TEXT,
      plate TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente',
      customer TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      date TEXT NOT NULL,
      location TEXT,
      description TEXT,
      level TEXT,
      type TEXT NOT NULL DEFAULT 'evento',
      category TEXT NOT NULL DEFAULT 'club',
      lat TEXT,
      lng TEXT,
      deleted_at TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS admin_audit_log (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL,
      admin_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_type TEXT NOT NULL,
      target_id TEXT,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS event_attendances (
      id TEXT PRIMARY KEY,
      event_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      registered_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      UNIQUE(event_id, user_id)
    )`,
    `CREATE TABLE IF NOT EXISTS newsletter (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      confirmed INTEGER NOT NULL DEFAULT 0,
      confirm_token TEXT,
      unsubscribe_token TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS newsletter_campaigns (
      id TEXT PRIMARY KEY,
      subject TEXT NOT NULL,
      body_html TEXT NOT NULL,
      sent_count INTEGER NOT NULL DEFAULT 0,
      sent_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS enrollments (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL,
      course_title TEXT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS job_applications (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      experience TEXT,
      skills TEXT,
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      bold_order_id TEXT,
      bold_payment_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      total INTEGER NOT NULL DEFAULT 0,
      items TEXT NOT NULL DEFAULT '[]',
      customer_name TEXT NOT NULL DEFAULT '',
      customer_email TEXT NOT NULL DEFAULT '',
      customer_phone TEXT,
      customer_address TEXT,
      customer_city TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS quotations (
      id TEXT PRIMARY KEY,
      consecutive INTEGER NOT NULL,
      items TEXT NOT NULL DEFAULT '[]',
      total INTEGER NOT NULL DEFAULT 0,
      client_phone TEXT,
      client_phone_country TEXT NOT NULL DEFAULT '+57',
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS service_orders (
      id TEXT PRIMARY KEY,
      consecutive INTEGER NOT NULL,
      label TEXT NOT NULL,
      quotation_id TEXT,
      items TEXT NOT NULL DEFAULT '[]',
      total INTEGER NOT NULL DEFAULT 0,
      motorcycle TEXT,
      client_phone TEXT,
      client_phone_country TEXT NOT NULL DEFAULT '+57',
      mechanic TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente',
      notes TEXT,
      estimated_date TEXT,
      invoice_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      consecutive INTEGER NOT NULL,
      label TEXT NOT NULL,
      service_order_id TEXT NOT NULL,
      quotation_id TEXT,
      items TEXT NOT NULL DEFAULT '[]',
      subtotal INTEGER NOT NULL DEFAULT 0,
      tax INTEGER NOT NULL DEFAULT 0,
      total INTEGER NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'efectivo',
      status TEXT NOT NULL DEFAULT 'pendiente',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS passkeys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      credential_id TEXT UNIQUE NOT NULL,
      public_key TEXT NOT NULL,
      counter INTEGER NOT NULL DEFAULT 0,
      device_type TEXT,
      backed_up INTEGER NOT NULL DEFAULT 0,
      transports TEXT NOT NULL DEFAULT '[]',
      name TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS employees (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin_hash TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS gastos (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'otros',
      description TEXT NOT NULL,
      amount INTEGER NOT NULL DEFAULT 0,
      date TEXT NOT NULL,
      payment_method TEXT NOT NULL DEFAULT 'efectivo',
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    // Contadores globales anti fuerza bruta (p. ej. login por PIN del taller).
    // Persistido en BD para que el límite sea global entre instancias serverless.
    `CREATE TABLE IF NOT EXISTS security_throttle (
      key TEXT PRIMARY KEY,
      count INTEGER NOT NULL DEFAULT 0,
      window_start INTEGER NOT NULL DEFAULT 0
    )`,
    // Configuración editable desde el panel admin (cotizador, parqueadero, PDF,
    // puntos, catálogo de servicios). Antes vivía en archivos JSON, que en
    // serverless (Vercel) no persisten: cada cold start los revertía. value es
    // un blob JSON. Ver helpers/settings.js.
    `CREATE TABLE IF NOT EXISTS app_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    // Clasificados del club: los miembros publican ventas de motos, partes o
    // accesorios. Entran como 'pending' y un admin los aprueba ('active'),
    // rechaza ('rejected') o el dueño los marca 'sold'. El contacto es directo
    // (WhatsApp/teléfono): no hay pago ni carrito, es un beneficio entre socios.
    `CREATE TABLE IF NOT EXISTS classifieds (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      seller_name TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT 'moto',
      title TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      price INTEGER NOT NULL DEFAULT 0,
      negotiable INTEGER NOT NULL DEFAULT 0,
      condition TEXT NOT NULL DEFAULT 'usado',
      brand TEXT,
      city TEXT,
      department TEXT,
      contact_phone TEXT,
      images TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL DEFAULT 'pending',
      reject_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    // Trazabilidad de órdenes de servicio: una fila por cada estado que toma la
    // orden (incluido el inicial). Alimenta la línea de tiempo del detalle.
    // Se registra desde createServiceOrder/updateServiceOrder; el histórico
    // previo a esta tabla no existe, así que arranca en blanco por orden.
    `CREATE TABLE IF NOT EXISTS service_order_events (
      id TEXT PRIMARY KEY,
      service_order_id TEXT NOT NULL,
      status TEXT NOT NULL,
      actor TEXT,
      detail TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    // Check-in del cliente al llegar al taller (escaneando el QR del mostrador).
    // Le ahorra al mecánico transcribir los datos: solo busca por placa y
    // continúa creando la orden de servicio. 'pendiente' hasta que un mecánico
    // la convierte en orden ('atendido'), momento en que queda enlazada a ella.
    `CREATE TABLE IF NOT EXISTS checkins (
      id TEXT PRIMARY KEY,
      client_name TEXT NOT NULL,
      client_phone TEXT NOT NULL,
      client_phone_country TEXT NOT NULL DEFAULT '+57',
      plate TEXT NOT NULL,
      brand TEXT,
      reference TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente',
      service_order_id TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    // Emparejamiento celular↔PC para el control remoto de /clases/.../
    // presentation. El PC crea la sesión con un código corto y hace polling de
    // slide_index; el celular solo empuja next/prev por el código, sin ver los
    // slides. expires_at acota cuánto vive una sesión abandonada.
    `CREATE TABLE IF NOT EXISTS presentation_sessions (
      code TEXT PRIMARY KEY,
      course TEXT NOT NULL,
      topic TEXT NOT NULL,
      slide_index INTEGER NOT NULL DEFAULT 0,
      slide_count INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      expires_at TEXT NOT NULL
    )`,
    // Duplicado de placas y portaplacas: el taller es intermediario, no
    // fabricante. La solicitud entra 'pendiente' y un admin la mueve por el
    // trámite (en_tramite → listo → entregado) o la cancela. Contacto directo
    // por WhatsApp/teléfono, sin pago online (igual que classifieds).
    // Estado del único TV del taller (fila fija id=1). Se lee/escribe directo en
    // BD, sin pasar por la caché en memoria de helpers/settings.js: el remoto
    // (POST) y la pantalla (GET en polling) pueden caer en instancias
    // serverless distintas, y esa caché solo se sincroniza entre ellas en el
    // siguiente cold start — inservible para un control remoto en vivo.
    `CREATE TABLE IF NOT EXISTS tv_state (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      mode TEXT NOT NULL DEFAULT 'playlist',
      playing INTEGER NOT NULL DEFAULT 1,
      cmd_seq INTEGER NOT NULL DEFAULT 0,
      cmd_action TEXT,
      course TEXT,
      topic TEXT,
      slide_index INTEGER NOT NULL DEFAULT 0,
      slide_count INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
    `CREATE TABLE IF NOT EXISTS plate_duplicate_requests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      reason TEXT,
      plate TEXT,
      vehicle_brand TEXT,
      customer_name TEXT NOT NULL,
      customer_phone TEXT NOT NULL,
      customer_email TEXT,
      city TEXT,
      department TEXT,
      notes TEXT,
      status TEXT NOT NULL DEFAULT 'pendiente',
      admin_notes TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
    )`,
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }

  // Migrations: add columns to existing tables if they don't exist
  const migrations = [
    `ALTER TABLE users ADD COLUMN score INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN score_history TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE users ADD COLUMN deleted_at TEXT`,
    `ALTER TABLE events ADD COLUMN type TEXT NOT NULL DEFAULT 'evento'`,
    `ALTER TABLE events ADD COLUMN category TEXT NOT NULL DEFAULT 'club'`,
    `ALTER TABLE events ADD COLUMN lat TEXT`,
    `ALTER TABLE events ADD COLUMN lng TEXT`,
    `ALTER TABLE events ADD COLUMN deleted_at TEXT`,
    `ALTER TABLE newsletter ADD COLUMN unsubscribe_token TEXT`,
    `ALTER TABLE newsletter ADD COLUMN confirmed INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE newsletter ADD COLUMN confirm_token TEXT`,
    `ALTER TABLE quotations ADD COLUMN motorcycle TEXT`,
    `ALTER TABLE quotations ADD COLUMN notes TEXT`,
    `ALTER TABLE quotations ADD COLUMN plate TEXT`,
    `ALTER TABLE service_orders ADD COLUMN trabajo_completo_at TEXT`,
    `ALTER TABLE service_orders ADD COLUMN employee_id TEXT`,
    `ALTER TABLE service_orders ADD COLUMN pending_review INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE employees ADD COLUMN user_id TEXT`,
    `ALTER TABLE orders ADD COLUMN stock_decremented INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN first_name TEXT NOT NULL DEFAULT ''`,
    `ALTER TABLE users ADD COLUMN last_name TEXT NOT NULL DEFAULT ''`,
    `UPDATE users SET first_name = TRIM(SUBSTR(name, 1, INSTR(name || ' ', ' ') - 1)), last_name = TRIM(SUBSTR(name, INSTR(name || ' ', ' '))) WHERE first_name = ''`,
    `ALTER TABLE users ADD COLUMN department TEXT`,
    `ALTER TABLE users ADD COLUMN google_id TEXT`,
    `ALTER TABLE users ADD COLUMN avatar_url TEXT`,
    `ALTER TABLE users ADD COLUMN apple_id TEXT`,
    // Permite revocar JWTs: cada token lleva el token_version del usuario y se
    // invalida si no coincide (al cambiar contraseña o eliminar la cuenta).
    `ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE classifieds ADD COLUMN department TEXT`,
    // Detalle opcional de un hito de trazabilidad (p. ej. la etiqueta de la
    // factura en los eventos 'factura_generada' / 'factura_anulada').
    `ALTER TABLE service_order_events ADD COLUMN detail TEXT`,
    // Fecha de pago de la factura: el ingreso se reconoce cuando se cobra, no
    // cuando se emite. Se fija al pasar a 'pagada' y se limpia si sale de ese
    // estado. Backfill: las facturas ya pagadas usan su fecha de emisión como
    // aproximación (no se guardó la de pago históricamente).
    `ALTER TABLE invoices ADD COLUMN paid_at TEXT`,
    `UPDATE invoices SET paid_at = created_at WHERE status = 'pagada' AND paid_at IS NULL`,
    // Cobro de parqueadero: solo se conoce con certeza al entregar la moto, así
    // que la factura nace 'proforma' (sin este valor) y se cierra al entregar.
    `ALTER TABLE invoices ADD COLUMN parking_amount INTEGER NOT NULL DEFAULT 0`,
    // Fecha real de entrega de la moto (distinta de estimated_date, que es solo
    // la fecha estimada). Se sella al cerrar la factura proforma.
    `ALTER TABLE service_orders ADD COLUMN delivered_at TEXT`,
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch { /* column already exists */ }
  }

  const indexes = [
    `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
    `CREATE INDEX IF NOT EXISTS idx_users_cedula ON users(cedula)`,
    `CREATE INDEX IF NOT EXISTS idx_ea_event_id  ON event_attendances(event_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ea_user_id   ON event_attendances(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_events_date  ON events(date)`,
    `CREATE INDEX IF NOT EXISTS idx_classifieds_status ON classifieds(status)`,
    `CREATE INDEX IF NOT EXISTS idx_classifieds_user   ON classifieds(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_so_events_order ON service_order_events(service_order_id)`,
    // Tablas calientes de listados/dashboard: aceleran el ORDER BY created_at de
    // los listados, los filtros por estado y los JOIN/lookup por orden, y evitan
    // full scans a medida que crecen las órdenes/facturas/cotizaciones.
    `CREATE INDEX IF NOT EXISTS idx_so_created        ON service_orders(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_so_status         ON service_orders(status)`,
    `CREATE INDEX IF NOT EXISTS idx_so_employee       ON service_orders(employee_id)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_created  ON invoices(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_status   ON invoices(status)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_paid_at  ON invoices(paid_at)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_so       ON invoices(service_order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_quotations_created ON quotations(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_quotations_status  ON quotations(status)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_created    ON orders(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_orders_user       ON orders(user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_users_score       ON users(score)`,
    `CREATE INDEX IF NOT EXISTS idx_checkins_status    ON checkins(status)`,
    `CREATE INDEX IF NOT EXISTS idx_checkins_plate     ON checkins(plate)`,
    `CREATE INDEX IF NOT EXISTS idx_checkins_created   ON checkins(created_at)`,
    `CREATE INDEX IF NOT EXISTS idx_pres_sessions_expires ON presentation_sessions(expires_at)`,
    `CREATE INDEX IF NOT EXISTS idx_plate_requests_status  ON plate_duplicate_requests(status)`,
    `CREATE INDEX IF NOT EXISTS idx_plate_requests_created ON plate_duplicate_requests(created_at)`,
  ];
  for (const sql of indexes) {
    try { await db.execute(sql); } catch { /* index already exists */ }
  }

  await ensureNewsletterTokens();
  await reconcileAnnulledInvoices();
  await reconcileOrderInvoiceLinks();

  // Marca el esquema como migrado para que los próximos cold starts salgan
  // temprano en la comprobación de versión de arriba.
  await db.execute({ sql: 'UPDATE schema_meta SET version = ? WHERE id = 1', args: [SCHEMA_VERSION] });
  console.log(`✅ Turso schema inicializado (v${SCHEMA_VERSION})`);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

// Paginación genérica por offset para listados admin. `table` y `order` son
// literales controlados por el código (nunca input de usuario); `where`/`args`
// van parametrizados. Devuelve las filas ya mapeadas + metadatos para el
// paginador. Se limita `size` a 100 como tope de seguridad.
async function paginate(table, { where = '', args = [], order = 'created_at DESC', page = 1, size = 25, map = r => r } = {}) {
  const lim = Math.max(1, Math.min(100, Number(size) || 25));
  const w   = where ? `WHERE ${where}` : '';
  // Se cuenta primero para acotar la página pedida al rango real: así un
  // ?page= fuera de rango devuelve la última página, no una tabla vacía.
  const countR = await db.execute({ sql: `SELECT COUNT(*) AS n FROM ${table} ${w}`, args });
  const total  = Number(countR.rows[0].n);
  const pages  = Math.max(1, Math.ceil(total / lim));
  const pg     = Math.min(pages, Math.max(1, Number(page) || 1));
  const off    = (pg - 1) * lim;
  const rowsR  = await db.execute({ sql: `SELECT * FROM ${table} ${w} ORDER BY ${order} LIMIT ? OFFSET ?`, args: [...args, lim, off] });
  return { rows: rowsR.rows.map(map), total, page: pg, size: lim, pages };
}

function rowToUser(row) {
  if (!row) return null;
  const firstName = row.first_name || '';
  const lastName  = row.last_name  || '';
  const name      = (firstName + ' ' + lastName).trim() || row.name || '';
  return {
    id: row.id,
    name,
    firstName,
    lastName,
    email: row.email,
    password: row.password,
    role: row.role || 'user',
    cedula: row.cedula,
    phone: row.phone,
    city: row.city,
    department: row.department,
    birthdate: row.birthdate,
    nickname: row.nickname,
    bloodType: row.blood_type,
    clubNotifications: row.club_notifications !== 0,
    membership: safeJson(row.membership, { level: 'Básica', since: '', expires: null, benefits: [] }),
    visits: safeJson(row.visits, []),
    vehicles: safeJson(row.vehicles, []),
    score: Number(row.score) || 0,
    scoreHistory: safeJson(row.score_history, []),
    emergencyName: row.emergency_name,
    emergencyPhone: row.emergency_phone,
    resetToken: row.reset_token,
    resetTokenExpiry: row.reset_token_expiry,
    googleId: row.google_id || null,
    appleId: row.apple_id || null,
    avatarUrl: row.avatar_url || null,
    tokenVersion: Number(row.token_version) || 0,
    createdAt: row.created_at,
  };
}

function rowToEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    location: row.location,
    description: row.description,
    level: row.level,
    type: row.type || 'evento',
    category: row.category || 'club',
    lat: row.lat || null,
    lng: row.lng || null,
    createdAt: row.created_at,
  };
}

function rowToAppointment(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phone: row.phone,
    service: row.service,
    date: row.date,
    time: row.time,
    status: row.status,
    customer: row.customer || row.name,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

// ── Users ─────────────────────────────────────────────────────────────────

async function getUserById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE id = ? AND deleted_at IS NULL', args: [id] });
  return rowToUser(r.rows[0] || null);
}

async function getUserByEmail(email) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE email = ? AND deleted_at IS NULL', args: [email] });
  return rowToUser(r.rows[0] || null);
}

async function getUserByCedula(cedula) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE cedula = ? AND deleted_at IS NULL', args: [cedula] });
  return rowToUser(r.rows[0] || null);
}

async function getUserByResetToken(token) {
  const r = await db.execute({
    sql: 'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > ? AND deleted_at IS NULL',
    args: [token, Date.now()],
  });
  return rowToUser(r.rows[0] || null);
}

async function getUserByGoogleId(googleId) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE google_id = ? AND deleted_at IS NULL', args: [googleId] });
  return rowToUser(r.rows[0] || null);
}

async function getUserByAppleId(appleId) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE apple_id = ? AND deleted_at IS NULL', args: [appleId] });
  return rowToUser(r.rows[0] || null);
}

async function getAllUsers() {
  const r = await db.execute('SELECT * FROM users WHERE deleted_at IS NULL ORDER BY created_at DESC');
  return r.rows.map(rowToUser);
}

async function countUsers() {
  const r = await db.execute('SELECT COUNT(*) as n FROM users WHERE deleted_at IS NULL');
  return Number(r.rows[0].n);
}

async function createUser(data) {
  const id = data.id || uuidv4();
  const firstName = (data.firstName || '').trim();
  const lastName  = (data.lastName  || '').trim();
  const fullName  = (firstName + ' ' + lastName).trim() || data.name || '';
  await db.execute({
    sql: `INSERT INTO users
            (id, name, first_name, last_name, email, password, role, cedula, phone, city, department, birthdate,
             nickname, blood_type, club_notifications, membership, visits, vehicles,
             emergency_name, emergency_phone, google_id, apple_id, avatar_url)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      fullName,
      firstName,
      lastName,
      data.email,
      data.password || null,
      data.role || 'user',
      data.cedula || null,
      data.phone || null,
      data.city || null,
      data.department || null,
      data.birthdate || null,
      data.nickname || null,
      data.bloodType || null,
      data.clubNotifications === false ? 0 : 1,
      JSON.stringify(data.membership || { level: 'Básica', since: hoyCO(), expires: null, benefits: ['Descuentos en taller', 'Acceso al club'] }),
      JSON.stringify(data.visits || []),
      JSON.stringify(data.vehicles || []),
      data.emergencyName || null,
      data.emergencyPhone || null,
      data.googleId || null,
      data.appleId || null,
      data.avatarUrl || null,
    ],
  });
  return getUserById(id);
}

async function updateUser(id, fields) {
  const set = [];
  const args = [];
  if (fields.firstName !== undefined)        { set.push('first_name = ?');          args.push((fields.firstName || '').trim()); }
  if (fields.lastName !== undefined)         { set.push('last_name = ?');           args.push((fields.lastName  || '').trim()); }
  if (fields.name !== undefined)             { set.push('name = ?');                args.push(fields.name); }
  if (fields.password !== undefined)         { set.push('password = ?');            args.push(fields.password); }
  if (fields.role !== undefined)             { set.push('role = ?');                args.push(fields.role); }
  if (fields.cedula !== undefined)           { set.push('cedula = ?');              args.push(fields.cedula); }
  if (fields.phone !== undefined)            { set.push('phone = ?');               args.push(fields.phone); }
  if (fields.city !== undefined)             { set.push('city = ?');                args.push(fields.city); }
  if (fields.department !== undefined)       { set.push('department = ?');          args.push(fields.department); }
  if (fields.birthdate !== undefined)        { set.push('birthdate = ?');           args.push(fields.birthdate); }
  if (fields.nickname !== undefined)         { set.push('nickname = ?');            args.push(fields.nickname); }
  if (fields.bloodType !== undefined)        { set.push('blood_type = ?');          args.push(fields.bloodType); }
  if (fields.clubNotifications !== undefined){ set.push('club_notifications = ?');  args.push(fields.clubNotifications ? 1 : 0); }
  if (fields.emergencyName !== undefined)    { set.push('emergency_name = ?');      args.push(fields.emergencyName); }
  if (fields.emergencyPhone !== undefined)   { set.push('emergency_phone = ?');     args.push(fields.emergencyPhone); }
  if (fields.membership !== undefined)       { set.push('membership = ?');          args.push(JSON.stringify(fields.membership)); }
  if (fields.visits !== undefined)           { set.push('visits = ?');              args.push(JSON.stringify(fields.visits)); }
  if (fields.vehicles !== undefined)         { set.push('vehicles = ?');            args.push(JSON.stringify(fields.vehicles)); }
  if (fields.score !== undefined)            { set.push('score = ?');               args.push(fields.score); }
  if (fields.scoreHistory !== undefined)     { set.push('score_history = ?');       args.push(JSON.stringify(fields.scoreHistory)); }
  if (fields.resetToken !== undefined)       { set.push('reset_token = ?');         args.push(fields.resetToken); }
  if (fields.resetTokenExpiry !== undefined) { set.push('reset_token_expiry = ?');  args.push(fields.resetTokenExpiry); }
  if (fields.googleId !== undefined)         { set.push('google_id = ?');           args.push(fields.googleId); }
  if (fields.appleId !== undefined)          { set.push('apple_id = ?');            args.push(fields.appleId); }
  if (fields.avatarUrl !== undefined)        { set.push('avatar_url = ?');          args.push(fields.avatarUrl); }
  if (set.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE users SET ${set.join(', ')} WHERE id = ?`, args });
}

// Invalida todas las sesiones (JWT) vigentes del usuario. Los tokens llevan el
// token_version con el que se emitieron; al incrementarlo, dejan de coincidir y
// se rechazan en jwtCart/templateLocals. Se usa al cambiar la contraseña.
async function incrementTokenVersion(id) {
  await db.execute({ sql: 'UPDATE users SET token_version = token_version + 1 WHERE id = ?', args: [id] });
}

async function deleteUser(id) {
  await db.execute({ sql: `UPDATE users SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, args: [id] });
}

// Baja de cuenta solicitada por el propio usuario. Es un soft-delete que además
// anonimiza la fila: borra los datos personales y del club (nombre, cédula,
// teléfono, vehículos, puntos, membresía…) y libera los identificadores únicos
// (email, cédula, Google/Apple) para que pueda volver a registrarse. Elimina sus
// passkeys. Se conserva la fila —con su id— para no romper la referencia user_id
// de orders.
//
// La trazabilidad de servicios NO se ve afectada: service_orders, quotations e
// invoices no tienen user_id y guardan su propia copia de la placa (motorcycle/
// plate) y el teléfono (client_phone) al crearse, así que /consultar, /historial
// y /servicios siguen encontrándolos por placa tras la baja.
async function deleteUserAccount(id) {
  const tx = await db.transaction('write');
  try {
    await tx.execute({
      sql: `UPDATE users SET
              deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now'),
              email = 'deleted-' || id || '@deleted.local',
              password = NULL, name = 'Cuenta eliminada', first_name = '', last_name = '',
              cedula = NULL, phone = NULL, city = NULL, department = NULL,
              birthdate = NULL, nickname = NULL, blood_type = NULL,
              emergency_name = NULL, emergency_phone = NULL, avatar_url = NULL,
              google_id = NULL, apple_id = NULL, reset_token = NULL, reset_token_expiry = NULL,
              vehicles = '[]', visits = '[]', club_notifications = 0,
              score = 0, score_history = '[]', membership = '{}',
              token_version = token_version + 1
            WHERE id = ?`,
      args: [id],
    });
    await tx.execute({ sql: 'DELETE FROM passkeys WHERE user_id = ?', args: [id] });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

// ── Appointments ──────────────────────────────────────────────────────────

async function getAllAppointments() {
  const r = await db.execute('SELECT * FROM appointments ORDER BY created_at DESC');
  return r.rows.map(rowToAppointment);
}

async function getAppointmentDates() {
  const r = await db.execute('SELECT date FROM appointments');
  return r.rows.map(row => ({ date: row.date }));
}

async function countAppointments() {
  const r = await db.execute('SELECT COUNT(*) as n FROM appointments');
  return Number(r.rows[0].n);
}

async function createAppointment(data) {
  const id = data.id || uuidv4();
  await db.execute({
    sql: `INSERT INTO appointments (id, name, email, phone, service, date, time, status, customer)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      data.name || '',
      data.email || '',
      data.phone || null,
      data.service || '',
      data.date || '',
      data.time || null,
      data.status || 'pendiente',
      data.customer || data.name || null,
    ],
  });
  return id;
}

async function updateAppointment(id, fields) {
  const set = [];
  const args = [];
  if (fields.customer !== undefined) { set.push('customer = ?'); args.push(fields.customer); }
  if (fields.date !== undefined)     { set.push('date = ?');     args.push(fields.date); }
  if (fields.time !== undefined)     { set.push('time = ?');     args.push(fields.time); }
  if (fields.service !== undefined)  { set.push('service = ?');  args.push(fields.service); }
  if (fields.status !== undefined)   { set.push('status = ?');   args.push(fields.status); }
  if (set.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE appointments SET ${set.join(', ')} WHERE id = ?`, args });
}

async function deleteAppointment(id) {
  await db.execute({ sql: 'DELETE FROM appointments WHERE id = ?', args: [id] });
}

// ── Events ────────────────────────────────────────────────────────────────

async function getAllEvents() {
  const r = await db.execute('SELECT * FROM events WHERE deleted_at IS NULL ORDER BY date ASC');
  return r.rows.map(rowToEvent);
}

async function countEvents() {
  const r = await db.execute('SELECT COUNT(*) as n FROM events WHERE deleted_at IS NULL');
  return Number(r.rows[0].n);
}

async function createEvent(data) {
  const id = data.id || uuidv4();
  await db.execute({
    sql: 'INSERT INTO events (id, title, date, location, description, level, type, category, lat, lng) VALUES (?,?,?,?,?,?,?,?,?,?)',
    args: [id, data.title, data.date, data.location || null, data.description || null, data.level || null, data.type || 'evento', data.category || 'club', data.lat || null, data.lng || null],
  });
  return id;
}

async function getEventById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM events WHERE id = ? AND deleted_at IS NULL', args: [id] });
  return rowToEvent(r.rows[0] || null);
}

async function updateEvent(id, fields) {
  const set = [];
  const args = [];
  if (fields.title !== undefined)       { set.push('title = ?');       args.push(fields.title); }
  if (fields.date !== undefined)        { set.push('date = ?');        args.push(fields.date); }
  if (fields.location !== undefined)    { set.push('location = ?');    args.push(fields.location); }
  if (fields.description !== undefined) { set.push('description = ?'); args.push(fields.description); }
  if (fields.type !== undefined)        { set.push('type = ?');        args.push(fields.type); }
  if (fields.category !== undefined)    { set.push('category = ?');    args.push(fields.category); }
  if (fields.lat !== undefined)         { set.push('lat = ?');         args.push(fields.lat); }
  if (fields.lng !== undefined)         { set.push('lng = ?');         args.push(fields.lng); }
  if (set.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE events SET ${set.join(', ')} WHERE id = ?`, args });
}

async function deleteEvent(id) {
  await db.execute({ sql: `UPDATE events SET deleted_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`, args: [id] });
}

async function cancelEventAttendances(eventId) {
  await db.execute({
    sql: "UPDATE event_attendances SET status = 'cancelled' WHERE event_id = ? AND status != 'confirmed'",
    args: [eventId],
  });
}

// ── Newsletter ────────────────────────────────────────────────────────────

async function getNewsletterByEmail(email) {
  const r = await db.execute({ sql: 'SELECT id, confirmed, unsubscribe_token, confirm_token FROM newsletter WHERE email = ?', args: [email] });
  return r.rows[0] || null;
}

async function getNewsletterByToken(token) {
  const r = await db.execute({ sql: 'SELECT id, email FROM newsletter WHERE unsubscribe_token = ?', args: [token] });
  return r.rows[0] || null;
}

async function getNewsletterByConfirmToken(token) {
  const r = await db.execute({ sql: 'SELECT id, email FROM newsletter WHERE confirm_token = ?', args: [token] });
  return r.rows[0] || null;
}

async function confirmNewsletterSubscription(id) {
  await db.execute({ sql: 'UPDATE newsletter SET confirmed = 1, confirm_token = NULL WHERE id = ?', args: [id] });
}

async function getAllNewsletterSubscribers() {
  const r = await db.execute({ sql: 'SELECT id, email, confirmed, created_at FROM newsletter ORDER BY created_at DESC', args: [] });
  return r.rows;
}

async function getConfirmedNewsletterSubscribers() {
  const r = await db.execute({ sql: 'SELECT email, unsubscribe_token FROM newsletter WHERE confirmed = 1', args: [] });
  return r.rows;
}

async function createNewsletter(email) {
  const unsubToken   = uuidv4();
  const confirmToken = uuidv4();
  await db.execute({
    sql: 'INSERT OR IGNORE INTO newsletter (id, email, unsubscribe_token, confirm_token, confirmed) VALUES (?,?,?,?,0)',
    args: [uuidv4(), email, unsubToken, confirmToken],
  });
  const r = await db.execute({ sql: 'SELECT unsubscribe_token, confirm_token FROM newsletter WHERE email = ?', args: [email] });
  return r.rows[0] || { unsubscribe_token: unsubToken, confirm_token: confirmToken };
}

async function deleteNewsletterByToken(token) {
  await db.execute({ sql: 'DELETE FROM newsletter WHERE unsubscribe_token = ?', args: [token] });
}

async function deleteNewsletterByEmail(email) {
  await db.execute({ sql: 'DELETE FROM newsletter WHERE email = ?', args: [email] });
}

async function createNewsletterCampaign(subject, bodyHtml, sentCount) {
  await db.execute({
    sql: 'INSERT INTO newsletter_campaigns (id, subject, body_html, sent_count) VALUES (?,?,?,?)',
    args: [uuidv4(), subject, bodyHtml, sentCount],
  });
}

async function getAllNewsletterCampaigns() {
  const r = await db.execute({ sql: 'SELECT id, subject, sent_count, sent_at FROM newsletter_campaigns ORDER BY sent_at DESC', args: [] });
  return r.rows;
}

async function ensureNewsletterTokens() {
  const r = await db.execute({ sql: 'SELECT id FROM newsletter WHERE unsubscribe_token IS NULL', args: [] });
  for (const row of r.rows) {
    await db.execute({ sql: 'UPDATE newsletter SET unsubscribe_token = ?, confirmed = 1 WHERE id = ?', args: [uuidv4(), row.id] });
  }
}

// ── Enrollments ───────────────────────────────────────────────────────────

async function createEnrollment(data) {
  await db.execute({
    sql: 'INSERT INTO enrollments (id, slug, course_title, name, email, phone, notes) VALUES (?,?,?,?,?,?,?)',
    args: [data.id || uuidv4(), data.slug, data.courseTitle || null, data.name, data.email, data.phone || null, data.notes || null],
  });
}

// ── Job Applications ──────────────────────────────────────────────────────

async function createJobApplication(data) {
  await db.execute({
    sql: 'INSERT INTO job_applications (id, name, email, phone, experience, skills, message) VALUES (?,?,?,?,?,?,?)',
    args: [data.id || uuidv4(), data.name, data.email, data.phone || null, data.experience || null, data.skills || null, data.message || null],
  });
}

// ── Orders ────────────────────────────────────────────────────────────────

function rowToOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    boldOrderId: row.bold_order_id,
    boldPaymentId: row.bold_payment_id,
    status: row.status,
    total: Number(row.total) || 0,
    items: safeJson(row.items, []),
    customerName: row.customer_name,
    customerEmail: row.customer_email,
    customerPhone: row.customer_phone,
    customerAddress: row.customer_address,
    customerCity: row.customer_city,
    createdAt: row.created_at,
  };
}

async function createOrder(data) {
  const id = data.id || uuidv4();
  await db.execute({
    sql: `INSERT INTO orders
            (id, user_id, bold_order_id, status, total, items,
             customer_name, customer_email, customer_phone, customer_address, customer_city)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      data.userId || null,
      data.boldOrderId || null,
      data.status || 'pending',
      data.total || 0,
      JSON.stringify(data.items || []),
      data.customerName || '',
      data.customerEmail || '',
      data.customerPhone || null,
      data.customerAddress || null,
      data.customerCity || null,
    ],
  });
  return id;
}

async function updateOrderStatus(id, status, boldPaymentId) {
  await db.execute({
    sql: 'UPDATE orders SET status = ?, bold_payment_id = ? WHERE id = ?',
    args: [status, boldPaymentId || null, id],
  });
}

async function claimStockDecrement(id) {
  const r = await db.execute({
    sql: 'UPDATE orders SET stock_decremented = 1 WHERE id = ? AND stock_decremented = 0',
    args: [id],
  });
  return (r.rowsAffected ?? r.changes ?? 0) > 0;
}

async function getOrderById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM orders WHERE id = ?', args: [id] });
  return rowToOrder(r.rows[0] || null);
}

async function getAllOrders() {
  const r = await db.execute('SELECT * FROM orders ORDER BY created_at DESC');
  return r.rows.map(rowToOrder);
}

// Listado paginado de pedidos de tienda (opcionalmente filtrado por estado).
async function getOrdersPage({ page = 1, size = 25, status = '' } = {}) {
  const where = status ? 'status = ?' : '';
  const args  = status ? [status] : [];
  return paginate('orders', { where, args, page, size, map: rowToOrder });
}

// KPI del listado de pedidos agregados en SQL (independientes de la página):
// conteo por estado + total recaudado (pagados).
async function getOrderStats() {
  const r = await db.execute(`
    SELECT
      SUM(CASE WHEN status = 'pending'              THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'pending_confirmation' THEN 1 ELSE 0 END) AS pending_confirmation,
      SUM(CASE WHEN status = 'paid'                 THEN 1 ELSE 0 END) AS paid,
      SUM(CASE WHEN status = 'failed'               THEN 1 ELSE 0 END) AS failed,
      COALESCE(SUM(CASE WHEN status = 'paid' THEN total ELSE 0 END), 0) AS total_recaudado
    FROM orders
  `);
  const row = r.rows[0] || {};
  return {
    pending:              Number(row.pending)              || 0,
    pending_confirmation: Number(row.pending_confirmation) || 0,
    paid:                 Number(row.paid)                 || 0,
    failed:               Number(row.failed)               || 0,
    totalRecaudado:       Number(row.total_recaudado)      || 0,
  };
}

async function getOrdersByUser(userId) {
  const r = await db.execute({
    sql: 'SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });
  return r.rows.map(rowToOrder);
}

async function countOrders() {
  const r = await db.execute('SELECT COUNT(*) as n FROM orders');
  return Number(r.rows[0].n);
}

// ── Score ─────────────────────────────────────────────────────────────────

async function addUserScore(userId, points, concept, description) {
  const tx = await db.transaction('write');
  try {
    const r = await tx.execute({
      sql: 'SELECT score, score_history FROM users WHERE id = ? AND deleted_at IS NULL',
      args: [userId],
    });
    if (!r.rows[0]) { await tx.rollback(); return; }
    const row        = r.rows[0];
    const newScore   = (Number(row.score) || 0) + points;
    const entry      = { date: hoyCO(), points, concept, description };
    const history    = [entry, ...safeJson(row.score_history, [])].slice(0, 100);
    await tx.execute({
      sql: 'UPDATE users SET score = ?, score_history = ? WHERE id = ?',
      args: [newScore, JSON.stringify(history), userId],
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function getLeaderboard(limit = 10) {
  const r = await db.execute({
    sql: 'SELECT id, name, nickname, score FROM users WHERE role != ? AND deleted_at IS NULL ORDER BY score DESC LIMIT ?',
    args: ['admin', limit],
  });
  return r.rows.map(row => ({
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    score: Number(row.score) || 0,
  }));
}

async function getUserRank(userId, userScore) {
  const r = await db.execute({
    sql: 'SELECT COUNT(*) AS ahead FROM users WHERE score > ? AND deleted_at IS NULL AND role != ?',
    args: [userScore || 0, 'admin'],
  });
  return Number(r.rows[0].ahead) + 1;
}

// ── Event Attendances ─────────────────────────────────────────────────────

async function registerEventAttendance(eventId, userId) {
  try {
    await db.execute({
      sql: 'INSERT INTO event_attendances (id, event_id, user_id, status) VALUES (?,?,?,?)',
      args: [uuidv4(), eventId, userId, 'pending'],
    });
    return true;
  } catch {
    return false; // already registered (UNIQUE constraint)
  }
}

async function hasUserAttendedEvent(eventId, userId) {
  const r = await db.execute({
    sql: 'SELECT id FROM event_attendances WHERE event_id = ? AND user_id = ?',
    args: [eventId, userId],
  });
  return r.rows.length > 0;
}

async function getEventAttendances(eventId) {
  const r = await db.execute({
    sql: `SELECT ea.id, ea.user_id, ea.status, ea.registered_at, u.name, u.nickname
          FROM event_attendances ea
          JOIN users u ON u.id = ea.user_id
          WHERE ea.event_id = ?
          ORDER BY ea.registered_at ASC`,
    args: [eventId],
  });
  return r.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    status: row.status,
    registeredAt: row.registered_at,
    name: row.name,
    nickname: row.nickname,
  }));
}

async function getAttendanceById(attendanceId) {
  const r = await db.execute({
    sql: 'SELECT id, event_id, user_id, status FROM event_attendances WHERE id = ?',
    args: [attendanceId],
  });
  return r.rows[0] || null;
}

async function confirmEventAttendance(attendanceId) {
  await db.execute({
    sql: 'UPDATE event_attendances SET status = ? WHERE id = ?',
    args: ['confirmed', attendanceId],
  });
}

async function getUpcomingEvents(limit = 6) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await db.execute({
    sql: 'SELECT * FROM events WHERE date >= ? AND deleted_at IS NULL ORDER BY date ASC LIMIT ?',
    args: [today, limit],
  });
  return r.rows.map(rowToEvent);
}

async function getUserEventRegistrations(userId) {
  const r = await db.execute({
    sql: 'SELECT event_id, status FROM event_attendances WHERE user_id = ?',
    args: [userId],
  });
  const map = {};
  r.rows.forEach(row => { map[row.event_id] = row.status; });
  return map;
}

// ── Quotations ────────────────────────────────────────────────────────────

function fmtConsecutiveLabel(consecutive, createdAt) {
  const d  = createdAt ? new Date(createdAt) : new Date();
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(2);
  return `${dd}${mm}${yy}-${String(consecutive).padStart(4, '0')}`;
}

async function getNextQuotationConsecutive() {
  const r = await db.execute('SELECT COALESCE(MAX(consecutive), 0) + 1 AS next FROM quotations');
  return Number(r.rows[0].next);
}

function rowToQuotation(row) {
  if (!row) return null;
  const consecutive = Number(row.consecutive);
  return {
    id: row.id,
    consecutive,
    label: fmtConsecutiveLabel(consecutive, row.created_at),
    items: safeJson(row.items, []),
    total: Number(row.total),
    clientPhone: row.client_phone,
    clientPhoneCountry: row.client_phone_country,
    motorcycle: row.motorcycle || null,
    plate: row.plate || null,
    notes: row.notes || null,
    status: row.status,
    createdAt: row.created_at,
  };
}

async function createQuotation(data) {
  const id  = data.id || uuidv4();
  const now = new Date().toISOString();
  let consecutive, label;
  const tx = await db.transaction('write');
  try {
    const r = await tx.execute('SELECT COALESCE(MAX(consecutive), 0) + 1 AS next FROM quotations');
    consecutive = Number(r.rows[0].next);
    label = fmtConsecutiveLabel(consecutive, now);
    await tx.execute({
      sql: `INSERT INTO quotations (id, consecutive, items, total, client_phone, client_phone_country, motorcycle, plate, notes, status)
            VALUES (?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id, consecutive,
        JSON.stringify(data.items || []),
        data.total || 0,
        data.clientPhone || null,
        data.clientPhoneCountry || '+57',
        data.motorcycle || null,
        data.plate || null,
        data.notes || null,
        data.status || 'confirmed',
      ],
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return { id, consecutive, label };
}

// Update an existing quotation (draft autosave or editing a confirmed one).
// Only the provided fields are touched. Accepts camelCase keys.
async function updateQuotation(id, fields) {
  const map = {
    items: ['items', v => JSON.stringify(v || [])],
    total: ['total', v => Number(v) || 0],
    clientPhone: ['client_phone', v => v || null],
    clientPhoneCountry: ['client_phone_country', v => v || '+57'],
    motorcycle: ['motorcycle', v => v || null],
    plate: ['plate', v => v || null],
    notes: ['notes', v => v || null],
    status: ['status', v => v],
  };
  const sets = [];
  const args = [];
  for (const [key, [col, transform]] of Object.entries(map)) {
    if (key in fields) { sets.push(`${col} = ?`); args.push(transform(fields[key])); }
  }
  if (!sets.length) return;
  args.push(id);
  await db.execute({ sql: `UPDATE quotations SET ${sets.join(', ')} WHERE id = ?`, args });
}

async function getDraftQuotations(limit = 15) {
  const r = await db.execute({
    sql: `SELECT * FROM quotations WHERE status = 'draft' ORDER BY created_at DESC LIMIT ?`,
    args: [limit],
  });
  return r.rows.map(rowToQuotation);
}

async function getQuotationById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM quotations WHERE id = ?', args: [id] });
  return rowToQuotation(r.rows[0] || null);
}

async function updateQuotationPhone(id, clientPhone, clientPhoneCountry) {
  await db.execute({
    sql: 'UPDATE quotations SET client_phone = ?, client_phone_country = ? WHERE id = ?',
    args: [clientPhone || null, clientPhoneCountry || '+57', id],
  });
}

async function getAllQuotations() {
  const r = await db.execute("SELECT * FROM quotations WHERE status != 'draft' ORDER BY created_at DESC");
  return r.rows.map(rowToQuotation);
}

// Ids de cotizaciones que ya se convirtieron en orden y/o factura. Devuelve solo
// esa columna (no filas completas) para el resumen de conversión: evita cargar
// service_orders/invoices enteras —con sus blobs de ítems— solo para leer un id.
async function getConvertedQuotationIds() {
  const [ordR, invR] = await Promise.all([
    db.execute('SELECT DISTINCT quotation_id FROM service_orders WHERE quotation_id IS NOT NULL'),
    db.execute('SELECT DISTINCT quotation_id FROM invoices WHERE quotation_id IS NOT NULL'),
  ]);
  return {
    orderQids:   new Set(ordR.rows.map(x => x.quotation_id)),
    invoiceQids: new Set(invR.rows.map(x => x.quotation_id)),
  };
}

async function getQuotationsByMotorcyclePlates(plates) {
  if (!plates || plates.length === 0) return [];
  // La placa vive en la columna `plate`. En cotizaciones antiguas (anteriores a
  // separar la columna) podía venir embebida en `motorcycle`, así que buscamos
  // en ambas para no perder ese historial.
  const conditions = plates.map(() =>
    "(UPPER(REPLACE(plate, ' ', '')) LIKE ? OR UPPER(REPLACE(motorcycle, ' ', '')) LIKE ?)"
  ).join(' OR ');
  const args = [];
  for (const p of plates) {
    const needle = '%' + p.toUpperCase().replace(/\s/g, '') + '%';
    args.push(needle, needle);
  }
  const r = await db.execute({
    sql: `SELECT * FROM quotations WHERE status != 'draft' AND (plate IS NOT NULL OR motorcycle IS NOT NULL) AND (${conditions}) ORDER BY created_at DESC`,
    args,
  });
  return r.rows.map(rowToQuotation);
}

async function countQuotations() {
  const r = await db.execute("SELECT COUNT(*) as n FROM quotations WHERE status != 'draft'");
  return Number(r.rows[0].n);
}

async function deleteQuotation(id) {
  await db.execute({ sql: 'DELETE FROM quotations WHERE id = ?', args: [id] });
}

// ── Service Orders ────────────────────────────────────────────────────────

function fmtLabel(prefix, consecutive, createdAt) {
  const d  = createdAt ? new Date(createdAt) : new Date();
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
  const yy = String(d.getUTCFullYear()).slice(2);
  return `${prefix}${dd}${mm}${yy}-${String(consecutive).padStart(4, '0')}`;
}

function rowToServiceOrder(row) {
  if (!row) return null;
  return {
    id: row.id,
    consecutive: Number(row.consecutive),
    label: row.label,
    quotationId: row.quotation_id,
    items: safeJson(row.items, []),
    total: Number(row.total),
    motorcycle: row.motorcycle || null,
    clientPhone: row.client_phone,
    clientPhoneCountry: row.client_phone_country,
    mechanic: row.mechanic || null,
    status: row.status,
    notes: row.notes || null,
    estimatedDate: row.estimated_date || null,
    invoiceId: row.invoice_id || null,
    employeeId: row.employee_id || null,
    pendingReview: Number(row.pending_review) === 1,
    trabajoCompletoAt: row.trabajo_completo_at || null,
    deliveredAt: row.delivered_at || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createServiceOrder(data) {
  const id  = data.id || uuidv4();
  const now = new Date().toISOString();
  let consecutive, label;
  const tx = await db.transaction('write');
  try {
    const r = await tx.execute('SELECT COALESCE(MAX(consecutive), 0) + 1 AS next FROM service_orders');
    consecutive = Number(r.rows[0].next);
    label = fmtLabel('OS-', consecutive, now);
    await tx.execute({
      sql: `INSERT INTO service_orders
            (id, consecutive, label, quotation_id, items, total, motorcycle, client_phone, client_phone_country, mechanic, status, notes, estimated_date, employee_id)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id, consecutive, label,
        data.quotationId || null,
        JSON.stringify(data.items || []),
        data.total || 0,
        data.motorcycle || null,
        data.clientPhone || null,
        data.clientPhoneCountry || '+57',
        data.mechanic || null,
        data.status || 'ingreso_taller',
        data.notes || null,
        data.estimatedDate || null,
        data.employeeId || null,
      ],
    });
    // Primer evento de la línea de tiempo: el estado con que nace la orden.
    await tx.execute({
      sql: `INSERT INTO service_order_events (id, service_order_id, status, actor, created_at)
            VALUES (?,?,?,?,?)`,
      args: [uuidv4(), id, data.status || 'ingreso_taller', data.actor || null, now],
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return { id, consecutive, label };
}

async function getServiceOrderById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM service_orders WHERE id = ?', args: [id] });
  return rowToServiceOrder(r.rows[0] || null);
}

async function getAllServiceOrders() {
  const r = await db.execute('SELECT * FROM service_orders ORDER BY created_at DESC');
  return r.rows.map(rowToServiceOrder);
}

// Listado paginado (opcionalmente filtrado por estado) para el panel admin.
async function getServiceOrdersPage({ page = 1, size = 25, status = '' } = {}) {
  const where = status ? 'status = ?' : '';
  const args  = status ? [status] : [];
  return paginate('service_orders', { where, args, page, size, map: rowToServiceOrder });
}

// Conteo por estado con una sola query (para los KPI del listado, que deben
// reflejar el total y no solo la página visible).
async function getServiceOrderStatusCounts() {
  const r = await db.execute('SELECT status, COUNT(*) AS n FROM service_orders GROUP BY status');
  const out = {};
  r.rows.forEach(row => { out[row.status] = Number(row.n); });
  return out;
}

async function updateServiceOrder(id, fields, actor) {
  // Si se cambia el estado, registramos un evento de trazabilidad — pero solo
  // cuando es un cambio real (distinto al estado actual), para no llenar la
  // línea de tiempo de duplicados al guardar otros campos.
  let logStatus = null;
  if (fields.status !== undefined) {
    const cur = await db.execute({ sql: 'SELECT status FROM service_orders WHERE id = ?', args: [id] });
    const prev = cur.rows[0]?.status;
    if (prev !== undefined && prev !== fields.status) logStatus = fields.status;
  }

  const set = [], args = [];
  if (fields.items         !== undefined) { set.push('items = ?');          args.push(JSON.stringify(fields.items)); }
  if (fields.total         !== undefined) { set.push('total = ?');          args.push(fields.total); }
  if (fields.motorcycle    !== undefined) { set.push('motorcycle = ?');     args.push(fields.motorcycle); }
  if (fields.clientPhone        !== undefined) { set.push('client_phone = ?');         args.push(fields.clientPhone); }
  if (fields.clientPhoneCountry !== undefined) { set.push('client_phone_country = ?'); args.push(fields.clientPhoneCountry); }
  if (fields.mechanic      !== undefined) { set.push('mechanic = ?');       args.push(fields.mechanic); }
  if (fields.status        !== undefined) { set.push('status = ?');         args.push(fields.status); }
  if (fields.notes         !== undefined) { set.push('notes = ?');          args.push(fields.notes); }
  if (fields.estimatedDate !== undefined) { set.push('estimated_date = ?'); args.push(fields.estimatedDate); }
  if (fields.invoiceId          !== undefined) { set.push('invoice_id = ?');           args.push(fields.invoiceId); }
  if (fields.employeeId         !== undefined) { set.push('employee_id = ?');          args.push(fields.employeeId); }
  if (fields.pendingReview      !== undefined) { set.push('pending_review = ?');       args.push(fields.pendingReview ? 1 : 0); }
  if (fields.trabajoCompletoAt  !== undefined) { set.push('trabajo_completo_at = ?');  args.push(fields.trabajoCompletoAt); }
  if (fields.deliveredAt        !== undefined) { set.push('delivered_at = ?');         args.push(fields.deliveredAt); }
  if (set.length === 0) return;
  set.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  await db.execute({ sql: `UPDATE service_orders SET ${set.join(', ')} WHERE id = ?`, args });

  if (logStatus) {
    await db.execute({
      sql: `INSERT INTO service_order_events (id, service_order_id, status, actor, created_at)
            VALUES (?,?,?,?,?)`,
      args: [uuidv4(), id, logStatus, actor || null, new Date().toISOString()],
    });
  }
}

// Eventos de trazabilidad de una orden, en orden cronológico ascendente.
async function getServiceOrderEvents(serviceOrderId) {
  const r = await db.execute({
    sql: 'SELECT * FROM service_order_events WHERE service_order_id = ? ORDER BY created_at ASC',
    args: [serviceOrderId],
  });
  return r.rows.map(row => ({
    id: row.id,
    status: row.status,
    actor: row.actor || null,
    detail: row.detail || null,
    createdAt: row.created_at,
  }));
}

// Registra un hito arbitrario en la trazabilidad de una orden (p. ej. 'editado'),
// sin tocar el estado actual. Lo usan las acciones que no son cambios de estado
// pero que igual conviene dejar en la línea de tiempo.
async function addServiceOrderEvent(serviceOrderId, status, actor, detail = null, createdAt = null) {
  await db.execute({
    sql: `INSERT INTO service_order_events (id, service_order_id, status, actor, detail, created_at)
          VALUES (?,?,?,?,?,?)`,
    args: [uuidv4(), serviceOrderId, status, actor || null, detail || null, createdAt || new Date().toISOString()],
  });
}

// Reconciliación única: desliga las órdenes que quedaron atadas a una factura
// ya anulada (anteriores al deslinde automático). Deja intacta la trazabilidad
// —rellena 'factura_generada' si falta y marca 'factura_anulada'— y devuelve la
// orden a 'trabajo_completo' para que salga bien en listados y vuelva a editarse.
// Es idempotente: una vez desligada, el JOIN ya no la selecciona.
// Deslinde atómico: pone invoice_id=NULL y estado 'trabajo_completo' SOLO si la
// orden sigue apuntando a esa factura. Devuelve true si esta llamada fue la que
// realmente la desligó (rowsAffected>0). Sirve de "claim": ante ejecuciones
// concurrentes (dos cold starts / dos requests), solo una gana y registra hitos.
async function detachOrderFromInvoice(orderId, invoiceId) {
  const r = await db.execute({
    sql: `UPDATE service_orders SET invoice_id = NULL, status = 'trabajo_completo', updated_at = ?
          WHERE id = ? AND invoice_id = ?`,
    args: [new Date().toISOString(), orderId, invoiceId],
  });
  // El cliente libSQL expone el conteo como rowsAffected o changes según versión
  // (mismo criterio que claimStockDecrement); se toleran ambos.
  return (r.rowsAffected ?? r.changes ?? 0) > 0;
}

async function reconcileAnnulledInvoices() {
  const r = await db.execute(`
    SELECT so.id AS order_id, i.id AS invoice_id, i.label AS invoice_label, i.created_at AS invoice_created
    FROM service_orders so
    JOIN invoices i ON so.invoice_id = i.id
    WHERE i.status = 'anulada'
  `);
  let n = 0;
  for (const row of r.rows) {
    const orderId = row.order_id;
    // Claim atómico primero: si otra ejecución ya la desligó, se salta (sin
    // duplicar hitos).
    if (!(await detachOrderFromInvoice(orderId, row.invoice_id))) continue;
    n++;
    const evs = await db.execute({ sql: 'SELECT status FROM service_order_events WHERE service_order_id = ?', args: [orderId] });
    const has = s => evs.rows.some(e => e.status === s);
    if (!has('factura_generada')) {
      await addServiceOrderEvent(orderId, 'factura_generada', null, row.invoice_label, row.invoice_created);
    }
    await addServiceOrderEvent(orderId, 'factura_anulada', 'Sistema', row.invoice_label);
    await addServiceOrderEvent(orderId, 'trabajo_completo', 'Sistema'); // cambio de estado
  }
  if (n) console.log(`✅ Reconciliadas ${n} orden(es) atadas a facturas anuladas`);
}

// Reconciliación (v14): repara las órdenes que quedaron inconsistentes por
// (a) auto-facturaciones interrumpidas en serverless —orden 'facturado' con
// invoice_id apuntando a una factura que nunca se insertó— y (b) devoluciones
// de estado hechas sin desligar la proforma —orden en estado editable con
// proforma viva, imposible de entregar—. Idempotente: una vez reparadas, las
// consultas no vuelven a seleccionarlas.
async function reconcileOrderInvoiceLinks() {
  // (a) Vínculos rotos: se limpia el id y, si la orden quedó 'facturado', se
  // devuelve a 'trabajo_completo' para que el flujo normal re-facture.
  const dangling = await db.execute(`
    SELECT so.id, so.status FROM service_orders so
    LEFT JOIN invoices i ON i.id = so.invoice_id
    WHERE so.invoice_id IS NOT NULL AND i.id IS NULL
  `);
  for (const row of dangling.rows) {
    const backTo = row.status === 'facturado' ? 'trabajo_completo' : row.status;
    await db.execute({
      sql: 'UPDATE service_orders SET invoice_id = NULL, status = ?, updated_at = ? WHERE id = ?',
      args: [backTo, new Date().toISOString(), row.id],
    });
    await addServiceOrderEvent(row.id, 'editado', 'Sistema', 'Vínculo a factura inexistente eliminado');
    if (backTo !== row.status) await addServiceOrderEvent(row.id, 'trabajo_completo', 'Sistema');
  }
  // (b) Proforma viva con la orden devuelta: si los totales siguen cuadrando,
  // se restaura 'facturado' (la proforma sigue válida y no se quema un
  // consecutivo); si divergieron, se anula la proforma y se desliga.
  const stuck = await db.execute(`
    SELECT so.id AS order_id, so.total, i.id AS invoice_id, i.label, i.subtotal
    FROM service_orders so JOIN invoices i ON i.id = so.invoice_id
    WHERE i.status = 'proforma' AND so.status NOT IN ('facturado','entregado')
  `);
  for (const row of stuck.rows) {
    if (Number(row.total) === Number(row.subtotal)) {
      await db.execute({
        sql: `UPDATE service_orders SET status = 'facturado', updated_at = ? WHERE id = ? AND invoice_id = ?`,
        args: [new Date().toISOString(), row.order_id, row.invoice_id],
      });
      await addServiceOrderEvent(row.order_id, 'facturado', 'Sistema', `Estado restaurado (proforma ${row.label} vigente)`);
    } else {
      await db.execute({
        sql: `UPDATE invoices SET status = 'anulada', paid_at = NULL WHERE id = ? AND status = 'proforma'`,
        args: [row.invoice_id],
      });
      await detachOrderFromInvoice(row.order_id, row.invoice_id);
      await addServiceOrderEvent(row.order_id, 'factura_anulada', 'Sistema', row.label);
      await addServiceOrderEvent(row.order_id, 'trabajo_completo', 'Sistema');
    }
  }
  const n = dangling.rows.length + stuck.rows.length;
  if (n) console.log(`✅ Reconciliadas ${n} orden(es) con vínculos de factura inconsistentes`);
}

// Borrado permanente de una orden de servicio y su historial de eventos.
// No toca facturas: la ruta bloquea el borrado de órdenes ya facturadas para
// no dejar facturas huérfanas (la contabilidad es el registro legal).
async function deleteServiceOrder(id) {
  const tx = await db.transaction('write');
  try {
    await tx.execute({ sql: 'DELETE FROM service_order_events WHERE service_order_id = ?', args: [id] });
    await tx.execute({ sql: 'DELETE FROM service_orders WHERE id = ?', args: [id] });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
}

async function updateServiceOrderPhone(id, clientPhone, clientPhoneCountry) {
  await db.execute({
    sql: 'UPDATE service_orders SET client_phone = ?, client_phone_country = ?, updated_at = ? WHERE id = ?',
    args: [clientPhone || null, clientPhoneCountry || '+57', new Date().toISOString(), id],
  });
}

async function countServiceOrders() {
  const r = await db.execute("SELECT COUNT(*) as n FROM service_orders WHERE status != 'facturado'");
  return Number(r.rows[0].n);
}

// Órdenes asignadas a un empleado (excluye las ya facturadas/entregadas para el portal del taller).
async function getServiceOrdersByEmployee(employeeId) {
  const r = await db.execute({
    sql: `SELECT * FROM service_orders
          WHERE employee_id = ? AND status NOT IN ('facturado','entregado')
          ORDER BY created_at DESC`,
    args: [employeeId],
  });
  return r.rows.map(rowToServiceOrder);
}

// Todas las órdenes activas del taller (cualquier empleado), para el tablero KDS.
async function getActiveServiceOrders() {
  const r = await db.execute(
    `SELECT * FROM service_orders
     WHERE status NOT IN ('facturado','entregado')
     ORDER BY created_at DESC`
  );
  return r.rows.map(rowToServiceOrder);
}

// Órdenes finalizadas por un empleado, pendientes de revisión del admin (alimenta el badge).
async function countPendingReviewOrders() {
  const r = await db.execute("SELECT COUNT(*) as n FROM service_orders WHERE pending_review = 1");
  return Number(r.rows[0].n);
}

// ── Empleados ───────────────────────────────────────────────────────────────

function rowToEmployee(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    pinHash: row.pin_hash,
    userId: row.user_id || null,
    active: Number(row.active) === 1,
    createdAt: row.created_at,
  };
}

async function createEmployee(data) {
  const id = data.id || uuidv4();
  // Empleados ligados a un usuario de la web entran con su contraseña, no con PIN:
  // guardamos pin_hash vacío (la columna es NOT NULL) y el user_id correspondiente.
  await db.execute({
    sql: 'INSERT INTO employees (id, name, pin_hash, active, user_id) VALUES (?,?,?,?,?)',
    args: [id, data.name, data.pinHash || '', data.active === false ? 0 : 1, data.userId || null],
  });
  return { id };
}

async function getAllEmployees() {
  const r = await db.execute('SELECT * FROM employees ORDER BY created_at DESC');
  return r.rows.map(rowToEmployee);
}

async function getActiveEmployees() {
  const r = await db.execute('SELECT * FROM employees WHERE active = 1 ORDER BY name COLLATE NOCASE ASC');
  return r.rows.map(rowToEmployee);
}

async function getEmployeeById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM employees WHERE id = ?', args: [id] });
  return rowToEmployee(r.rows[0] || null);
}

async function getEmployeeByUserId(userId) {
  const r = await db.execute({ sql: 'SELECT * FROM employees WHERE user_id = ?', args: [userId] });
  return rowToEmployee(r.rows[0] || null);
}

async function updateEmployee(id, fields) {
  const set = [], args = [];
  if (fields.name    !== undefined) { set.push('name = ?');     args.push(fields.name); }
  if (fields.pinHash !== undefined) { set.push('pin_hash = ?'); args.push(fields.pinHash); }
  if (fields.userId  !== undefined) { set.push('user_id = ?');  args.push(fields.userId); }
  if (fields.active  !== undefined) { set.push('active = ?');   args.push(fields.active ? 1 : 0); }
  if (set.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE employees SET ${set.join(', ')} WHERE id = ?`, args });
}

async function deleteEmployee(id) {
  await db.execute({ sql: 'DELETE FROM employees WHERE id = ?', args: [id] });
}

// ── Throttle anti fuerza bruta (global, persistido) ──────────────────────────
// El login por PIN del taller tiene poca entropía (4–6 dígitos) y no identifica
// al empleado, así que un límite por-IP no frena un ataque distribuido. Llevamos
// un contador global en BD que sí funciona entre instancias serverless.

async function isThrottleLocked(key, limit, windowMs) {
  const r = await db.execute({ sql: 'SELECT count, window_start FROM security_throttle WHERE key = ?', args: [key] });
  const row = r.rows[0];
  if (!row) return false;
  const withinWindow = Date.now() - Number(row.window_start) <= windowMs;
  return withinWindow && Number(row.count) >= limit;
}

async function recordThrottleFailure(key, windowMs) {
  const now = Date.now();
  const r = await db.execute({ sql: 'SELECT window_start FROM security_throttle WHERE key = ?', args: [key] });
  const row = r.rows[0];
  if (!row || now - Number(row.window_start) > windowMs) {
    // Ventana nueva (o primera vez): reinicia el contador en 1.
    await db.execute({
      sql: `INSERT INTO security_throttle (key, count, window_start) VALUES (?, 1, ?)
            ON CONFLICT(key) DO UPDATE SET count = 1, window_start = excluded.window_start`,
      args: [key, now],
    });
  } else {
    await db.execute({ sql: 'UPDATE security_throttle SET count = count + 1 WHERE key = ?', args: [key] });
  }
}

// ── App settings (configuración editable del admin) ─────────────────────────
// Reemplazan los archivos JSON en /data que no persistían en serverless.

async function getAllSettings() {
  const r = await db.execute('SELECT key, value FROM app_settings');
  return r.rows.map(row => ({ key: row.key, value: row.value }));
}

async function setSetting(key, value) {
  await db.execute({
    sql: `INSERT INTO app_settings (key, value) VALUES (?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value,
            updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    args: [key, value],
  });
}

// ── Invoices ──────────────────────────────────────────────────────────────

function rowToInvoice(row) {
  if (!row) return null;
  return {
    id: row.id,
    consecutive: Number(row.consecutive),
    label: row.label,
    serviceOrderId: row.service_order_id,
    quotationId: row.quotation_id,
    items: safeJson(row.items, []),
    subtotal: Number(row.subtotal),
    tax: Number(row.tax),
    parkingAmount: Number(row.parking_amount) || 0,
    total: Number(row.total),
    paymentMethod: row.payment_method,
    status: row.status,
    notes: row.notes || null,
    createdAt: row.created_at,
    paidAt: row.paid_at || null,
  };
}

// Convierte una orden 'trabajo_completo' en factura PROFORMA. El claim de la
// orden y la emisión de la factura van en UNA sola transacción: si el proceso
// muere a mitad de camino (p. ej. función serverless congelada tras responder)
// no puede quedar la orden 'facturado' apuntando a una factura que nunca se
// insertó, ni consumirse un consecutivo en vano (debe quedar contiguo para la
// DIAN). Ante dos requests concurrentes (admin y KDS, o doble clic) solo una
// gana el UPDATE condicional. La factura definitiva (IVA, método de pago,
// parqueadero y estado de pago) solo se conoce al entregar la moto — ver
// deliverServiceOrder. Se dispara automáticamente al pasar una orden a
// 'trabajo_completo' (routes/kds.js, routes/taller.js, routes/admin.js) y como
// recuperación manual si la proforma se anuló.
async function convertServiceOrderToInvoice(order, { notes = null } = {}, actor) {
  if (order.invoiceId || order.status !== 'trabajo_completo') {
    throw new Error('La orden no está lista para facturar o ya tiene factura.');
  }
  const invoiceId = uuidv4();
  const now = new Date().toISOString();
  let invoiceLabel;
  const tx = await db.transaction('write');
  try {
    const claim = await tx.execute({
      sql: `UPDATE service_orders
            SET invoice_id = ?, status = 'facturado', pending_review = 0, updated_at = ?
            WHERE id = ? AND invoice_id IS NULL AND status = 'trabajo_completo'`,
      args: [invoiceId, now, order.id],
    });
    if ((claim.rowsAffected ?? claim.changes ?? 0) === 0) {
      throw new Error('La orden ya fue facturada por otra operación.');
    }
    const r = await tx.execute('SELECT COALESCE(MAX(consecutive), 0) + 1 AS next FROM invoices');
    const consecutive = Number(r.rows[0].next);
    invoiceLabel = fmtLabel('F-', consecutive, now);
    const subtotal = order.total || 0;
    await tx.execute({
      sql: `INSERT INTO invoices
            (id, consecutive, label, service_order_id, quotation_id, items, subtotal, tax, parking_amount, total, payment_method, status, notes, paid_at)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        invoiceId, consecutive, invoiceLabel,
        order.id, order.quotationId || null,
        JSON.stringify(order.items || []),
        subtotal, 0, 0, subtotal,
        'efectivo', 'proforma', notes || null, null,
      ],
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  await addServiceOrderEvent(order.id, 'facturado', actor);          // cambio de estado
  await addServiceOrderEvent(order.id, 'factura_generada', actor, invoiceLabel);
  return { invoiceId, invoiceLabel };
}

// Devuelve una orden facturada a un estado editable: anula su proforma y la
// desliga (la orden vuelve a poder editarse y, al re-completarla, se emite una
// proforma nueva). Solo aplica a proformas o vínculos rotos; una factura ya
// cerrada al entregar (pendiente/pagada) no se toca — devolver esa orden
// duplicaría el ingreso. Devuelve { ok, reason }.
async function revertServiceOrderInvoice(order, actor) {
  if (!order.invoiceId) return { ok: true, reason: 'sin-factura' };
  const invoice = await getInvoiceById(order.invoiceId);
  // Vínculo roto (la factura nunca llegó a insertarse): basta limpiar el id.
  if (!invoice) {
    await db.execute({
      sql: 'UPDATE service_orders SET invoice_id = NULL, updated_at = ? WHERE id = ? AND invoice_id = ?',
      args: [new Date().toISOString(), order.id, order.invoiceId],
    });
    await addServiceOrderEvent(order.id, 'editado', actor, 'Vínculo a factura inexistente eliminado');
    return { ok: true, reason: 'colgante' };
  }
  if (invoice.status === 'proforma') {
    // Claim atómico sobre la factura: si dos requests devuelven el estado a la
    // vez, solo la que realmente anula registra los hitos.
    const r = await db.execute({
      sql: `UPDATE invoices SET status = 'anulada', paid_at = NULL WHERE id = ? AND status = 'proforma'`,
      args: [invoice.id],
    });
    if ((r.rowsAffected ?? r.changes ?? 0) > 0) {
      await detachOrderFromInvoice(order.id, invoice.id);
      await addServiceOrderEvent(order.id, 'factura_anulada', actor, invoice.label);
    }
    return { ok: true, reason: 'proforma-anulada' };
  }
  if (invoice.status === 'anulada') {
    await detachOrderFromInvoice(order.id, invoice.id);
    return { ok: true, reason: 'ya-anulada' };
  }
  return { ok: false, reason: 'factura-cerrada' };
}

// Política única de cambio de estado frente a la factura de la orden, usada
// por los tres portales (admin, KDS y taller):
// - 'entregado' es terminal.
// - Repetir el estado actual o cambiar sin factura de por medio pasa directo.
// - Devolver a un estado previo con proforma viva la ANULA y desliga la orden.
// - Pedir 'trabajo_completo' con proforma vigente equivale a 'facturado' (la
//   proforma sigue siendo válida: los ítems no pueden cambiar mientras exista).
// - Una factura cerrada (pendiente/pagada) bloquea cualquier devolución.
// Devuelve { allowed, status?, invoiceDetached, msg? }; `status` ausente
// significa «no cambiar el estado, solo los demás campos».
async function applyStatusPolicy(order, newStatus, actor) {
  if (order.status === 'entregado') {
    return { allowed: false, invoiceDetached: false, msg: 'La orden ya fue entregada; su estado no puede cambiar.' };
  }
  if (newStatus === order.status || !order.invoiceId) {
    return { allowed: true, status: newStatus, invoiceDetached: false };
  }
  if (newStatus === 'trabajo_completo') {
    const invoice = await getInvoiceById(order.invoiceId);
    if (invoice && invoice.status === 'proforma') {
      // Ya hay proforma vigente: 'trabajo_completo' equivale a 'facturado'.
      return { allowed: true, status: order.status === 'facturado' ? undefined : 'facturado', invoiceDetached: false };
    }
    // Factura anulada o vínculo roto: desligar y dejar que el flujo re-facture.
    const r = await revertServiceOrderInvoice(order, actor);
    if (!r.ok) return { allowed: false, invoiceDetached: false, msg: 'La factura de esta orden ya está cerrada; no se puede cambiar su estado.' };
    return { allowed: true, status: newStatus, invoiceDetached: true };
  }
  // Estado previo al trabajo completo: anular la proforma y desligar.
  const r = await revertServiceOrderInvoice(order, actor);
  if (!r.ok) return { allowed: false, invoiceDetached: false, msg: 'La factura de esta orden ya está cerrada; no se puede devolver el estado.' };
  return { allowed: true, status: newStatus, invoiceDetached: true };
}

// Cierra la factura proforma al momento de entregar la moto: es el único
// momento en que se sabe con certeza si aplica cobro de parqueadero. Agrega
// el parqueadero y el IVA al total, fija el método de pago y el estado final
// de la factura (pendiente/pagada), y marca la orden como 'entregado'.
async function deliverServiceOrder(order, invoice, { tax = 0, parkingAmount = 0, paymentMethod = 'efectivo', paidNow = false, notes = null, deliveredAt = null } = {}, actor) {
  if (order.status !== 'facturado' || !invoice || invoice.id !== order.invoiceId || invoice.status !== 'proforma') {
    throw new Error('La orden no está lista para entregar.');
  }
  const cleanTax     = Math.max(0, Math.round(Number(tax) || 0));
  const cleanParking = Math.max(0, Math.round(Number(parkingAmount) || 0));
  const total  = invoice.subtotal + cleanTax + cleanParking;
  const status = paidNow ? 'pagada' : 'pendiente';
  const now    = new Date().toISOString();
  const paidAt = status === 'pagada' ? now : null;
  await db.execute({
    sql: `UPDATE invoices SET tax=?, parking_amount=?, total=?, payment_method=?, notes=?, status=?, paid_at=? WHERE id=?`,
    args: [cleanTax, cleanParking, total, paymentMethod || 'efectivo', notes || null, status, paidAt, invoice.id],
  });
  await updateServiceOrder(order.id, { status: 'entregado', deliveredAt: deliveredAt || now }, actor);
  await addServiceOrderEvent(order.id, 'factura_cerrada', actor, invoice.label);
  return { total };
}

async function getInvoiceById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [id] });
  return rowToInvoice(r.rows[0] || null);
}

async function getAllInvoices() {
  const r = await db.execute('SELECT * FROM invoices ORDER BY created_at DESC');
  return r.rows.map(rowToInvoice);
}

// Listado paginado (opcionalmente filtrado por estado) para el panel admin.
async function getInvoicesPage({ page = 1, size = 25, status = '' } = {}) {
  const where = status ? 'status = ?' : '';
  const args  = status ? [status] : [];
  return paginate('invoices', { where, args, page, size, map: rowToInvoice });
}

// KPI del listado de facturas agregados en SQL (independientes de la página).
async function getInvoiceStats() {
  const r = await db.execute(`
    SELECT
      SUM(CASE WHEN status = 'pendiente' THEN 1 ELSE 0 END) AS pendientes,
      SUM(CASE WHEN status = 'pagada'    THEN 1 ELSE 0 END) AS pagadas,
      COALESCE(SUM(CASE WHEN status = 'pagada' THEN total ELSE 0 END), 0) AS total_pagado
    FROM invoices
  `);
  const row = r.rows[0] || {};
  return {
    pendientes:  Number(row.pendientes)  || 0,
    pagadas:     Number(row.pagadas)     || 0,
    totalPagado: Number(row.total_pagado) || 0,
  };
}

async function updateInvoiceStatus(id, status, paymentMethod) {
  // paid_at marca cuándo se reconoció el ingreso: se sella al pasar a 'pagada'
  // (COALESCE conserva la fecha original si ya estaba pagada) y se limpia si la
  // factura sale de ese estado (pendiente/anulada no son ingreso).
  if (status === 'pagada') {
    await db.execute({
      sql: `UPDATE invoices SET status = ?, payment_method = ?, paid_at = COALESCE(paid_at, ?) WHERE id = ?`,
      args: [status, paymentMethod || 'efectivo', new Date().toISOString(), id],
    });
  } else {
    await db.execute({
      sql: `UPDATE invoices SET status = ?, payment_method = ?, paid_at = NULL WHERE id = ?`,
      args: [status, paymentMethod || 'efectivo', id],
    });
  }
}

async function countInvoices() {
  const r = await db.execute("SELECT COUNT(*) as n FROM invoices WHERE status = 'pendiente'");
  return Number(r.rows[0].n);
}

// ── Gastos ────────────────────────────────────────────────────────────────

function rowToGasto(row) {
  if (!row) return null;
  return {
    id: row.id,
    category: row.category || 'otros',
    description: row.description,
    amount: Number(row.amount) || 0,
    date: row.date,
    paymentMethod: row.payment_method,
    notes: row.notes,
    createdAt: row.created_at,
  };
}

async function createGasto(data) {
  const id = uuidv4();
  await db.execute({
    sql: `INSERT INTO gastos (id, category, description, amount, date, payment_method, notes)
          VALUES (?,?,?,?,?,?,?)`,
    args: [id, data.category || 'otros', data.description, Math.round(Number(data.amount) || 0), data.date, data.paymentMethod || 'efectivo', data.notes || null],
  });
  return { id };
}

async function getAllGastos() {
  const r = await db.execute('SELECT * FROM gastos ORDER BY date DESC, created_at DESC');
  return r.rows.map(rowToGasto);
}

async function getGastoById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM gastos WHERE id = ?', args: [id] });
  return rowToGasto(r.rows[0] || null);
}

async function updateGasto(id, data) {
  await db.execute({
    sql: 'UPDATE gastos SET category=?, description=?, amount=?, date=?, payment_method=?, notes=? WHERE id=?',
    args: [data.category || 'otros', data.description, Math.round(Number(data.amount) || 0), data.date, data.paymentMethod || 'efectivo', data.notes || null, id],
  });
}

async function deleteGasto(id) {
  await db.execute({ sql: 'DELETE FROM gastos WHERE id = ?', args: [id] });
}

// ── Passkeys ──────────────────────────────────────────────────────────────

async function getPasskeysByUserId(userId) {
  const r = await db.execute({ sql: 'SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at DESC', args: [userId] });
  return r.rows.map(row => ({
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: Number(row.counter),
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    transports: safeJson(row.transports, []),
    name: row.name || null,
    createdAt: row.created_at,
  }));
}

async function getPasskeyByCredentialId(credentialId) {
  const r = await db.execute({ sql: 'SELECT * FROM passkeys WHERE credential_id = ?', args: [credentialId] });
  if (!r.rows[0]) return null;
  const row = r.rows[0];
  return {
    id: row.id,
    userId: row.user_id,
    credentialId: row.credential_id,
    publicKey: row.public_key,
    counter: Number(row.counter),
    deviceType: row.device_type,
    backedUp: row.backed_up === 1,
    transports: safeJson(row.transports, []),
    name: row.name || null,
    createdAt: row.created_at,
  };
}

async function createPasskey(data) {
  const id = uuidv4();
  await db.execute({
    sql: `INSERT INTO passkeys (id, user_id, credential_id, public_key, counter, device_type, backed_up, transports, name)
          VALUES (?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      data.userId,
      data.credentialId,
      data.publicKey,
      data.counter || 0,
      data.deviceType || null,
      data.backedUp ? 1 : 0,
      JSON.stringify(data.transports || []),
      data.name || null,
    ],
  });
  return id;
}

async function updatePasskeyCounter(id, counter) {
  await db.execute({ sql: 'UPDATE passkeys SET counter = ? WHERE id = ?', args: [counter, id] });
}

async function deletePasskey(id, userId) {
  await db.execute({ sql: 'DELETE FROM passkeys WHERE id = ? AND user_id = ?', args: [id, userId] });
}

// ── Admin Audit Log ───────────────────────────────────────────────────────

async function logAdminAction(adminId, adminName, action, targetType, targetId, details) {
  await db.execute({
    sql: 'INSERT INTO admin_audit_log (id, admin_id, admin_name, action, target_type, target_id, details) VALUES (?,?,?,?,?,?,?)',
    args: [uuidv4(), adminId, adminName, action, targetType, targetId || null, details ? JSON.stringify(details) : null],
  });
}

async function getAdminAuditLog(limit = 100) {
  const r = await db.execute({
    sql: 'SELECT * FROM admin_audit_log ORDER BY created_at DESC LIMIT ?',
    args: [limit],
  });
  return r.rows.map(row => ({
    id: row.id,
    adminId: row.admin_id,
    adminName: row.admin_name,
    action: row.action,
    targetType: row.target_type,
    targetId: row.target_id,
    details: safeJson(row.details, null),
    createdAt: row.created_at,
  }));
}

async function getServiceOrdersByPlate(plate) {
  const r = await db.execute({
    sql: `SELECT * FROM service_orders WHERE UPPER(REPLACE(motorcycle, ' ', '')) LIKE ? ORDER BY created_at DESC`,
    args: [`%${plate.toUpperCase().replace(/\s/g, '')}%`],
  });
  return r.rows.map(rowToServiceOrder);
}

// ── Check-in de clientes (QR del mostrador) ─────────────────────────────────

function rowToCheckin(row) {
  if (!row) return null;
  return {
    id: row.id,
    clientName: row.client_name,
    clientPhone: row.client_phone,
    clientPhoneCountry: row.client_phone_country,
    plate: row.plate,
    brand: row.brand || null,
    reference: row.reference || null,
    status: row.status,
    serviceOrderId: row.service_order_id || null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createCheckin(data) {
  const id = data.id || uuidv4();
  await db.execute({
    sql: `INSERT INTO checkins (id, client_name, client_phone, client_phone_country, plate, brand, reference)
          VALUES (?,?,?,?,?,?,?)`,
    args: [
      id,
      data.clientName,
      data.clientPhone,
      data.clientPhoneCountry || '+57',
      data.plate,
      data.brand || null,
      data.reference || null,
    ],
  });
  return getCheckinById(id);
}

async function getCheckinById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM checkins WHERE id = ?', args: [id] });
  return rowToCheckin(r.rows[0] || null);
}

// Cola de check-ins sin convertir en orden, del más antiguo al más reciente
// (el que primero llegó, primero se atiende).
async function getPendingCheckins() {
  const r = await db.execute(`SELECT * FROM checkins WHERE status = 'pendiente' ORDER BY created_at ASC`);
  return r.rows.map(rowToCheckin);
}

// Búsqueda del mecánico por placa: solo entre los check-ins aún pendientes.
async function getPendingCheckinsByPlate(plate) {
  const r = await db.execute({
    sql: `SELECT * FROM checkins WHERE status = 'pendiente' AND UPPER(REPLACE(plate, ' ', '')) LIKE ? ORDER BY created_at ASC`,
    args: [`%${plate.toUpperCase().replace(/\s/g, '')}%`],
  });
  return r.rows.map(rowToCheckin);
}

async function markCheckinAttended(id, serviceOrderId) {
  await db.execute({
    sql: `UPDATE checkins SET status = 'atendido', service_order_id = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
    args: [serviceOrderId, id],
  });
}

// ── Control remoto de presentaciones (clases) ───────────────────────────────
// Emparejamiento PC↔celular por código corto. El PC crea la sesión al abrir
// /clases/:course/:topic y hace polling de slide_index; el celular la consulta
// por código y solo envía next/prev. Sin websockets (no viables en serverless).

function rowToPresentationSession(row) {
  if (!row) return null;
  return {
    code: row.code,
    course: row.course,
    topic: row.topic,
    slideIndex: Number(row.slide_index) || 0,
    slideCount: Number(row.slide_count) || 1,
    expiresAt: row.expires_at,
    updatedAt: row.updated_at,
  };
}

async function createPresentationSession(course, topic, slideCount) {
  // Limpieza perezosa: no hay cron, así que cada sesión nueva se lleva de paso
  // las que ya vencieron en vez de acumular filas muertas.
  await db.execute({
    sql: `DELETE FROM presentation_sessions WHERE expires_at < strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
  });
  const expiresAt = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString().replace(/\.\d+Z$/, 'Z');
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    try {
      await db.execute({
        sql: `INSERT INTO presentation_sessions (code, course, topic, slide_count, expires_at)
              VALUES (?,?,?,?,?)`,
        args: [code, course, topic, Math.max(1, slideCount), expiresAt],
      });
      return code;
    } catch {
      // código ya en uso (colisión improbable con 6 dígitos): reintenta con otro.
    }
  }
  throw new Error('No se pudo generar un código de sesión único');
}

async function getPresentationSession(code) {
  const r = await db.execute({
    sql: `SELECT * FROM presentation_sessions WHERE code = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')`,
    args: [code],
  });
  return rowToPresentationSession(r.rows[0] || null);
}

async function setPresentationSlideIndex(code, index) {
  const r = await db.execute({
    sql: `UPDATE presentation_sessions
            SET slide_index = MAX(0, MIN(?, slide_count - 1)),
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE code = ? AND expires_at > strftime('%Y-%m-%dT%H:%M:%SZ','now')
          RETURNING slide_index, slide_count`,
    args: [index, code],
  });
  return r.rows[0] ? { slideIndex: Number(r.rows[0].slide_index), slideCount: Number(r.rows[0].slide_count) } : null;
}

// ── Estado del único TV del taller ──────────────────────────────────────
// Fila fija (id=1): el remoto del KDS (POST) y la pantalla del TV (GET en
// polling) pueden caer en instancias serverless distintas, así que se lee y
// escribe directo en BD (nunca vía la caché de helpers/settings.js).

function rowToTvState(row) {
  return {
    mode: row.mode,
    playing: !!row.playing,
    cmdSeq: Number(row.cmd_seq) || 0,
    cmdAction: row.cmd_action,
    course: row.course,
    topic: row.topic,
    slideIndex: Number(row.slide_index) || 0,
    slideCount: Number(row.slide_count) || 1,
    updatedAt: row.updated_at,
  };
}

async function getTvState() {
  await db.execute(`INSERT OR IGNORE INTO tv_state (id) VALUES (1)`);
  const r = await db.execute('SELECT * FROM tv_state WHERE id = 1');
  return rowToTvState(r.rows[0]);
}

// Cambia de modo (playlist ↔ presentación). Al entrar en modo presentación se
// fija el curso/tema a proyectar; al volver a playlist se limpian.
async function setTvMode(mode, { course = null, topic = null } = {}) {
  await db.execute(`INSERT OR IGNORE INTO tv_state (id) VALUES (1)`);
  const r = await db.execute({
    sql: `UPDATE tv_state
            SET mode = ?, course = ?, topic = ?, slide_index = 0,
                cmd_seq = cmd_seq + 1, cmd_action = 'mode_changed',
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE id = 1
          RETURNING *`,
    args: [mode, mode === 'presentacion' ? course : null, mode === 'presentacion' ? topic : null],
  });
  return rowToTvState(r.rows[0]);
}

// Comando de reproducción del playlist (play/pause/skip_next/skip_prev). Cada
// llamada sube cmd_seq: la pantalla del TV detecta el cambio en su próximo
// polling y ejecuta la acción una sola vez (edge-triggered).
async function sendTvPlaylistCommand(action) {
  const playingUpdate = action === 'play' ? 1 : action === 'pause' ? 0 : null;
  const r = await db.execute({
    sql: `UPDATE tv_state
            SET playing = COALESCE(?, playing),
                cmd_seq = cmd_seq + 1, cmd_action = ?,
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE id = 1
          RETURNING *`,
    args: [playingUpdate, action],
  });
  return r.rows[0] ? rowToTvState(r.rows[0]) : null;
}

async function setTvSlideIndex(index) {
  const r = await db.execute({
    sql: `UPDATE tv_state
            SET slide_index = MAX(0, MIN(?, slide_count - 1)),
                cmd_seq = cmd_seq + 1, cmd_action = 'slide_changed',
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE id = 1
          RETURNING slide_index, slide_count`,
    args: [index],
  });
  return r.rows[0] ? { slideIndex: Number(r.rows[0].slide_index), slideCount: Number(r.rows[0].slide_count) } : null;
}

async function setTvSlideCount(count) {
  await db.execute({
    sql: `UPDATE tv_state SET slide_count = ? WHERE id = 1`,
    args: [Math.max(1, count)],
  });
}

// Avanza/retrocede una diapositiva de forma atómica (evita leer-y-escribir
// por separado, que con dos remotos tocando el TV a la vez podría pisarse).
async function stepTvSlide(delta) {
  const r = await db.execute({
    sql: `UPDATE tv_state
            SET slide_index = MAX(0, MIN(slide_index + ?, slide_count - 1)),
                cmd_seq = cmd_seq + 1, cmd_action = 'slide_changed',
                updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE id = 1
          RETURNING *`,
    args: [delta],
  });
  return r.rows[0] ? rowToTvState(r.rows[0]) : null;
}

// ── Clasificados ────────────────────────────────────────────────────────────

function rowToClassified(row) {
  if (!row) return null;
  return {
    id: row.id,
    userId: row.user_id,
    sellerName: row.seller_name || '',
    category: row.category || 'moto',
    title: row.title,
    description: row.description || '',
    price: Number(row.price) || 0,
    negotiable: row.negotiable === 1,
    condition: row.condition || 'usado',
    brand: row.brand || '',
    city: row.city || '',
    department: row.department || '',
    contactPhone: row.contact_phone || '',
    images: safeJson(row.images, []),
    status: row.status || 'pending',
    rejectReason: row.reject_reason || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createClassified(data) {
  const id = data.id || uuidv4();
  await db.execute({
    sql: `INSERT INTO classifieds
            (id, user_id, seller_name, category, title, description, price,
             negotiable, condition, brand, city, department, contact_phone, images, status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      data.userId,
      data.sellerName || '',
      data.category || 'moto',
      data.title,
      data.description || '',
      data.price || 0,
      data.negotiable ? 1 : 0,
      data.condition || 'usado',
      data.brand || null,
      data.city || null,
      data.department || null,
      data.contactPhone || null,
      JSON.stringify(data.images || []),
      data.status || 'pending',
    ],
  });
  return id;
}

async function updateClassified(id, fields) {
  const set = [];
  const args = [];
  if (fields.category !== undefined)     { set.push('category = ?');      args.push(fields.category); }
  if (fields.title !== undefined)        { set.push('title = ?');         args.push(fields.title); }
  if (fields.description !== undefined)  { set.push('description = ?');    args.push(fields.description); }
  if (fields.price !== undefined)        { set.push('price = ?');         args.push(fields.price); }
  if (fields.negotiable !== undefined)   { set.push('negotiable = ?');    args.push(fields.negotiable ? 1 : 0); }
  if (fields.condition !== undefined)    { set.push('condition = ?');     args.push(fields.condition); }
  if (fields.brand !== undefined)        { set.push('brand = ?');         args.push(fields.brand || null); }
  if (fields.city !== undefined)         { set.push('city = ?');          args.push(fields.city || null); }
  if (fields.department !== undefined)   { set.push('department = ?');    args.push(fields.department || null); }
  if (fields.contactPhone !== undefined) { set.push('contact_phone = ?'); args.push(fields.contactPhone || null); }
  if (fields.images !== undefined)       { set.push('images = ?');        args.push(JSON.stringify(fields.images || [])); }
  if (fields.status !== undefined)       { set.push('status = ?');        args.push(fields.status); }
  if (fields.rejectReason !== undefined) { set.push('reject_reason = ?'); args.push(fields.rejectReason || null); }
  if (set.length === 0) return;
  set.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')`);
  args.push(id);
  await db.execute({ sql: `UPDATE classifieds SET ${set.join(', ')} WHERE id = ?`, args });
}

async function setClassifiedStatus(id, status, rejectReason) {
  await db.execute({
    sql: `UPDATE classifieds SET status = ?, reject_reason = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?`,
    args: [status, rejectReason || null, id],
  });
}

async function getClassifiedById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM classifieds WHERE id = ?', args: [id] });
  return rowToClassified(r.rows[0] || null);
}

// Catálogo público: solo anuncios aprobados. Filtros opcionales por categoría,
// texto (título/descripción/marca) y ciudad.
async function getActiveClassifieds({ category, q, city } = {}) {
  const where = [`status = 'active'`];
  const args = [];
  if (category) { where.push('category = ?'); args.push(category); }
  if (city)     { where.push('city = ?');     args.push(city); }
  if (q) {
    where.push('(LOWER(title) LIKE ? OR LOWER(description) LIKE ? OR LOWER(brand) LIKE ?)');
    const like = `%${q.toLowerCase()}%`;
    args.push(like, like, like);
  }
  const r = await db.execute({
    sql: `SELECT * FROM classifieds WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    args,
  });
  return r.rows.map(rowToClassified);
}

async function getClassifiedsByUser(userId) {
  const r = await db.execute({
    sql: 'SELECT * FROM classifieds WHERE user_id = ? ORDER BY created_at DESC',
    args: [userId],
  });
  return r.rows.map(rowToClassified);
}

async function getAllClassifieds(status) {
  if (status) {
    const r = await db.execute({
      sql: 'SELECT * FROM classifieds WHERE status = ? ORDER BY created_at DESC',
      args: [status],
    });
    return r.rows.map(rowToClassified);
  }
  const r = await db.execute('SELECT * FROM classifieds ORDER BY created_at DESC');
  return r.rows.map(rowToClassified);
}

async function countClassifiedsByStatus(status) {
  const r = await db.execute({ sql: 'SELECT COUNT(*) as n FROM classifieds WHERE status = ?', args: [status] });
  return Number(r.rows[0].n);
}

async function deleteClassified(id) {
  await db.execute({ sql: 'DELETE FROM classifieds WHERE id = ?', args: [id] });
}

// ── Duplicado de placas ─────────────────────────────────────────────────────

function rowToPlateRequest(row) {
  if (!row) return null;
  return {
    id: row.id,
    type: row.type,
    reason: row.reason || '',
    plate: row.plate || '',
    vehicleBrand: row.vehicle_brand || '',
    customerName: row.customer_name,
    customerPhone: row.customer_phone,
    customerEmail: row.customer_email || '',
    city: row.city || '',
    department: row.department || '',
    notes: row.notes || '',
    status: row.status || 'pendiente',
    adminNotes: row.admin_notes || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function createPlateRequest(data) {
  const id = data.id || uuidv4();
  await db.execute({
    sql: `INSERT INTO plate_duplicate_requests
            (id, type, reason, plate, vehicle_brand, customer_name, customer_phone,
             customer_email, city, department, notes, status)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id, data.type, data.reason || null, data.plate || null, data.vehicleBrand || null,
      data.customerName, data.customerPhone, data.customerEmail || null,
      data.city || null, data.department || null, data.notes || null,
      data.status || 'pendiente',
    ],
  });
  return id;
}

async function getPlateRequestById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM plate_duplicate_requests WHERE id = ?', args: [id] });
  return rowToPlateRequest(r.rows[0] || null);
}

async function getAllPlateRequests(status) {
  if (status) {
    const r = await db.execute({
      sql: 'SELECT * FROM plate_duplicate_requests WHERE status = ? ORDER BY created_at DESC',
      args: [status],
    });
    return r.rows.map(rowToPlateRequest);
  }
  const r = await db.execute('SELECT * FROM plate_duplicate_requests ORDER BY created_at DESC');
  return r.rows.map(rowToPlateRequest);
}

async function updatePlateRequestStatus(id, status, adminNotes) {
  await db.execute({
    sql: `UPDATE plate_duplicate_requests
            SET status = ?, admin_notes = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')
          WHERE id = ?`,
    args: [status, adminNotes || null, id],
  });
}

async function countPlateRequestsByStatus(status) {
  const r = await db.execute({ sql: 'SELECT COUNT(*) as n FROM plate_duplicate_requests WHERE status = ?', args: [status] });
  return Number(r.rows[0].n);
}

async function deletePlateRequest(id) {
  await db.execute({ sql: 'DELETE FROM plate_duplicate_requests WHERE id = ?', args: [id] });
}

// ── Backup ────────────────────────────────────────────────────────────────

async function backupAllTables() {
  const tableNames = [
    'users', 'appointments', 'events', 'event_attendances',
    'admin_audit_log', 'newsletter', 'newsletter_campaigns',
    'enrollments', 'job_applications', 'orders', 'quotations',
    'service_orders', 'invoices', 'passkeys', 'gastos',
  ];
  const snapshot = {};
  for (const table of tableNames) {
    try {
      const r = await db.execute(`SELECT * FROM ${table}`);
      snapshot[table] = r.rows.map(row => Object.fromEntries(Object.entries(row)));
    } catch {
      snapshot[table] = [];
    }
  }
  return { timestamp: new Date().toISOString(), tables: snapshot };
}

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  db, initDb,
  getUserById, getUserByEmail, getUserByCedula, getUserByResetToken, getUserByGoogleId, getUserByAppleId,
  getPasskeysByUserId, getPasskeyByCredentialId, createPasskey, updatePasskeyCounter, deletePasskey,
  getAllUsers, countUsers, createUser, updateUser, deleteUser, deleteUserAccount, incrementTokenVersion,
  addUserScore, getLeaderboard, getUserRank,
  getAllAppointments, getAppointmentDates, countAppointments,
  createAppointment, updateAppointment, deleteAppointment,
  getAllEvents, countEvents, createEvent, getEventById, updateEvent, deleteEvent,
  getUpcomingEvents,
  registerEventAttendance, hasUserAttendedEvent, getEventAttendances,
  getAttendanceById, confirmEventAttendance, cancelEventAttendances, getUserEventRegistrations,
  getNewsletterByEmail, getNewsletterByToken, getNewsletterByConfirmToken,
  confirmNewsletterSubscription,
  getAllNewsletterSubscribers, getConfirmedNewsletterSubscribers,
  createNewsletter, deleteNewsletterByToken, deleteNewsletterByEmail,
  createNewsletterCampaign, getAllNewsletterCampaigns,
  createEnrollment,
  createJobApplication,
  createOrder, updateOrderStatus, claimStockDecrement, getOrderById, getAllOrders, getOrdersPage, getOrderStats, getOrdersByUser, countOrders,
  createQuotation, updateQuotation, getDraftQuotations, getQuotationById, getAllQuotations, getConvertedQuotationIds, countQuotations, getQuotationsByMotorcyclePlates, updateQuotationPhone, deleteQuotation,
  createServiceOrder, getServiceOrderById, getAllServiceOrders, getServiceOrdersPage, getServiceOrderStatusCounts, updateServiceOrder, updateServiceOrderPhone, countServiceOrders,
  getServiceOrdersByEmployee, getActiveServiceOrders, countPendingReviewOrders, getServiceOrderEvents, addServiceOrderEvent, detachOrderFromInvoice, deleteServiceOrder,
  createEmployee, getAllEmployees, getActiveEmployees, getEmployeeById, getEmployeeByUserId, updateEmployee, deleteEmployee,
  isThrottleLocked, recordThrottleFailure,
  getAllSettings, setSetting,
  convertServiceOrderToInvoice, revertServiceOrderInvoice, applyStatusPolicy, deliverServiceOrder, getInvoiceById, getAllInvoices, getInvoicesPage, getInvoiceStats, updateInvoiceStatus, countInvoices,
  createGasto, getAllGastos, getGastoById, updateGasto, deleteGasto,
  logAdminAction, getAdminAuditLog,
  getServiceOrdersByPlate,
  createCheckin, getCheckinById, getPendingCheckins, getPendingCheckinsByPlate, markCheckinAttended,
  createPresentationSession, getPresentationSession, setPresentationSlideIndex,
  getTvState, setTvMode, sendTvPlaylistCommand, setTvSlideIndex, setTvSlideCount, stepTvSlide,
  createClassified, updateClassified, setClassifiedStatus, getClassifiedById,
  getActiveClassifieds, getClassifiedsByUser, getAllClassifieds, countClassifiedsByStatus, deleteClassified,
  createPlateRequest, getPlateRequestById, getAllPlateRequests, updatePlateRequestStatus,
  countPlateRequestsByStatus, deletePlateRequest,
  backupAllTables,
};
