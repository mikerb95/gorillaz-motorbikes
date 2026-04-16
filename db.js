'use strict';
const { createClient } = require('@libsql/client');
const { v4: uuidv4 } = require('uuid');

if (!process.env.TURSO_URL || !process.env.TURSO_TOKEN) {
  console.warn('[WARN] TURSO_URL o TURSO_TOKEN no configurados');
}

const db = createClient({
  url: process.env.TURSO_URL || '',
  authToken: process.env.TURSO_TOKEN || '',
});

// ── Schema ────────────────────────────────────────────────────────────────

async function initDb() {
  const tables = [
    `CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      cedula TEXT,
      phone TEXT,
      city TEXT,
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
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
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
  ];

  for (const sql of tables) {
    await db.execute(sql);
  }

  // Migrations: add columns to existing tables if they don't exist
  const migrations = [
    `ALTER TABLE users ADD COLUMN score INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE users ADD COLUMN score_history TEXT NOT NULL DEFAULT '[]'`,
    `ALTER TABLE events ADD COLUMN type TEXT NOT NULL DEFAULT 'evento'`,
  ];
  for (const sql of migrations) {
    try { await db.execute(sql); } catch { /* column already exists */ }
  }

  console.log('✅ Turso schema inicializado');
}

// ── Helpers ───────────────────────────────────────────────────────────────

function safeJson(str, fallback) {
  try { return str ? JSON.parse(str) : fallback; } catch { return fallback; }
}

function rowToUser(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    password: row.password,
    role: row.role || 'user',
    cedula: row.cedula,
    phone: row.phone,
    city: row.city,
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
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE id = ?', args: [id] });
  return rowToUser(r.rows[0] || null);
}

async function getUserByEmail(email) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE email = ?', args: [email] });
  return rowToUser(r.rows[0] || null);
}

async function getUserByCedula(cedula) {
  const r = await db.execute({ sql: 'SELECT * FROM users WHERE cedula = ?', args: [cedula] });
  return rowToUser(r.rows[0] || null);
}

async function getUserByResetToken(token) {
  const r = await db.execute({
    sql: 'SELECT * FROM users WHERE reset_token = ? AND reset_token_expiry > ?',
    args: [token, Date.now()],
  });
  return rowToUser(r.rows[0] || null);
}

async function getAllUsers() {
  const r = await db.execute('SELECT * FROM users ORDER BY created_at DESC');
  return r.rows.map(rowToUser);
}

async function countUsers() {
  const r = await db.execute('SELECT COUNT(*) as n FROM users');
  return Number(r.rows[0].n);
}

async function createUser(data) {
  const id = data.id || uuidv4();
  await db.execute({
    sql: `INSERT INTO users
            (id, name, email, password, role, cedula, phone, city, birthdate,
             nickname, blood_type, club_notifications, membership, visits, vehicles,
             emergency_name, emergency_phone)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      id,
      data.name,
      data.email,
      data.password,
      data.role || 'user',
      data.cedula || null,
      data.phone || null,
      data.city || null,
      data.birthdate || null,
      data.nickname || null,
      data.bloodType || null,
      data.clubNotifications === false ? 0 : 1,
      JSON.stringify(data.membership || { level: 'Básica', since: new Date().toISOString().slice(0, 10), expires: null, benefits: ['Descuentos en taller', 'Acceso al club'] }),
      JSON.stringify(data.visits || []),
      JSON.stringify(data.vehicles || []),
      data.emergencyName || null,
      data.emergencyPhone || null,
    ],
  });
  return getUserById(id);
}

async function updateUser(id, fields) {
  const set = [];
  const args = [];
  if (fields.name !== undefined)             { set.push('name = ?');                args.push(fields.name); }
  if (fields.password !== undefined)         { set.push('password = ?');            args.push(fields.password); }
  if (fields.role !== undefined)             { set.push('role = ?');                args.push(fields.role); }
  if (fields.membership !== undefined)       { set.push('membership = ?');          args.push(JSON.stringify(fields.membership)); }
  if (fields.visits !== undefined)           { set.push('visits = ?');              args.push(JSON.stringify(fields.visits)); }
  if (fields.vehicles !== undefined)         { set.push('vehicles = ?');            args.push(JSON.stringify(fields.vehicles)); }
  if (fields.score !== undefined)            { set.push('score = ?');               args.push(fields.score); }
  if (fields.scoreHistory !== undefined)     { set.push('score_history = ?');       args.push(JSON.stringify(fields.scoreHistory)); }
  if (fields.resetToken !== undefined)       { set.push('reset_token = ?');         args.push(fields.resetToken); }
  if (fields.resetTokenExpiry !== undefined) { set.push('reset_token_expiry = ?');  args.push(fields.resetTokenExpiry); }
  if (set.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE users SET ${set.join(', ')} WHERE id = ?`, args });
}

async function deleteUser(id) {
  await db.execute({ sql: 'DELETE FROM users WHERE id = ?', args: [id] });
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
  const r = await db.execute('SELECT * FROM events ORDER BY date ASC');
  return r.rows.map(rowToEvent);
}

async function countEvents() {
  const r = await db.execute('SELECT COUNT(*) as n FROM events');
  return Number(r.rows[0].n);
}

async function createEvent(data) {
  const id = data.id || uuidv4();
  await db.execute({
    sql: 'INSERT INTO events (id, title, date, location, description, level, type) VALUES (?,?,?,?,?,?,?)',
    args: [id, data.title, data.date, data.location || null, data.description || null, data.level || null, data.type || 'evento'],
  });
  return id;
}

async function getEventById(id) {
  const r = await db.execute({ sql: 'SELECT * FROM events WHERE id = ?', args: [id] });
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
  if (set.length === 0) return;
  args.push(id);
  await db.execute({ sql: `UPDATE events SET ${set.join(', ')} WHERE id = ?`, args });
}

async function deleteEvent(id) {
  await db.execute({ sql: 'DELETE FROM events WHERE id = ?', args: [id] });
}

// ── Newsletter ────────────────────────────────────────────────────────────

async function getNewsletterByEmail(email) {
  const r = await db.execute({ sql: 'SELECT id FROM newsletter WHERE email = ?', args: [email] });
  return r.rows[0] || null;
}

async function createNewsletter(email) {
  await db.execute({
    sql: 'INSERT OR IGNORE INTO newsletter (id, email) VALUES (?,?)',
    args: [uuidv4(), email],
  });
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

// ── Score ─────────────────────────────────────────────────────────────────

async function addUserScore(userId, points, concept, description) {
  const user = await getUserById(userId);
  if (!user) return;
  const newScore = (user.score || 0) + points;
  const entry = { date: new Date().toISOString().slice(0, 10), points, concept, description };
  const history = [entry, ...(user.scoreHistory || [])].slice(0, 100);
  await updateUser(userId, { score: newScore, scoreHistory: history });
}

async function getLeaderboard(limit = 10) {
  const r = await db.execute({
    sql: 'SELECT id, name, nickname, score FROM users WHERE role != ? ORDER BY score DESC LIMIT ?',
    args: ['admin', limit],
  });
  return r.rows.map(row => ({
    id: row.id,
    name: row.name,
    nickname: row.nickname,
    score: Number(row.score) || 0,
  }));
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

async function confirmEventAttendance(attendanceId) {
  await db.execute({
    sql: 'UPDATE event_attendances SET status = ? WHERE id = ?',
    args: ['confirmed', attendanceId],
  });
}

async function getUpcomingEvents(limit = 6) {
  const today = new Date().toISOString().slice(0, 10);
  const r = await db.execute({
    sql: 'SELECT * FROM events WHERE date >= ? ORDER BY date ASC LIMIT ?',
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

// ── Exports ───────────────────────────────────────────────────────────────

module.exports = {
  db, initDb,
  getUserById, getUserByEmail, getUserByCedula, getUserByResetToken,
  getAllUsers, countUsers, createUser, updateUser, deleteUser,
  addUserScore, getLeaderboard,
  getAllAppointments, getAppointmentDates, countAppointments,
  createAppointment, updateAppointment, deleteAppointment,
  getAllEvents, countEvents, createEvent, getEventById, updateEvent, deleteEvent,
  getUpcomingEvents,
  registerEventAttendance, hasUserAttendedEvent, getEventAttendances,
  confirmEventAttendance, getUserEventRegistrations,
  getNewsletterByEmail, createNewsletter,
  createEnrollment,
  createJobApplication,
};
