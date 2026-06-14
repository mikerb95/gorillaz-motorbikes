'use strict';

// ── Resumen inteligente de cotizaciones ─────────────────────────────────────
//
// Calcula, en el servidor y a partir de datos reales, las métricas del panel
// superior de /admin/cotizaciones: volumen y valor del periodo, tasa de
// conversión (cotización → orden → factura), ticket promedio, comparación con
// el periodo anterior, embudo, seguimiento de pendientes, top de servicios y
// tendencia de 6 meses (sparkline).
//
// Todas las fechas se agrupan por día/mes/año calendario de Colombia (los
// timestamps se guardan en UTC; ver helpers/datetime.js).

const { isoCO } = require('./datetime');

const MES_CORTO = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const PERIODOS = {
  'mes':          'Este mes',
  'mes-anterior': 'Mes anterior',
  'anio':         'Este año',
  'todo':         'Histórico',
};

// Mes anterior a un "YYYY-MM".
function prevYM(ym) {
  let [y, m] = ym.split('-').map(Number);
  m -= 1;
  if (m === 0) { m = 12; y -= 1; }
  return `${y}-${String(m).padStart(2, '0')}`;
}

// Etiqueta corta de un "YYYY-MM" → "may", "dic 25".
function labelYM(ym, withYear = false) {
  const [y, m] = ym.split('-').map(Number);
  return withYear ? `${MES_CORTO[m - 1]} ${String(y).slice(2)}` : MES_CORTO[m - 1];
}

function daysBetween(isoA, isoB) {
  return Math.floor((new Date(isoB + 'T00:00:00Z') - new Date(isoA + 'T00:00:00Z')) / 86400000);
}

function pctDelta(cur, prev) {
  if (prev == null) return null;
  if (prev === 0) return cur > 0 ? 100 : 0;
  return Math.round(((cur - prev) / prev) * 100);
}

/**
 * @param {Array} quotations  cotizaciones confirmadas (status != 'draft')
 * @param {Array} orders      órdenes de servicio (con quotationId)
 * @param {Array} invoices    facturas (con quotationId)
 * @param {string} periodoParam  'mes' | 'mes-anterior' | 'anio' | 'todo'
 */
function buildQuotationSummary(quotations, orders, invoices, periodoParam) {
  const periodo = PERIODOS[periodoParam] ? periodoParam : 'mes';

  // Ids de cotizaciones que ya se convirtieron en orden / factura.
  const orderQids   = new Set((orders   || []).map(o => o.quotationId).filter(Boolean));
  const invoiceQids = new Set((invoices || []).map(i => i.quotationId).filter(Boolean));

  // Cada cotización con su fecha calendario de Colombia (YYYY-MM-DD).
  const q = (quotations || []).map(x => ({
    id: x.id,
    total: Number(x.total) || 0,
    items: Array.isArray(x.items) ? x.items : [],
    ymd: isoCO(x.createdAt) || '',
  }));

  const today = isoCO();          // YYYY-MM-DD
  const ym    = today.slice(0, 7); // YYYY-MM
  const year  = today.slice(0, 4); // YYYY

  // Predicados del periodo seleccionado y de su periodo anterior comparable.
  let curPred, prevPred, prevLabel;
  if (periodo === 'mes-anterior') {
    const pm = prevYM(ym), ppm = prevYM(pm);
    curPred = d => d.startsWith(pm); prevPred = d => d.startsWith(ppm); prevLabel = labelYM(ppm);
  } else if (periodo === 'anio') {
    const py = String(Number(year) - 1);
    curPred = d => d.startsWith(year); prevPred = d => d.startsWith(py); prevLabel = py;
  } else if (periodo === 'todo') {
    curPred = () => true; prevPred = null; prevLabel = null;
  } else { // mes
    const pm = prevYM(ym);
    curPred = d => d.startsWith(ym); prevPred = d => d.startsWith(pm); prevLabel = labelYM(pm);
  }

  function metrics(pred) {
    const list      = q.filter(x => pred(x.ymd));
    const count     = list.length;
    const value     = list.reduce((s, x) => s + x.total, 0);
    const avg       = count ? Math.round(value / count) : 0;
    const converted = list.filter(x => orderQids.has(x.id)).length;   // llegaron a orden
    const invoiced  = list.filter(x => invoiceQids.has(x.id)).length; // llegaron a factura
    return { count, value, avg, converted, invoiced, list };
  }

  const cur  = metrics(curPred);
  const prev = prevPred ? metrics(prevPred) : null;

  const convRate = cur.count ? Math.round((cur.converted / cur.count) * 100) : 0;
  const winRate  = cur.count ? Math.round((cur.invoiced  / cur.count) * 100) : 0;

  // Top servicios/productos del periodo (agregado por nombre).
  const byName = new Map();
  for (const x of cur.list) {
    for (const it of x.items) {
      const name = (it && it.name ? String(it.name) : '').trim();
      if (!name) continue;
      const qty   = Number(it.qty) || 0;
      const price = Number(it.price) || 0;
      const e = byName.get(name) || { name, qty: 0, value: 0 };
      e.qty   += qty;
      e.value += price * qty;
      byName.set(name, e);
    }
  }
  const topItems = [...byName.values()].sort((a, b) => b.value - a.value).slice(0, 3);

  // Seguimiento: cotizaciones confirmadas SIN orden (backlog actual, global).
  const pendientesList = q.filter(x => !orderQids.has(x.id));
  const pendientes     = pendientesList.length;
  const pendientesOld  = pendientesList.filter(x => x.ymd && daysBetween(x.ymd, today) > 7).length;

  // Sparkline: valor cotizado en los últimos 6 meses calendario.
  const keys = [];
  let k = ym;
  for (let i = 0; i < 6; i++) { keys.unshift(k); k = prevYM(k); }
  const spark = keys.map(key => ({
    label: labelYM(key),
    value: q.filter(x => x.ymd.startsWith(key)).reduce((s, x) => s + x.total, 0),
  }));

  return {
    periodo,
    periodoLabel: PERIODOS[periodo],
    prevLabel,
    // KPIs
    count:        cur.count,
    value:        cur.value,
    avg:          cur.avg,
    convRate,
    winRate,
    converted:    cur.converted,
    invoiced:     cur.invoiced,
    // deltas vs periodo anterior comparable
    valueDelta:   prev ? pctDelta(cur.value, prev.value) : null,
    countDelta:   prev ? pctDelta(cur.count, prev.count) : null,
    avgDelta:     prev ? pctDelta(cur.avg,   prev.avg)   : null,
    // seguimiento (global)
    pendientes,
    pendientesOld,
    // visualizaciones
    topItems,
    spark,
  };
}

module.exports = { buildQuotationSummary, PERIODOS };
