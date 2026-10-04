'use strict';
// Cupones de la tienda (tabla coupons, v18). Hoy los emite el formulario del
// checklist gratuito como cupón de primera compra, si el dueño lo activa.

const crypto = require('crypto');
const { db } = require('../../db');

const normCode = (c) => String(c || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 30);

function rowToCoupon(r) {
  return {
    code: r.code, kind: r.kind === 'amount' ? 'amount' : 'pct', value: Number(r.value) || 0,
    minSubtotal: Number(r.min_subtotal) || 0, maxUses: Number(r.max_uses) || 1, uses: Number(r.uses) || 0,
    email: r.email || null, source: r.source || '', expiresAt: r.expires_at || null, active: Number(r.active) === 1,
  };
}

// Valida un cupón para un correo. Devuelve { ok, coupon } o { ok:false, error }.
async function findValidCoupon(code, email) {
  const c = normCode(code);
  if (!c) return { ok: false, error: 'Escribe un cupón.' };
  const r = await db.execute({ sql: 'SELECT * FROM coupons WHERE code = ?', args: [c] });
  if (!r.rows[0]) return { ok: false, error: 'Ese cupón no existe.' };
  const coupon = rowToCoupon(r.rows[0]);
  if (!coupon.active || coupon.uses >= coupon.maxUses) return { ok: false, error: 'Ese cupón ya fue usado.' };
  if (coupon.expiresAt && Date.parse(coupon.expiresAt) < Date.now()) return { ok: false, error: 'Ese cupón venció.' };
  if (coupon.email && email && coupon.email.toLowerCase() !== String(email).trim().toLowerCase()) {
    return { ok: false, error: 'Ese cupón está asociado a otro correo.' };
  }
  if (coupon.email && !email) return { ok: false, error: 'Escribe el correo con el que recibiste el cupón.' };
  return { ok: true, coupon };
}

// Consume un uso al confirmarse el pago (atómico: no se pasa de max_uses).
async function redeemCoupon(code) {
  const r = await db.execute({ sql: 'UPDATE coupons SET uses = uses + 1 WHERE code = ? AND uses < max_uses', args: [normCode(code)] });
  return (r.rowsAffected ?? r.changes ?? 0) > 0;
}

// Cupón personal de primera compra. Uno por correo: si ya existe, se reutiliza.
async function issueFirstPurchaseCoupon(email, cfg) {
  if (!cfg || !cfg.enabled || !(Number(cfg.value) > 0)) return null;
  const mail = String(email || '').trim().toLowerCase();
  if (!mail) return null;
  const prev = await db.execute({ sql: "SELECT * FROM coupons WHERE email = ? AND source = 'primera-compra'", args: [mail] });
  if (prev.rows[0]) return rowToCoupon(prev.rows[0]);
  const code = `BIENVENIDA-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const days = Math.max(1, Number(cfg.days) || 30);
  const expires = new Date(Date.now() + days * 86400000).toISOString();
  await db.execute({
    sql: `INSERT INTO coupons (code, kind, value, min_subtotal, max_uses, email, source, expires_at, active)
          VALUES (?,?,?,?,1,?,'primera-compra',?,1)`,
    args: [code, cfg.kind === 'amount' ? 'amount' : 'pct', Math.round(Number(cfg.value)), Math.max(0, Number(cfg.minSubtotal) || 0), mail, expires],
  });
  return { code, kind: cfg.kind === 'amount' ? 'amount' : 'pct', value: Math.round(Number(cfg.value)), minSubtotal: Number(cfg.minSubtotal) || 0, expiresAt: expires, email: mail };
}

async function listCoupons(limit = 200) {
  const r = await db.execute({ sql: 'SELECT * FROM coupons ORDER BY created_at DESC LIMIT ?', args: [limit] });
  return r.rows.map(rowToCoupon);
}

async function saveCoupon(c) {
  await db.execute({
    sql: `INSERT INTO coupons (code, kind, value, min_subtotal, max_uses, email, source, expires_at, active) VALUES (?,?,?,?,?,?,?,?,?)
          ON CONFLICT(code) DO UPDATE SET kind = excluded.kind, value = excluded.value, min_subtotal = excluded.min_subtotal,
            max_uses = excluded.max_uses, email = excluded.email, expires_at = excluded.expires_at, active = excluded.active`,
    args: [normCode(c.code), c.kind === 'amount' ? 'amount' : 'pct', Math.max(0, Math.round(c.value || 0)), Math.max(0, c.minSubtotal || 0),
      Math.max(1, c.maxUses || 1), c.email || null, c.source || 'admin', c.expiresAt || null, c.active ? 1 : 0],
  });
}

module.exports = { normCode, findValidCoupon, redeemCoupon, issueFirstPurchaseCoupon, listCoupons, saveCoupon };
