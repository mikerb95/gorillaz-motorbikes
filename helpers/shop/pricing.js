'use strict';
// Única fuente de verdad de precios de la tienda. La usan las vistas, el
// carrito, el checkout y el monto que se envía a la pasarela, así que el total
// que ve el cliente es siempre el que se cobra. Funciones puras (sin BD).
//
// Orden de cálculo:
//   1. precio unitario = base (variante o producto) con el mayor descuento
//      aplicable: el del producto o, para miembros del club, el precio club;
//   2. descuentos de combos (kits primero, luego combos armables), sin reusar
//      unidades entre combos;
//   3. cupón sobre lo que queda;
//   4. instalación (solo la que tiene precio definido) y entrega.

const { quoteDelivery } = require('./delivery');

const pct = (v) => Math.min(100, Math.max(0, Math.trunc(Number(v) || 0)));
const applyPct = (amount, p) => Math.round(amount * (1 - p / 100));

function basePrice(product, variant) {
  return variant && variant.price !== null && variant.price !== undefined ? variant.price : product.price;
}

// Precio por unidad. `member` = sesión de un miembro del club.
function unitPrice(product, variant = null, { member = false } = {}) {
  const base = basePrice(product, variant);
  const regularPct = pct(product.discount);
  const clubPct = pct(product.clubDiscount);
  const appliedPct = member ? Math.max(regularPct, clubPct) : regularPct;
  return {
    base,
    final: applyPct(base, appliedPct),
    pct: appliedPct,
    regular: applyPct(base, regularPct),
    // Precio club visible para todos cuando mejora el precio normal.
    club: clubPct > regularPct ? applyPct(base, clubPct) : null,
    isClubApplied: member && clubPct > regularPct,
  };
}

function variantLabel(variant) {
  if (!variant) return '';
  return [variant.color, variant.size].filter(Boolean).join(' / ');
}

// Reparte un descuento de combo: kits (todas sus piezas, en sus cantidades) y
// armables (escalones por número de unidades elegibles). `remaining` lleva las
// unidades aún sin combo por línea.
function applyCombos(lines, combos) {
  const remaining = new Map(lines.map((l) => [l.key, l.qty]));
  const result = [];
  const active = (combos || []).filter((c) => c.active && c.items && c.items.length);
  const ordered = [...active.filter((c) => c.kind === 'kit'), ...active.filter((c) => c.kind !== 'kit')];

  for (const combo of ordered) {
    const members = new Set(combo.items.map((i) => i.productId));
    const eligible = lines.filter((l) => members.has(l.productId) && remaining.get(l.key) > 0)
      .sort((a, b) => b.unitPrice - a.unitPrice);
    if (!eligible.length) continue;

    if (combo.kind === 'kit') {
      const discount = pct(combo.kitDiscount);
      if (!discount) continue;
      // ¿Cuántos kits completos caben con las unidades libres?
      let kits = Infinity;
      for (const it of combo.items) {
        const have = eligible.filter((l) => l.productId === it.productId).reduce((s, l) => s + remaining.get(l.key), 0);
        kits = Math.min(kits, Math.floor(have / (it.qty || 1)));
      }
      if (!kits || kits === Infinity) continue;
      let gross = 0;
      for (const it of combo.items) {
        let need = (it.qty || 1) * kits;
        for (const l of eligible.filter((x) => x.productId === it.productId)) {
          const take = Math.min(need, remaining.get(l.key));
          if (!take) continue;
          gross += take * l.unitPrice;
          remaining.set(l.key, remaining.get(l.key) - take);
          need -= take;
          if (!need) break;
        }
      }
      const amount = gross - applyPct(gross, discount);
      if (amount > 0) result.push({ comboId: combo.id, name: combo.name, kind: 'kit', pct: discount, units: kits, amount });
    } else {
      const units = eligible.reduce((s, l) => s + remaining.get(l.key), 0);
      const tier = [...(combo.tiers || [])]
        .filter((t) => Number(t.min) >= 2 && pct(t.pct) > 0 && units >= Number(t.min))
        .sort((a, b) => Number(b.min) - Number(a.min))[0];
      if (!tier) continue;
      let gross = 0;
      for (const l of eligible) {
        gross += remaining.get(l.key) * l.unitPrice;
        remaining.set(l.key, 0);
      }
      const amount = gross - applyPct(gross, pct(tier.pct));
      if (amount > 0) result.push({ comboId: combo.id, name: combo.name, kind: 'armable', pct: pct(tier.pct), units, amount });
    }
  }
  return result;
}

function couponDiscount(coupon, base) {
  if (!coupon || base <= 0) return 0;
  if (coupon.minSubtotal && base < coupon.minSubtotal) return 0;
  if (coupon.kind === 'amount') return Math.min(base, Math.max(0, Math.round(coupon.value || 0)));
  return base - applyPct(base, pct(coupon.value));
}

/**
 * Calcula el carrito completo.
 * @param {object} o
 * @param {Array} o.lines    [{ key, product, variant, qty, install }]
 * @param {Array} [o.combos] combos del catálogo
 * @param {boolean} [o.member]
 * @param {object} [o.coupon] { code, kind, value, minSubtotal }
 * @param {object} [o.delivery] { config, method, zone }
 */
function computeCart({ lines = [], combos = [], member = false, coupon = null, delivery = null } = {}) {
  const priced = lines
    .filter((l) => l.product && l.qty > 0)
    .map((l) => {
      const u = unitPrice(l.product, l.variant, { member });
      const wantsInstall = !!l.install && !!l.product.installable;
      const installPrice = wantsInstall ? l.product.installPrice : null;
      return {
        key: l.key,
        productId: l.product.id,
        variantId: l.variant ? l.variant.id : null,
        name: l.product.name,
        variantLabel: variantLabel(l.variant),
        slug: l.product.slug,
        image: l.product.image || null,
        qty: l.qty,
        unitBase: u.base,
        unitPrice: u.final,
        pct: u.pct,
        isClubApplied: u.isClubApplied,
        lineTotal: u.final * l.qty,
        install: wantsInstall,
        installPrice: typeof installPrice === 'number' ? installPrice : null,
        installTotal: typeof installPrice === 'number' ? installPrice * l.qty : 0,
      };
    });

  const itemsSubtotal = priced.reduce((s, l) => s + l.lineTotal, 0);
  const baseTotal = priced.reduce((s, l) => s + l.unitBase * l.qty, 0);
  const comboDiscounts = applyCombos(priced, combos);
  const comboTotal = comboDiscounts.reduce((s, d) => s + d.amount, 0);
  const afterCombos = itemsSubtotal - comboTotal;
  const couponAmount = couponDiscount(coupon, afterCombos);
  const merchandise = afterCombos - couponAmount;

  const installationTotal = priced.reduce((s, l) => s + l.installTotal, 0);
  const installationPending = priced.some((l) => l.install && l.installPrice === null);

  let deliveryQuote = null;
  if (delivery && delivery.config) {
    deliveryQuote = quoteDelivery(delivery.config, { method: delivery.method, zone: delivery.zone, merchandise });
  }
  const deliveryFee = deliveryQuote && deliveryQuote.ok ? deliveryQuote.fee : 0;

  const discounts = [
    ...comboDiscounts.map((d) => ({ type: 'combo', label: d.name, amount: d.amount, comboId: d.comboId })),
    ...(couponAmount ? [{ type: 'coupon', label: `Cupón ${coupon.code}`, amount: couponAmount, code: coupon.code }] : []),
  ];

  return {
    lines: priced,
    count: priced.reduce((s, l) => s + l.qty, 0),
    itemsSubtotal,
    comboDiscounts,
    couponAmount,
    discounts,
    discountTotal: comboTotal + couponAmount,
    merchandise,
    installationTotal,
    installationPending,
    hasInstallation: priced.some((l) => l.install),
    delivery: deliveryQuote,
    deliveryFee,
    total: merchandise + installationTotal + deliveryFee,
    // Ahorro frente al precio lleno: descuentos de producto + combos + cupón.
    savings: (baseTotal - itemsSubtotal) + comboTotal + couponAmount,
  };
}

module.exports = { unitPrice, basePrice, variantLabel, applyCombos, couponDiscount, computeCart };
