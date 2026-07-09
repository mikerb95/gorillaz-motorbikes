'use strict';
const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { isoCO } = require('../helpers/datetime');
const {
  getAllInvoices, getAllOrders,
  createGasto, getAllGastos, getGastoById, updateGasto, deleteGasto,
} = require('../db');

const router = express.Router();

// ── Constants ─────────────────────────────────────────────────────────────

const GASTO_CATS = {
  nomina:      'Nómina',
  arriendo:    'Arriendo',
  servicios:   'Servicios públicos',
  insumos:     'Insumos / Materiales',
  repuestos:   'Repuestos / Inventario',
  marketing:   'Marketing',
  equipos:     'Equipos / Herramientas',
  impuestos:   'Impuestos',
  transporte:  'Transporte',
  otros:       'Otros',
};

const METHOD_LABELS = {
  efectivo:      'Efectivo',
  tarjeta:       'Tarjeta',
  transferencia: 'Transferencia',
  nequi:         'Nequi',
  daviplata:     'Daviplata',
  bold:          'Bold Online',
  cheque:        'Cheque',
};

const MONTH_NAMES  = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const MONTH_SHORT  = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];

// ── Helpers ───────────────────────────────────────────────────────────────

// Todos los cortes de periodo se calculan en hora Colombia (America/Bogota).
// La DB guarda timestamps UTC; agrupar con getFullYear/getMonth del servidor
// (UTC en Vercel) empujaría lo facturado de noche al día/mes siguiente. isoCO()
// devuelve 'YYYY-MM-DD' ya convertido a Colombia.
function periodParts(dateStr) {
  const iso = isoCO(dateStr);
  if (!iso) return null;
  const [y, m] = iso.split('-').map(Number);
  return { y, m };
}

// «Ahora» en año/mes de Colombia (para el periodo por defecto y las ventanas).
function nowParts() {
  const [y, m] = isoCO().split('-').map(Number);
  return { y, m };
}

// Lista de los últimos `count` meses (más antiguo → más reciente) como {y, m},
// contando desde el mes actual en Colombia.
function monthsBack(count) {
  const { y, m } = nowParts();
  const base = y * 12 + (m - 1);
  return Array.from({ length: count }, (_, i) => {
    const idx = base - (count - 1 - i);
    return { y: Math.floor(idx / 12), m: (idx % 12) + 1 };
  });
}

// El ingreso de una factura se reconoce en su fecha de pago (paidAt); fallback a
// la de emisión por si faltara (dato antiguo sin sellar).
function invIncomeDate(i) { return i.paidAt || i.createdAt; }

// El ingreso operacional de una factura excluye el IVA (que se transfiere a la
// DIAN, no es ingreso del negocio) pero incluye el parqueadero cobrado, que sí
// es ingreso real. total = subtotal + IVA + parqueadero, por lo que
// invIncome + tax = total y las tablas de detalle cuadran exactamente.
function invIncome(i) { return (i.subtotal || 0) + (i.parkingAmount || 0); }

function parsePeriod(query) {
  const { y, m } = nowParts();
  const p = query.period || `${y}-${String(m).padStart(2, '0')}`;
  const [py, pm] = p.split('-').map(Number);
  return { param: p, year: py, month: pm };
}

function parseYear(query) {
  return Number(query.year) || nowParts().y;
}

function inPeriod(dateStr, y, m) {
  const p = periodParts(dateStr);
  return !!p && p.y === y && p.m === m;
}

function inYear(dateStr, y) {
  const p = periodParts(dateStr);
  return !!p && p.y === y;
}

function getAvailablePeriods(n = 13) {
  return monthsBack(n).map(({ y, m }) => `${y}-${String(m).padStart(2, '0')}`);
}

function buildMonthlyChart(paidInvoices, paidOrders, gastos, n = 12) {
  return monthsBack(n).map(({ y, m }) => {
    const key = `${y}-${String(m).padStart(2, '0')}`;
    const inv = paidInvoices.filter(x => inPeriod(invIncomeDate(x), y, m)).reduce((s, x) => s + invIncome(x), 0);
    const ord = paidOrders.filter(x => inPeriod(x.createdAt, y, m)).reduce((s, x) => s + x.total, 0);
    const gas = gastos.filter(x => inPeriod(x.date, y, m)).reduce((s, x) => s + x.amount, 0);
    return { key, label: `${MONTH_SHORT[m - 1]} ${y}`, fullLabel: `${MONTH_NAMES[m - 1]} ${y}`, shortLabel: MONTH_SHORT[m - 1], inv, ord, gas, ing: inv + ord, net: inv + ord - gas };
  });
}

function daysDiff(dateStr) {
  return Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
}

// ── Dashboard ─────────────────────────────────────────────────────────────

router.get('/', requireAuth, requireAdmin, async (req, res) => {
  const [invoices, orders, gastos] = await Promise.all([getAllInvoices(), getAllOrders(), getAllGastos()]);
  const { param, year, month } = parsePeriod(req.query);

  const paidInvoices   = invoices.filter(i => i.status === 'pagada');
  const paidOrders     = orders.filter(o => o.status === 'paid');
  const pendingInvoices = invoices.filter(i => i.status === 'pendiente');

  const totalIngresosAllTime = paidInvoices.reduce((s, i) => s + invIncome(i), 0) + paidOrders.reduce((s, o) => s + o.total, 0);
  const totalEgresosAllTime  = gastos.reduce((s, g) => s + g.amount, 0);

  const periodoInv  = paidInvoices.filter(i => inPeriod(invIncomeDate(i), year, month)).reduce((s, i) => s + invIncome(i), 0);
  const periodoOrd  = paidOrders.filter(o => inPeriod(o.createdAt, year, month)).reduce((s, o) => s + o.total, 0);
  const periodoGas  = gastos.filter(g => inPeriod(g.date, year, month)).reduce((s, g) => s + g.amount, 0);
  const periodoIng  = periodoInv + periodoOrd;
  const periodoNet  = periodoIng - periodoGas;
  const periodoMarg = periodoIng > 0 ? Math.round((periodoNet / periodoIng) * 100) : 0;

  const monthlyData = buildMonthlyChart(paidInvoices, paidOrders, gastos);
  const maxMonthly  = Math.max(...monthlyData.map(d => Math.max(d.ing, d.gas)), 1);

  const byCategory = {};
  gastos.filter(g => inPeriod(g.date, year, month)).forEach(g => {
    byCategory[g.category] = (byCategory[g.category] || 0) + g.amount;
  });
  const catMax = Math.max(...Object.values(byCategory), 1);

  const byMethod = {};
  paidInvoices.filter(i => inPeriod(invIncomeDate(i), year, month)).forEach(i => {
    byMethod[i.paymentMethod || 'efectivo'] = (byMethod[i.paymentMethod || 'efectivo'] || 0) + invIncome(i);
  });

  const recentMovements = [
    ...paidInvoices.map(i => ({ type: 'ingreso', icon: 'factura', ref: i.label, date: invIncomeDate(i), amount: i.subtotal, link: `/admin/facturas/${i.id}` })),
    ...paidOrders.map(o => ({ type: 'ingreso', icon: 'pedido', ref: `Pedido ${o.id.slice(0, 8)}`, date: o.createdAt, amount: o.total, link: null })),
    ...gastos.map(g => ({ type: 'egreso', icon: 'gasto', ref: g.description, date: g.date, amount: g.amount, cat: GASTO_CATS[g.category] || g.category, link: null })),
  ].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 12);

  res.render('admin/finanzas/index', {
    activeFin: 'dashboard',
    periodParam: param, pYear: year, pMonth: month,
    periodLabel: `${MONTH_NAMES[month - 1]} ${year}`,
    availablePeriods: getAvailablePeriods(),
    MONTH_NAMES,
    totalIngresosAllTime, totalEgresosAllTime,
    utilidadAllTime: totalIngresosAllTime - totalEgresosAllTime,
    pendingTotal: pendingInvoices.reduce((s, i) => s + i.total, 0),
    pendingCount: pendingInvoices.length,
    periodoIng, periodoGas, periodoNet, periodoMarg,
    periodoInv, periodoOrd,
    invCount: paidInvoices.filter(i => inPeriod(invIncomeDate(i), year, month)).length,
    ordCount: paidOrders.filter(o => inPeriod(o.createdAt, year, month)).length,
    gasCount: gastos.filter(g => inPeriod(g.date, year, month)).length,
    monthlyData, maxMonthly,
    byCategory, catMax,
    byMethod,
    recentMovements,
    GASTO_CATS, METHOD_LABELS,
  });
});

// ── Ingresos ──────────────────────────────────────────────────────────────

router.get('/ingresos', requireAuth, requireAdmin, async (req, res) => {
  const [invoices, orders] = await Promise.all([getAllInvoices(), getAllOrders()]);
  const { param, year, month } = parsePeriod(req.query);
  const source = req.query.source || 'todos';

  const paidInvoices = invoices.filter(i => i.status === 'pagada');
  const paidOrders   = orders.filter(o => o.status === 'paid');

  const periodoInv = paidInvoices.filter(i => inPeriod(invIncomeDate(i), year, month));
  const periodoOrd = paidOrders.filter(o => inPeriod(o.createdAt, year, month));

  let movements = [];
  if (source !== 'pedidos') movements.push(...periodoInv.map(i => ({ type: 'factura', ref: i.label, date: invIncomeDate(i), method: i.paymentMethod, subtotal: i.subtotal, tax: i.tax, total: i.total, link: `/admin/facturas/${i.id}` })));
  if (source !== 'facturas') movements.push(...periodoOrd.map(o => ({ type: 'pedido', ref: o.id.slice(0, 8).toUpperCase(), date: o.createdAt, method: 'bold', subtotal: o.total, tax: 0, total: o.total, link: null })));
  movements.sort((a, b) => new Date(b.date) - new Date(a.date));

  const totalIng     = movements.reduce((s, m) => s + m.total, 0);
  const totalSubtot  = movements.reduce((s, m) => s + m.subtotal, 0);
  const totalTax     = movements.reduce((s, m) => s + m.tax, 0);

  const byMethod = {};
  periodoInv.forEach(i => { const m = i.paymentMethod || 'efectivo'; byMethod[m] = (byMethod[m] || 0) + i.subtotal; });
  const methodMax = Math.max(...Object.values(byMethod), 1);

  const allTimeInv   = paidInvoices.reduce((s, i) => s + i.subtotal, 0);
  const allTimeOrd   = paidOrders.reduce((s, o) => s + o.total, 0);

  res.render('admin/finanzas/ingresos', {
    activeFin: 'ingresos',
    periodParam: param, pYear: year, pMonth: month,
    periodLabel: `${MONTH_NAMES[month - 1]} ${year}`,
    availablePeriods: getAvailablePeriods(),
    MONTH_NAMES, METHOD_LABELS,
    source, movements,
    totalIng, totalSubtot, totalTax,
    invCount: periodoInv.length, ordCount: periodoOrd.length,
    byMethod, methodMax,
    allTimeInv, allTimeOrd, allTimeTotal: allTimeInv + allTimeOrd,
  });
});

// ── Egresos ───────────────────────────────────────────────────────────────

router.get('/egresos', requireAuth, requireAdmin, async (req, res) => {
  const gastos = await getAllGastos();
  const { param, year, month } = parsePeriod(req.query);
  const catFilter = req.query.cat || '';
  const flash     = req.query.flash || null;

  let filtered = gastos.filter(g => inPeriod(g.date, year, month));
  if (catFilter) filtered = filtered.filter(g => g.category === catFilter);

  const totalPeriodo  = filtered.reduce((s, g) => s + g.amount, 0);
  const totalAllTime  = gastos.reduce((s, g) => s + g.amount, 0);

  const byCategory = {};
  gastos.filter(g => inPeriod(g.date, year, month)).forEach(g => {
    byCategory[g.category] = (byCategory[g.category] || 0) + g.amount;
  });
  const catMax = Math.max(...Object.values(byCategory), 1);

  const editId    = req.query.edit || null;
  const editGasto = editId ? (gastos.find(g => g.id === editId) || null) : null;

  res.render('admin/finanzas/egresos', {
    activeFin: 'egresos',
    periodParam: param, pYear: year, pMonth: month,
    periodLabel: `${MONTH_NAMES[month - 1]} ${year}`,
    availablePeriods: getAvailablePeriods(),
    MONTH_NAMES, GASTO_CATS, METHOD_LABELS,
    catFilter, filtered, flash,
    totalPeriodo, totalAllTime,
    byCategory, catMax,
    editGasto,
  });
});

router.post('/egresos/crear', requireAuth, requireAdmin, async (req, res) => {
  const { category, description, amount, date, paymentMethod, notes, period } = req.body;
  if (!description || !amount || !date) return res.redirect(`/admin/finanzas/egresos?flash=error&period=${period || ''}`);
  await createGasto({ category: category || 'otros', description: description.trim(), amount: Math.round(Number(amount.replace(/\D/g, '')) || 0), date, paymentMethod: paymentMethod || 'efectivo', notes: (notes || '').trim() || null });
  res.redirect(`/admin/finanzas/egresos?flash=created&period=${period || ''}`);
});

router.post('/egresos/:id/actualizar', requireAuth, requireAdmin, async (req, res) => {
  const { category, description, amount, date, paymentMethod, notes, period } = req.body;
  if (!description || !amount || !date) return res.redirect(`/admin/finanzas/egresos?flash=error&period=${period || ''}`);
  await updateGasto(req.params.id, { category: category || 'otros', description: description.trim(), amount: Math.round(Number(String(amount).replace(/\D/g, '')) || 0), date, paymentMethod: paymentMethod || 'efectivo', notes: (notes || '').trim() || null });
  res.redirect(`/admin/finanzas/egresos?flash=updated&period=${period || ''}`);
});

router.post('/egresos/:id/eliminar', requireAuth, requireAdmin, async (req, res) => {
  const { period } = req.body;
  await deleteGasto(req.params.id);
  res.redirect(`/admin/finanzas/egresos?flash=deleted&period=${period || ''}`);
});

// ── Cuentas por Cobrar ────────────────────────────────────────────────────

router.get('/cuentas-cobrar', requireAuth, requireAdmin, async (req, res) => {
  const invoices = await getAllInvoices();
  const pending  = invoices.filter(i => i.status === 'pendiente').map(i => ({ ...i, days: daysDiff(i.createdAt) })).sort((a, b) => b.days - a.days);

  const aging = {
    '0-30':  pending.filter(i => i.days <= 30),
    '31-60': pending.filter(i => i.days > 30 && i.days <= 60),
    '61-90': pending.filter(i => i.days > 60 && i.days <= 90),
    '+90':   pending.filter(i => i.days > 90),
  };

  const totalPendiente = pending.reduce((s, i) => s + i.total, 0);

  res.render('admin/finanzas/cuentas-cobrar', {
    activeFin: 'cuentas-cobrar',
    pending, aging, totalPendiente,
  });
});

// ── Flujo de Caja ─────────────────────────────────────────────────────────

router.get('/flujo-caja', requireAuth, requireAdmin, async (req, res) => {
  const [invoices, orders, gastos] = await Promise.all([getAllInvoices(), getAllOrders(), getAllGastos()]);
  const year = parseYear(req.query);

  const paidInvoices = invoices.filter(i => i.status === 'pagada');
  const paidOrders   = orders.filter(o => o.status === 'paid');

  const months = Array.from({ length: 12 }, (_, i) => {
    const m    = i + 1;
    const key  = `${year}-${String(m).padStart(2, '0')}`;
    const inv  = paidInvoices.filter(x => inPeriod(invIncomeDate(x), year, m)).reduce((s, x) => s + x.subtotal, 0);
    const ord  = paidOrders.filter(x => inPeriod(x.createdAt, year, m)).reduce((s, x) => s + x.total, 0);
    const gas  = gastos.filter(x => inPeriod(x.date, year, m)).reduce((s, x) => s + x.amount, 0);
    const ing  = inv + ord;
    const net  = ing - gas;
    return { key, label: MONTH_NAMES[i], m, inv, ord, gas, ing, net };
  });

  let acum = 0;
  const monthsWithAcum = months.map(mo => { acum += mo.net; return { ...mo, acum }; });

  const totIng = months.reduce((s, m) => s + m.ing, 0);
  const totGas = months.reduce((s, m) => s + m.gas, 0);
  const totNet = totIng - totGas;

  const maxAbs = Math.max(...months.map(m => Math.max(m.ing, m.gas)), 1);

  const availableYears = [];
  const nowYear = new Date().getFullYear();
  for (let y = nowYear - 2; y <= nowYear; y++) availableYears.push(y);

  res.render('admin/finanzas/flujo-caja', {
    activeFin: 'flujo-caja',
    year, availableYears, MONTH_NAMES,
    months: monthsWithAcum,
    totIng, totGas, totNet, maxAbs,
  });
});

// ── Estado de Resultados ──────────────────────────────────────────────────

router.get('/estado-resultados', requireAuth, requireAdmin, async (req, res) => {
  const [invoices, orders, gastos] = await Promise.all([getAllInvoices(), getAllOrders(), getAllGastos()]);
  const { param, year, month } = parsePeriod(req.query);

  const paidInvoices = invoices.filter(i => i.status === 'pagada');
  const paidOrders   = orders.filter(o => o.status === 'paid');

  const filter = (arr, dateKey) => arr.filter(x => inPeriod(x[dateKey], year, month));

  // Las facturas cuentan en su fecha de pago; pedidos y gastos por su fecha.
  const invPeriod = paidInvoices.filter(i => inPeriod(invIncomeDate(i), year, month));
  const ordPeriod = filter(paidOrders, 'createdAt');
  const gasPeriod = filter(gastos, 'date');

  const ingServicios = invPeriod.reduce((s, i) => s + i.subtotal, 0);
  const ingIVA       = invPeriod.reduce((s, i) => s + i.tax, 0);
  const ingVentas    = ordPeriod.reduce((s, o) => s + o.total, 0);
  const totalIngresos = ingServicios + ingVentas;

  const gastosPorCat = {};
  gasPeriod.forEach(g => { gastosPorCat[g.category] = (gastosPorCat[g.category] || 0) + g.amount; });
  const totalEgresos  = gasPeriod.reduce((s, g) => s + g.amount, 0);

  const utilidadBruta  = totalIngresos - totalEgresos;
  const margen         = totalIngresos > 0 ? ((utilidadBruta / totalIngresos) * 100).toFixed(1) : '0.0';

  // Previous period
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevYear  = month === 1 ? year - 1 : year;
  const filterPrev = (arr, dateKey) => arr.filter(x => inPeriod(x[dateKey], prevYear, prevMonth));
  const prevIng  = paidInvoices.filter(i => inPeriod(invIncomeDate(i), prevYear, prevMonth)).reduce((s, i) => s + i.subtotal, 0) + filterPrev(paidOrders, 'createdAt').reduce((s, o) => s + o.total, 0);
  const prevGas  = filterPrev(gastos, 'date').reduce((s, g) => s + g.amount, 0);
  const prevUtil = prevIng - prevGas;
  const ingDelta = prevIng > 0 ? Math.round(((totalIngresos - prevIng) / prevIng) * 100) : null;
  const gasDelta = prevGas > 0 ? Math.round(((totalEgresos - prevGas) / prevGas) * 100) : null;
  const netDelta = prevUtil !== 0 ? Math.round(((utilidadBruta - prevUtil) / Math.abs(prevUtil)) * 100) : null;

  res.render('admin/finanzas/estado-resultados', {
    activeFin: 'estado-resultados',
    periodParam: param, pYear: year, pMonth: month,
    periodLabel: `${MONTH_NAMES[month - 1]} ${year}`,
    prevLabel: `${MONTH_NAMES[prevMonth - 1]} ${prevYear}`,
    availablePeriods: getAvailablePeriods(),
    MONTH_NAMES, GASTO_CATS,
    invCount: invPeriod.length, ordCount: ordPeriod.length,
    ingServicios, ingIVA, ingVentas, totalIngresos,
    gastosPorCat, totalEgresos,
    utilidadBruta, margen,
    prevIng, prevGas, prevUtil,
    ingDelta, gasDelta, netDelta,
    cuentasPorCobrar: invoices.filter(i => i.status === 'pendiente').reduce((s, i) => s + i.total, 0),
  });
});

module.exports = router;
