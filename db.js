'use strict';
const { createClient } = require('@libsql/client');
const { v4: uuidv4 } = require('uuid');

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
const SCHEMA_VERSION = 4;

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
  ];
  for (const sql of indexes) {
    try { await db.execute(sql); } catch { /* index already exists */ }
  }

  await ensureNewsletterTokens();

  // Marca el esquema como migrado para que los próximos cold starts salgan
  // temprano en la comprobación de versión de arriba.
  await db.execute({ sql: 'UPDATE schema_meta SET version = ? WHERE id = 1', args: [SCHEMA_VERSION] });
  console.log(`✅ Turso schema inicializado (v${SCHEMA_VERSION})`);
}

// ── Helpers ───────────────────────────────────────────────────────────────

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
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
      JSON.stringify(data.membership || { level: 'Básica', since: new Date().toISOString().slice(0, 10), expires: null, benefits: ['Descuentos en taller', 'Acceso al club'] }),
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
    const entry      = { date: new Date().toISOString().slice(0, 10), points, concept, description };
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
        data.status || 'pendiente',
        data.notes || null,
        data.estimatedDate || null,
        data.employeeId || null,
      ],
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

async function updateServiceOrder(id, fields) {
  const set = [], args = [];
  if (fields.items         !== undefined) { set.push('items = ?');          args.push(JSON.stringify(fields.items)); }
  if (fields.total         !== undefined) { set.push('total = ?');          args.push(fields.total); }
  if (fields.mechanic      !== undefined) { set.push('mechanic = ?');       args.push(fields.mechanic); }
  if (fields.status        !== undefined) { set.push('status = ?');         args.push(fields.status); }
  if (fields.notes         !== undefined) { set.push('notes = ?');          args.push(fields.notes); }
  if (fields.estimatedDate !== undefined) { set.push('estimated_date = ?'); args.push(fields.estimatedDate); }
  if (fields.invoiceId          !== undefined) { set.push('invoice_id = ?');           args.push(fields.invoiceId); }
  if (fields.employeeId         !== undefined) { set.push('employee_id = ?');          args.push(fields.employeeId); }
  if (fields.pendingReview      !== undefined) { set.push('pending_review = ?');       args.push(fields.pendingReview ? 1 : 0); }
  if (fields.trabajoCompletoAt  !== undefined) { set.push('trabajo_completo_at = ?');  args.push(fields.trabajoCompletoAt); }
  if (set.length === 0) return;
  set.push('updated_at = ?'); args.push(new Date().toISOString());
  args.push(id);
  await db.execute({ sql: `UPDATE service_orders SET ${set.join(', ')} WHERE id = ?`, args });
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
    total: Number(row.total),
    paymentMethod: row.payment_method,
    status: row.status,
    notes: row.notes || null,
    createdAt: row.created_at,
  };
}

async function createInvoice(data) {
  const id       = data.id || uuidv4();
  const now      = new Date().toISOString();
  const subtotal = data.subtotal || data.total || 0;
  const tax      = data.tax || 0;
  const total    = subtotal + tax;
  let consecutive, label;
  const tx = await db.transaction('write');
  try {
    const r = await tx.execute('SELECT COALESCE(MAX(consecutive), 0) + 1 AS next FROM invoices');
    consecutive = Number(r.rows[0].next);
    label = fmtLabel('F-', consecutive, now);
    await tx.execute({
      sql: `INSERT INTO invoices
            (id, consecutive, label, service_order_id, quotation_id, items, subtotal, tax, total, payment_method, status, notes)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      args: [
        id, consecutive, label,
        data.serviceOrderId,
        data.quotationId || null,
        JSON.stringify(data.items || []),
        subtotal, tax, total,
        data.paymentMethod || 'efectivo',
        data.status || 'pendiente',
        data.notes || null,
      ],
    });
    await tx.commit();
  } catch (e) {
    await tx.rollback();
    throw e;
  }
  return { id, consecutive, label };
}

async function getInvoiceById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM invoices WHERE id = ?', args: [id] });
  return rowToInvoice(r.rows[0] || null);
}

async function getAllInvoices() {
  const r = await db.execute('SELECT * FROM invoices ORDER BY created_at DESC');
  return r.rows.map(rowToInvoice);
}

async function updateInvoiceStatus(id, status, paymentMethod) {
  await db.execute({
    sql: 'UPDATE invoices SET status = ?, payment_method = ? WHERE id = ?',
    args: [status, paymentMethod || 'efectivo', id],
  });
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
  getAllUsers, countUsers, createUser, updateUser, deleteUser, deleteUserAccount,
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
  createOrder, updateOrderStatus, claimStockDecrement, getOrderById, getAllOrders, getOrdersByUser, countOrders,
  createQuotation, updateQuotation, getDraftQuotations, getQuotationById, getAllQuotations, countQuotations, getQuotationsByMotorcyclePlates, updateQuotationPhone, deleteQuotation,
  createServiceOrder, getServiceOrderById, getAllServiceOrders, updateServiceOrder, updateServiceOrderPhone, countServiceOrders,
  getServiceOrdersByEmployee, countPendingReviewOrders,
  createEmployee, getAllEmployees, getActiveEmployees, getEmployeeById, getEmployeeByUserId, updateEmployee, deleteEmployee,
  isThrottleLocked, recordThrottleFailure,
  getAllSettings, setSetting,
  createInvoice, getInvoiceById, getAllInvoices, updateInvoiceStatus, countInvoices,
  createGasto, getAllGastos, getGastoById, updateGasto, deleteGasto,
  logAdminAction, getAdminAuditLog,
  getServiceOrdersByPlate,
  backupAllTables,
};
