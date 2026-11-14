'use strict';
// Herramientas de LECTURA del asistente del panel. Ninguna escribe: una prueba
// (test/panel-ia) ejecuta cada una contra una base temporal y compara la base
// antes y después.
//
// Reglas (skill panel-ia):
//  - Columnas nombradas en cada SELECT (nunca SELECT *): ni hashes de PIN, ni
//    tokens, ni sesiones llegan al modelo.
//  - Límite de filas en cada lista y conteos cuando la pregunta es "cuántos".
//  - Dinero ya formateado ({ valor, texto }): el modelo no hace cuentas.
//  - Fechas en hora Colombia.
//  - Texto que pudo escribir un cliente va dentro de `escritoPorTerceros`.
//  - Cada fila trae su `enlace` del panel, para que el modelo no invente rutas.
//  - `ejecutar` nunca lanza: devuelve { ok: false, error }.

const { fmtCOP } = require('../money');
const { hoyCO, fechaCO, fechaHoraCO } = require('../datetime');
const { unitPrice } = require('../shop/pricing');
const settings = require('../settings');
const { buscarEnMenu } = require('./menu');

const dbc = () => require('../../db').db;

const LIMITE = 20;
const MAX_TEXTO = 600;

const ESTADOS_ORDEN = {
  pendiente: 'Pendiente',
  ingreso_taller: 'Ingreso a taller',
  trabajo_en_curso: 'Trabajo en curso',
  en_pausa: 'En pausa',
  trabajo_completo: 'Trabajo completo',
  facturado: 'Facturado (proforma)',
  entregado: 'Entregado',
};
const EVENTOS = {
  ...ESTADOS_ORDEN,
  editado: 'Orden editada',
  comentario: 'Comentario',
  factura_generada: 'Factura proforma generada',
  factura_anulada: 'Factura anulada',
  factura_cerrada: 'Factura cerrada al entregar',
  factura_enviada_wa: 'Factura enviada por WhatsApp',
};

const dinero = (n) => ({ valor: Math.round(Number(n) || 0), texto: fmtCOP(n) });
const textoSeguro = (t) => (t == null ? null : String(t).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXTO) || null);
const ok = (datos) => ({ ok: true, datos });
const fallo = (error) => ({ ok: false, error });
const safeJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const escaparLike = (t) => String(t).replace(/[\\%_]/g, (c) => '\\' + c);

const COLS_ORDEN = `id, label, items, total, motorcycle, client_phone, client_phone_country, mechanic, employee_id,
  status, notes, estimated_date, invoice_id, pending_review, created_at, updated_at`;

function resumenOrden(r) {
  const items = safeJson(r.items, []);
  return {
    id: r.id,
    consecutivo: r.label,
    moto: r.motorcycle || null,
    telefono: r.client_phone ? `${r.client_phone_country || '+57'} ${r.client_phone}` : null,
    mecanico: r.mechanic || null,
    estado: r.status,
    estadoTexto: ESTADOS_ORDEN[r.status] || r.status,
    fechaEstimada: r.estimated_date || null,
    total: dinero(r.total),
    items: items.length,
    facturada: !!r.invoice_id,
    itemsEditables: !r.invoice_id,
    revisarTaller: Number(r.pending_review) === 1,
    creada: fechaCO(r.created_at),
    enlace: `/admin/ordenes-servicio/${r.id}`,
  };
}

async function buscarOrdenPorRef(ref) {
  const db = dbc();
  const limpio = String(ref || '').trim();
  if (!limpio) return null;
  const r = await db.execute({
    sql: `SELECT ${COLS_ORDEN} FROM service_orders WHERE id = ? OR UPPER(label) = UPPER(?) LIMIT 1`,
    args: [limpio, limpio],
  });
  return r.rows[0] || null;
}

// ── Órdenes ────────────────────────────────────────────────────────────────

const resumen_ordenes = {
  nombre: 'resumen_ordenes',
  descripcion: 'Cómo va el taller: cuántas órdenes hay en cada estado, cuáles vencen hoy o están atrasadas (fecha estimada) y cuáles marcó el taller para revisión. Úsala para "¿cómo va el taller?" o "¿qué está pendiente?".',
  esquema: { type: 'object', properties: {}, additionalProperties: false },
  async ejecutar() {
    const db = dbc();
    const hoy = hoyCO();
    const [conteos, vencen, revisar] = await Promise.all([
      db.execute('SELECT status, COUNT(*) AS n FROM service_orders GROUP BY status'),
      db.execute({
        sql: `SELECT ${COLS_ORDEN} FROM service_orders
              WHERE estimated_date IS NOT NULL AND estimated_date != '' AND estimated_date <= ?
                AND status NOT IN ('entregado','facturado')
              ORDER BY estimated_date ASC LIMIT ${LIMITE}`,
        args: [hoy],
      }),
      db.execute(`SELECT ${COLS_ORDEN} FROM service_orders WHERE pending_review = 1 ORDER BY updated_at DESC LIMIT ${LIMITE}`),
    ]);
    return ok({
      hoy,
      porEstado: conteos.rows.map((r) => ({ estado: r.status, estadoTexto: ESTADOS_ORDEN[r.status] || r.status, cantidad: Number(r.n) })),
      vencenHoyOAtrasadas: vencen.rows.map(resumenOrden),
      paraRevisarDelTaller: revisar.rows.map(resumenOrden),
      enlace: '/admin/ordenes-servicio',
    });
  },
};

const buscar_ordenes = {
  nombre: 'buscar_ordenes',
  descripcion: 'Busca órdenes de servicio por placa, consecutivo (OS-...), teléfono del cliente, estado o mecánico. Devuelve máximo 20, las más recientes primero. Úsala para "¿qué órdenes tiene la ABC12D?" o para encontrar el id antes de proponer un cambio.',
  esquema: {
    type: 'object',
    properties: {
      texto: { type: 'string', maxLength: 60, description: 'Placa, consecutivo (OS-0153), teléfono o parte del nombre de la moto.' },
      estado: { type: 'string', enum: Object.keys(ESTADOS_ORDEN), description: 'Filtra por estado.' },
      mecanico: { type: 'string', maxLength: 60, description: 'Nombre (o parte) del mecánico asignado.' },
      incluirEntregadas: { type: 'boolean', description: 'Por defecto solo trae órdenes sin entregar.' },
    },
    additionalProperties: false,
  },
  async ejecutar(e) {
    const db = dbc();
    const where = [];
    const args = [];
    if (e.texto && e.texto.trim()) {
      const t = e.texto.trim().toUpperCase();
      const sinEspacios = escaparLike(t.replace(/\s/g, ''));
      const digitos = t.replace(/\D/g, '');
      const ors = [`UPPER(REPLACE(motorcycle, ' ', '')) LIKE ? ESCAPE '\\'`, 'UPPER(label) LIKE ?'];
      args.push(`%${sinEspacios}%`, `%${escaparLike(t)}%`);
      if (digitos.length >= 6) {
        ors.push('client_phone LIKE ?');
        args.push(`%${digitos}%`);
      }
      where.push(`(${ors.join(' OR ')})`);
    }
    if (e.estado) {
      where.push('status = ?');
      args.push(e.estado);
    } else if (!e.incluirEntregadas) {
      where.push("status != 'entregado'");
    }
    if (e.mecanico && e.mecanico.trim()) {
      where.push("UPPER(COALESCE(mechanic,'')) LIKE ? ESCAPE '\\'");
      args.push(`%${escaparLike(e.mecanico.trim().toUpperCase())}%`);
    }
    const sql = `SELECT ${COLS_ORDEN} FROM service_orders ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
                 ORDER BY created_at DESC LIMIT ${LIMITE}`;
    const r = await db.execute({ sql, args });
    return ok({ cantidad: r.rows.length, limite: LIMITE, ordenes: r.rows.map(resumenOrden) });
  },
};

const ver_orden = {
  nombre: 'ver_orden',
  descripcion: 'Detalle de una orden: ítems con índice, precio y cantidad, total, estado, mecánico, factura vinculada y línea de tiempo. Úsala antes de editar ítems o cambiar el estado.',
  esquema: {
    type: 'object',
    properties: { orden: { type: 'string', minLength: 1, maxLength: 60, description: 'Id de la orden (sale de buscar_ordenes) o su consecutivo, por ejemplo OS-0153.' } },
    required: ['orden'],
    additionalProperties: false,
  },
  async ejecutar(e) {
    const db = dbc();
    const r = await buscarOrdenPorRef(e.orden);
    if (!r) return fallo('No encontré esa orden. Búscala primero con buscar_ordenes.');
    const [evs, fac] = await Promise.all([
      db.execute({
        sql: 'SELECT status, actor, detail, created_at FROM service_order_events WHERE service_order_id = ? ORDER BY created_at DESC LIMIT 15',
        args: [r.id],
      }),
      r.invoice_id
        ? db.execute({ sql: 'SELECT id, label, status, total FROM invoices WHERE id = ?', args: [r.invoice_id] })
        : Promise.resolve({ rows: [] }),
    ]);
    const items = safeJson(r.items, []).map((it, i) => ({
      indice: i,
      nombre: it.name,
      tipo: it.type || 'custom',
      precio: dinero(it.price),
      cantidad: Number(it.qty) || 1,
      subtotal: dinero((Number(it.price) || 0) * (Number(it.qty) || 1)),
    }));
    const f = fac.rows[0];
    return ok({
      ...resumenOrden(r),
      itemsDetalle: items,
      factura: f ? { consecutivo: f.label, estado: f.status, total: dinero(f.total), enlace: `/admin/facturas/${f.id}` } : null,
      lineaDeTiempo: evs.rows.map((ev) => ({
        fecha: fechaHoraCO(ev.created_at),
        evento: EVENTOS[ev.status] || ev.status,
        por: ev.actor || null,
      })),
      escritoPorTerceros: {
        notas: textoSeguro(r.notes),
        detallesDeEventos: evs.rows.map((ev) => textoSeguro(ev.detail)).filter(Boolean),
      },
    });
  },
};

// ── Productos de la tienda ───────────────────────────────────────────────────

function fichaProducto(p, variantes) {
  const precio = unitPrice({ price: Number(p.price) || 0, discount: p.discount, clubDiscount: p.club_discount });
  const stockVariantes = variantes.length
    ? (variantes.some((v) => v.stock === null) ? null : variantes.reduce((s, v) => s + (Number(v.stock) || 0), 0))
    : null;
  const stock = variantes.length ? stockVariantes : (p.stock === null ? null : Number(p.stock));
  return {
    id: p.id,
    nombre: p.name,
    marca: p.brand || null,
    sku: p.sku || null,
    categoria: p.category || null,
    estado: p.status === 'active' ? 'publicado' : 'borrador',
    precio: dinero(p.price),
    descuentoPct: Number(p.discount) || 0,
    descuentoClubPct: Number(p.club_discount) || 0,
    precioConDescuento: dinero(precio.regular),
    precioClub: precio.club !== null ? dinero(precio.club) : null,
    precioInstalacion: p.install_price === null || p.install_price === undefined ? null : dinero(p.install_price),
    instalable: Number(p.installable) === 1,
    stock: stock === null ? 'sin control de inventario' : stock,
    variantes: variantes.map((v) => ({
      id: v.id,
      nombre: [v.color, v.size].filter(Boolean).join(' / ') || v.sku || 'Variante',
      sku: v.sku || null,
      precio: v.price === null ? 'igual al del producto' : dinero(v.price),
      stock: v.stock === null ? 'sin control de inventario' : Number(v.stock),
    })),
    enlace: `/admin/tienda/${p.id}/editar`,
  };
}

const COLS_PRODUCTO = 'id, name, brand, sku, category, price, discount, club_discount, install_price, installable, stock, status';

async function variantesDe(ids) {
  if (!ids.length) return {};
  const r = await dbc().execute({
    sql: `SELECT id, product_id, sku, color, size, price, stock FROM product_variants WHERE product_id IN (${ids.map(() => '?').join(',')}) ORDER BY position`,
    args: ids,
  });
  const out = {};
  for (const v of r.rows) (out[v.product_id] = out[v.product_id] || []).push(v);
  return out;
}

const buscar_productos = {
  nombre: 'buscar_productos',
  descripcion: 'Busca productos de la tienda por nombre, marca, SKU o categoría. Trae precio, descuentos (%), precio con descuento, precio club, precio de instalación, stock y variantes. Máximo 20. Úsala para "¿cuánto vale el Motul 7100?" o para encontrar el id antes de cambiar un precio o el stock.',
  esquema: {
    type: 'object',
    properties: {
      texto: { type: 'string', maxLength: 80, description: 'Nombre, marca, SKU o categoría (o parte).' },
      soloAgotados: { type: 'boolean', description: 'Solo productos con stock 0.' },
    },
    additionalProperties: false,
  },
  async ejecutar(e) {
    const db = dbc();
    const where = ['1 = 1'];
    const args = [];
    if (e.texto && e.texto.trim()) {
      const palabras = e.texto.trim().toUpperCase().split(/\s+/).slice(0, 5);
      for (const w of palabras) {
        where.push(`(UPPER(name) LIKE ? ESCAPE '\\' OR UPPER(brand) LIKE ? ESCAPE '\\' OR UPPER(sku) LIKE ? ESCAPE '\\' OR UPPER(category) LIKE ? ESCAPE '\\')`);
        const t = `%${escaparLike(w)}%`;
        args.push(t, t, t, t);
      }
    }
    if (e.soloAgotados) where.push('stock = 0');
    const r = await db.execute({
      sql: `SELECT ${COLS_PRODUCTO} FROM products WHERE ${where.map((w) => `(${w})`).join(' AND ')} ORDER BY name COLLATE NOCASE LIMIT ${LIMITE}`,
      args,
    });
    const vars = await variantesDe(r.rows.map((p) => p.id));
    return ok({ cantidad: r.rows.length, limite: LIMITE, productos: r.rows.map((p) => fichaProducto(p, vars[p.id] || [])) });
  },
};

const ver_producto = {
  nombre: 'ver_producto',
  descripcion: 'Ficha de un producto de la tienda con sus variantes (id, precio y stock de cada una). Úsala antes de cambiar el precio o el stock de una variante.',
  esquema: {
    type: 'object',
    properties: { producto: { type: 'string', minLength: 1, maxLength: 80, description: 'Id del producto (sale de buscar_productos).' } },
    required: ['producto'],
    additionalProperties: false,
  },
  async ejecutar(e) {
    const r = await dbc().execute({ sql: `SELECT ${COLS_PRODUCTO} FROM products WHERE id = ? OR slug = ? LIMIT 1`, args: [e.producto, e.producto] });
    const p = r.rows[0];
    if (!p) return fallo('No encontré ese producto. Búscalo primero con buscar_productos.');
    const vars = await variantesDe([p.id]);
    return ok(fichaProducto(p, vars[p.id] || []));
  },
};

// ── Apoyo ─────────────────────────────────────────────────────────────────

const listar_mecanicos = {
  nombre: 'listar_mecanicos',
  descripcion: 'Mecánicos (empleados activos del taller) con su id y cuántas órdenes abiertas tiene cada uno. Úsala para asignar una orden.',
  esquema: { type: 'object', properties: {}, additionalProperties: false },
  async ejecutar() {
    const db = dbc();
    const [emps, carga] = await Promise.all([
      db.execute('SELECT id, name FROM employees WHERE active = 1 ORDER BY name COLLATE NOCASE'),
      db.execute("SELECT employee_id, COUNT(*) AS n FROM service_orders WHERE status NOT IN ('entregado','facturado') AND employee_id IS NOT NULL GROUP BY employee_id"),
    ]);
    const n = Object.fromEntries(carga.rows.map((r) => [r.employee_id, Number(r.n)]));
    return ok({ mecanicos: emps.rows.map((e) => ({ id: e.id, nombre: e.name, ordenesAbiertas: n[e.id] || 0 })) });
  },
};

const catalogo_servicios = {
  nombre: 'catalogo_servicios',
  descripcion: 'Nombres de los servicios del cotizador (mecánica, pintura, etc.). No traen precio: el precio de cada ítem lo dice la persona. Úsala para nombrar bien los ítems de una orden.',
  esquema: { type: 'object', properties: {}, additionalProperties: false },
  async ejecutar() {
    let lista = settings.get('services_catalog');
    if (!Array.isArray(lista)) {
      try { lista = require('../../data/services-catalog.json'); } catch { lista = []; }
    }
    return ok({ servicios: lista.slice(0, 80).map((s) => s.name), enlace: '/admin/cotizador-items' });
  },
};

const citas_de_hoy = {
  nombre: 'citas_de_hoy',
  descripcion: 'Citas agendadas para hoy (hora Colombia), o para la fecha que se indique, sin las canceladas.',
  esquema: {
    type: 'object',
    properties: { fecha: { type: 'string', pattern: '^\\d{4}-\\d{2}-\\d{2}$', description: 'AAAA-MM-DD. Si no se indica, hoy.' } },
    additionalProperties: false,
  },
  async ejecutar(e) {
    const fecha = e.fecha || hoyCO();
    const r = await dbc().execute({
      sql: `SELECT id, time, service, plate, status, name, phone, notes FROM appointments
            WHERE date = ? AND status != 'cancelada' ORDER BY time ASC LIMIT ${LIMITE}`,
      args: [fecha],
    });
    return ok({
      fecha,
      citas: r.rows.map((c) => ({
        hora: c.time || null,
        servicio: c.service || null,
        placa: c.plate || null,
        estado: c.status,
        telefono: c.phone || null,
        escritoPorTerceros: { nombre: textoSeguro(c.name), notas: textoSeguro(c.notes) },
      })),
      enlace: '/admin/citas',
    });
  },
};

const buscar_en_panel = {
  nombre: 'buscar_en_panel',
  descripcion: 'Secciones del panel admin y su enlace. Úsala cuando pregunten dónde ver o hacer algo ("¿dónde veo las facturas?").',
  esquema: {
    type: 'object',
    properties: { texto: { type: 'string', minLength: 2, maxLength: 60, description: 'Qué busca la persona.' } },
    required: ['texto'],
    additionalProperties: false,
  },
  async ejecutar(e) {
    const secciones = buscarEnMenu(e.texto);
    return ok({ secciones, nota: secciones.length ? null : 'No encontré una sección con ese nombre.' });
  },
};

const HERRAMIENTAS = [
  resumen_ordenes, buscar_ordenes, ver_orden,
  buscar_productos, ver_producto,
  listar_mecanicos, catalogo_servicios, citas_de_hoy, buscar_en_panel,
];

module.exports = { HERRAMIENTAS, ESTADOS_ORDEN, dinero, buscarOrdenPorRef, COLS_ORDEN, resumenOrden, fichaProducto, variantesDe, COLS_PRODUCTO };
