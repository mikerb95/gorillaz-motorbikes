'use strict';
// Escrituras del asistente del panel. NINGUNA se ejecuta sola: el modelo la
// propone, `preparar` lee la base y arma la tarjeta (sin escribir nada), y solo
// cuando el admin hace clic en "Aprobar" corre `ejecutar`.
//
// `ejecutar` vuelve a preparar contra la base actual y compara los cambios con
// los de la tarjeta aprobada: si la orden o el producto cambió mientras tanto
// (otra pestaña, el taller), no escribe y lo dice. Además las condiciones van
// en el propio UPDATE (WHERE items = ?, WHERE price = ?) para que dos escrituras
// simultáneas no se pisen.
//
// Solo crea y actualiza; nunca borra. Facturas, entrega y pagos quedan fuera.

const crypto = require('crypto');
const { ALLOWED_STATUS } = require('../service-order-status');
const { fmtCOP } = require('../money');
const { unitPrice } = require('../shop/pricing');
const { buscarOrdenPorRef, ESTADOS_ORDEN, COLS_PRODUCTO, motoTexto } = require('./herramientas');

const dbc = () => require('../../db');

const MAX_ITEMS = 40;
const safeJson = (s, d) => { try { return s ? JSON.parse(s) : d; } catch { return d; } };
const fallo = (error) => ({ ok: false, error });
const linea = (it) => `${it.qty} × ${fmtCOP(it.price)} · ${it.name}`;
const totalDe = (items) => items.reduce((s, it) => s + it.price * it.qty, 0);
const afectadas = (r) => r.rowsAffected ?? r.changes ?? 0;
const actorDe = (ctx) => `${ctx.usuario.nombre || 'Admin'} (asistente)`;
const FECHA = '^\\d{4}-\\d{2}-\\d{2}$';

/** Id estable a partir del tool_use: reintentar la misma aprobación no duplica. */
function idDesde(toolUseId, sal) {
  const h = crypto.createHash('sha256').update(`${sal}:${toolUseId}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function vista({ rotulo, titulo, contexto = null, cambios, avisos = [], boton = 'Aprobar y guardar', nota = 'Nada se guarda hasta que apruebes.' }) {
  return { tipo: 'cambio', rotulo, titulo, contexto, cambios, avisos, boton, nota };
}

/** El mecánico solo cambia sus órdenes (misma regla que /taller/orden/:id). */
function ajenaParaMecanico(r, ctx) {
  return ctx && ctx.usuario && ctx.usuario.rol === 'mecanico' && r.employee_id !== ctx.usuario.empleadoId
    ? `La orden ${r.label} no está asignada a ti. Pídele al admin que te la asigne.`
    : null;
}

async function ordenEditable(ref, ctx) {
  const r = await buscarOrdenPorRef(ref);
  if (!r) return { error: 'No encontré esa orden. Búscala primero con buscar_ordenes.' };
  if (r.status === 'entregado') return { error: `La orden ${r.label} ya se entregó; no se puede modificar.` };
  const ajena = ajenaParaMecanico(r, ctx);
  if (ajena) return { error: ajena };
  return { orden: r };
}

async function empleadoActivo(id) {
  const r = await dbc().db.execute({ sql: 'SELECT id, name FROM employees WHERE id = ? AND active = 1', args: [id] });
  return r.rows[0] || null;
}

const ESQUEMA_ITEM = {
  type: 'object',
  properties: {
    nombre: { type: 'string', minLength: 1, maxLength: 200, description: 'Nombre del ítem, tal como lo dijo la persona o como aparece en catalogo_servicios.' },
    tipo: { type: 'string', enum: ['service', 'product', 'custom'], description: 'service = mano de obra o servicio, product = repuesto o producto, custom = otro.' },
    precio: { type: 'integer', minimum: 1, maximum: 100000000, description: 'Precio unitario en pesos, sin puntos. Lo dice la persona; nunca lo inventes.' },
    cantidad: { type: 'integer', minimum: 1, maximum: 999 },
  },
  required: ['nombre', 'precio', 'cantidad'],
  additionalProperties: false,
};

// ── 1. Crear orden de servicio ───────────────────────────────────────────────

const crear_orden_servicio = {
  nombre: 'crear_orden_servicio',
  descripcion: 'Crea una orden de servicio nueva en estado "Ingreso a taller", con sus ítems (nombre, tipo, precio y cantidad). El consecutivo y el total los calcula el servidor. No se ejecuta sola: el admin ve la orden en una tarjeta y decide. Si vas a asignar mecánico, busca su id con listar_mecanicos.',
  esquema: {
    type: 'object',
    properties: {
      placa: { type: 'string', maxLength: 10, description: 'Placa de la moto, por ejemplo ABC12D.' },
      moto: { type: 'string', maxLength: 80, description: 'Marca y referencia, por ejemplo Pulsar NS200.' },
      telefono: { type: 'string', maxLength: 20, description: 'Celular del cliente (solo números).' },
      items: { type: 'array', minItems: 1, maxItems: MAX_ITEMS, items: ESQUEMA_ITEM },
      mecanicoId: { type: 'string', maxLength: 60, description: 'Id del mecánico (sale de listar_mecanicos).' },
      fechaEstimada: { type: 'string', pattern: FECHA, description: 'Fecha estimada de entrega AAAA-MM-DD.' },
      notas: { type: 'string', maxLength: 500, description: 'Notas de la orden, solo si la persona las dio.' },
    },
    required: ['items'],
    additionalProperties: false,
  },
  async preparar(e, ctx) {
    const placa = (e.placa || '').toUpperCase().replace(/\s/g, '');
    const moto = (e.moto || '').trim();
    const telefono = (e.telefono || '').replace(/\D/g, '');
    if (!placa && !moto) return fallo('Falta la placa o la moto. Pregúntasela a la persona.');
    let mecanico = null;
    if (ctx && ctx.usuario && ctx.usuario.rol === 'mecanico') {
      // El ingreso que da un mecánico queda asignado a él.
      if (e.mecanicoId && e.mecanicoId !== ctx.usuario.empleadoId) return fallo('Desde aquí solo puedes dar ingreso a motos que quedan asignadas a ti.');
      mecanico = await empleadoActivo(ctx.usuario.empleadoId);
      if (!mecanico) return fallo('Tu usuario del taller está inactivo.');
    } else if (e.mecanicoId) {
      mecanico = await empleadoActivo(e.mecanicoId);
      if (!mecanico) return fallo('Ese mecánico no existe o está inactivo. Revisa listar_mecanicos.');
    }
    const items = e.items.map((it) => ({ name: it.nombre.trim().slice(0, 200), type: it.tipo || 'custom', price: it.precio, qty: it.cantidad }));
    const total = totalDe(items);
    const cambios = [
      placa && { campo: 'Placa', antes: null, despues: placa },
      moto && { campo: 'Moto', antes: null, despues: moto },
      telefono && { campo: 'Teléfono', antes: null, despues: `+57 ${telefono}` },
      mecanico && { campo: 'Mecánico', antes: null, despues: mecanico.name },
      e.fechaEstimada && { campo: 'Fecha estimada', antes: null, despues: e.fechaEstimada },
      e.notas && { campo: 'Notas', antes: null, despues: e.notas.trim() },
      ...items.map((it, i) => ({ campo: `Ítem ${i + 1}`, antes: null, despues: linea(it) })),
      { campo: 'Total', antes: null, despues: fmtCOP(total) },
    ].filter(Boolean);
    return {
      ok: true,
      origen: `Crear orden de servicio ${placa || moto}`,
      motivo: `${items.length} ítem(s), total ${fmtCOP(total)}`,
      vista: vista({
        rotulo: 'Orden de servicio nueva',
        titulo: [placa, moto].filter(Boolean).join(' · '),
        contexto: 'Nace en "Ingreso a taller".',
        cambios,
        avisos: ['La orden aparece de inmediato en el tablero del taller (KDS) y en el portal del mecánico.'],
        boton: 'Crear orden',
      }),
      plan: { placa, moto, telefono, mecanico, items, total, fechaEstimada: e.fechaEstimada || null, notas: (e.notas || '').trim() || null },
    };
  },
  async escribir(p, ctx, extra) {
    const { createServiceOrder, getServiceOrderById } = dbc();
    const id = idDesde(extra.toolUseId, 'orden');
    const previa = await getServiceOrderById(id);
    if (previa) return { hecho: true, resumen: `La orden ${previa.label} ya estaba creada.`, enlace: `/admin/ordenes-servicio/${id}`, consecutivo: previa.label };
    const r = await createServiceOrder({
      id,
      items: p.items,
      total: p.total,
      // Mismo formato "PLACA <raya> moto" que guarda el panel (plateFromOrder lo lee).
      motorcycle: [p.placa, p.moto].filter(Boolean).join(' \u2014 ') || null,
      clientPhone: p.telefono || null,
      clientPhoneCountry: '+57',
      employeeId: p.mecanico ? p.mecanico.id : null,
      mechanic: p.mecanico ? p.mecanico.name : null,
      notes: p.notas,
      estimatedDate: p.fechaEstimada,
      status: 'ingreso_taller',
      actor: actorDe(ctx),
    });
    return { hecho: true, resumen: `Orden ${r.label} creada por ${fmtCOP(p.total)}.`, consecutivo: r.label, total: { valor: p.total, texto: fmtCOP(p.total) }, enlace: `/admin/ordenes-servicio/${id}` };
  },
};

// ── 2. Editar ítems de una orden ─────────────────────────────────────────────

const editar_items_orden = {
  nombre: 'editar_items_orden',
  descripcion: 'Cambia nombre, precio o cantidad de ítems de una orden, agrega ítems nuevos o quita ítems, y recalcula el total. Usa los índices que trae ver_orden. Solo en órdenes sin factura (con factura los ítems quedan congelados). No se ejecuta sola: el admin ve el antes y el después y decide.',
  esquema: {
    type: 'object',
    properties: {
      orden: { type: 'string', minLength: 1, maxLength: 60, description: 'Id o consecutivo de la orden.' },
      cambios: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: {
          type: 'object',
          properties: {
            accion: { type: 'string', enum: ['cambiar', 'agregar', 'quitar'] },
            indice: { type: 'integer', minimum: 0, maximum: 200, description: 'Índice del ítem (de ver_orden). Para cambiar y quitar.' },
            nombre: { type: 'string', minLength: 1, maxLength: 200 },
            tipo: { type: 'string', enum: ['service', 'product', 'custom'] },
            precio: { type: 'integer', minimum: 1, maximum: 100000000, description: 'Precio unitario en pesos.' },
            cantidad: { type: 'integer', minimum: 1, maximum: 999 },
          },
          required: ['accion'],
          additionalProperties: false,
        },
      },
    },
    required: ['orden', 'cambios'],
    additionalProperties: false,
  },
  async preparar(e, ctx) {
    const { orden: r, error } = await ordenEditable(e.orden, ctx);
    if (error) return fallo(error);
    if (r.invoice_id) return fallo(`La orden ${r.label} ya tiene factura: sus ítems están congelados. Para editarlos hay que devolver su estado (eso anula la proforma) desde el detalle de la orden.`);
    const antes = safeJson(r.items, []);
    const nuevos = antes.map((it) => ({ ...it }));
    const quitar = new Set();
    const agregados = [];
    const cambios = [];
    for (const c of e.cambios) {
      if (c.accion === 'agregar') {
        if (!c.nombre || !c.precio || !c.cantidad) return fallo('Para agregar un ítem necesito nombre, precio y cantidad.');
        const it = { name: c.nombre.trim().slice(0, 200), type: c.tipo || 'custom', price: c.precio, qty: c.cantidad };
        agregados.push(it);
        cambios.push({ campo: 'Ítem nuevo', antes: null, despues: linea(it) });
        continue;
      }
      if (c.indice === undefined || c.indice === null || !antes[c.indice]) return fallo(`El índice ${c.indice} no existe en la orden ${r.label}. Revisa ver_orden.`);
      if (quitar.has(c.indice)) return fallo(`El ítem ${c.indice} ya se quita en esta misma propuesta.`);
      if (c.accion === 'quitar') {
        quitar.add(c.indice);
        cambios.push({ campo: `Quitar: ${antes[c.indice].name}`, antes: linea(antes[c.indice]), despues: null });
        continue;
      }
      const it = nuevos[c.indice];
      if (c.nombre === undefined && c.precio === undefined && c.cantidad === undefined && c.tipo === undefined) return fallo('Un cambio necesita nombre, precio, cantidad o tipo.');
      if (c.nombre !== undefined) it.name = c.nombre.trim().slice(0, 200);
      if (c.precio !== undefined) it.price = c.precio;
      if (c.cantidad !== undefined) it.qty = c.cantidad;
      if (c.tipo !== undefined) it.type = c.tipo;
    }
    nuevos.forEach((it, i) => {
      if (quitar.has(i)) return;
      const a = antes[i];
      if (a.name !== it.name || a.price !== it.price || a.qty !== it.qty || (a.type || 'custom') !== (it.type || 'custom')) {
        cambios.unshift({ campo: `Ítem: ${a.name}`, antes: linea(a), despues: linea(it) });
      }
    });
    const final = [...nuevos.filter((_, i) => !quitar.has(i)), ...agregados];
    if (!final.length) return fallo('La orden no puede quedar sin ítems.');
    if (final.length > MAX_ITEMS) return fallo(`Una orden admite máximo ${MAX_ITEMS} ítems.`);
    if (!cambios.length) return fallo('Esos valores ya son los actuales; no hay nada que cambiar.');
    const totalAntes = totalDe(antes);
    const totalDespues = totalDe(final);
    if (totalAntes !== totalDespues) cambios.push({ campo: 'Total', antes: fmtCOP(totalAntes), despues: fmtCOP(totalDespues) });
    return {
      ok: true,
      origen: `Editar ítems de ${r.label}`,
      motivo: `${cambios.length} cambio(s); total ${fmtCOP(totalDespues)}`,
      vista: vista({
        rotulo: 'Ítems de la orden',
        titulo: r.label,
        contexto: [motoTexto(r.motorcycle), ESTADOS_ORDEN[r.status]].filter(Boolean).join(' · '),
        cambios,
        avisos: [],
      }),
      plan: { id: r.id, label: r.label, itemsAntes: r.items, final, totalDespues, resumen: cambios.map((c) => c.campo).join(', ') },
    };
  },
  async escribir(p, ctx) {
    const { db, addServiceOrderEvent } = dbc();
    const r = await db.execute({
      sql: `UPDATE service_orders SET items = ?, total = ?, pending_review = 0, updated_at = ?
            WHERE id = ? AND items = ? AND invoice_id IS NULL AND status != 'entregado'`,
      args: [JSON.stringify(p.final), p.totalDespues, new Date().toISOString(), p.id, p.itemsAntes],
    });
    if (afectadas(r) === 0) return fallo('La orden cambió justo antes de guardar; no se aplicó nada. Vuelve a revisarla con ver_orden.');
    await addServiceOrderEvent(p.id, 'editado', actorDe(ctx), p.resumen.slice(0, 300));
    return { hecho: true, resumen: `Ítems de ${p.label} actualizados. Total: ${fmtCOP(p.totalDespues)}.`, total: { valor: p.totalDespues, texto: fmtCOP(p.totalDespues) }, enlace: `/admin/ordenes-servicio/${p.id}` };
  },
};

// ── 3. Cambiar estado ───────────────────────────────────────────────────────

const cambiar_estado_orden = {
  nombre: 'cambiar_estado_orden',
  descripcion: 'Cambia el estado de una orden a ingreso_taller, trabajo_en_curso, en_pausa o trabajo_completo, con la misma política del panel: pasar a trabajo_completo genera la factura proforma y devolver el estado anula la proforma viva. Nunca entrega la moto (eso es el formulario de entrega del detalle). No se ejecuta sola: el admin ve el cambio y sus efectos, y decide.',
  esquema: {
    type: 'object',
    properties: {
      orden: { type: 'string', minLength: 1, maxLength: 60, description: 'Id o consecutivo de la orden.' },
      estado: { type: 'string', enum: ALLOWED_STATUS },
    },
    required: ['orden', 'estado'],
    additionalProperties: false,
  },
  async preparar(e, ctx) {
    const { orden: r, error } = await ordenEditable(e.orden, ctx);
    if (error) return fallo(error);
    if (r.status === e.estado) return fallo(`La orden ${r.label} ya está en "${ESTADOS_ORDEN[e.estado]}".`);
    const avisos = [];
    let factura = null;
    if (r.invoice_id) {
      const f = await dbc().db.execute({ sql: 'SELECT label, status FROM invoices WHERE id = ?', args: [r.invoice_id] });
      factura = f.rows[0] || null;
    }
    if (factura && factura.status !== 'proforma' && factura.status !== 'anulada') {
      return fallo(`La factura ${factura.label} de esta orden ya está cerrada; su estado no se puede cambiar.`);
    }
    let destino = e.estado;
    if (e.estado === 'trabajo_completo') {
      if (factura && factura.status === 'proforma') {
        destino = 'facturado';
        avisos.push(`Ya tiene la proforma ${factura.label}: la orden queda como "Facturado (proforma)".`);
      } else {
        avisos.push('Se genera automáticamente la factura proforma con los ítems actuales y desde ahí los ítems quedan congelados.');
      }
    } else if (factura && factura.status === 'proforma') {
      avisos.push(`Se anula la factura proforma ${factura.label} y la orden vuelve a ser editable.`);
    }
    if (destino === r.status) return fallo(`La orden ${r.label} ya está en "${ESTADOS_ORDEN[destino]}".`);
    avisos.push('El cambio se ve de inmediato en el tablero del taller.');
    return {
      ok: true,
      origen: `Cambiar estado de ${r.label}`,
      motivo: `${ESTADOS_ORDEN[r.status] || r.status} → ${ESTADOS_ORDEN[destino]}`,
      vista: vista({
        rotulo: 'Estado de la orden',
        titulo: r.label,
        contexto: motoTexto(r.motorcycle),
        cambios: [{ campo: 'Estado', antes: ESTADOS_ORDEN[r.status] || r.status, despues: ESTADOS_ORDEN[destino] }],
        avisos,
        boton: 'Cambiar estado',
      }),
      plan: { id: r.id, label: r.label, estado: e.estado },
    };
  },
  async escribir(p, ctx) {
    const { getServiceOrderById } = dbc();
    const { cambiarEstadoOrden } = require('../service-order-actions');
    const order = await getServiceOrderById(p.id);
    const r = await cambiarEstadoOrden(order, p.estado, actorDe(ctx));
    if (!r.ok) return fallo(r.msg);
    const extra = r.proforma ? ' Se generó la factura proforma.' : r.invoiceDetached ? ' Se anuló la proforma.' : '';
    return { hecho: true, resumen: `${p.label} quedó en "${ESTADOS_ORDEN[r.status] || r.status}".${extra}`, enlace: `/admin/ordenes-servicio/${p.id}` };
  },
};

// ── 4. Asignar mecánico y fecha ─────────────────────────────────────────────

const asignar_orden = {
  nombre: 'asignar_orden',
  descripcion: 'Cambia el mecánico asignado y/o la fecha estimada de entrega de una orden. Busca el id del mecánico con listar_mecanicos. No se ejecuta sola: el admin ve el cambio y decide.',
  esquema: {
    type: 'object',
    properties: {
      orden: { type: 'string', minLength: 1, maxLength: 60 },
      mecanicoId: { type: 'string', maxLength: 60, description: 'Id del mecánico, o "ninguno" para dejarla sin asignar.' },
      fechaEstimada: { type: 'string', maxLength: 10, description: 'AAAA-MM-DD, o "ninguna" para quitarla.' },
    },
    required: ['orden'],
    additionalProperties: false,
  },
  async preparar(e, ctx) {
    const { orden: r, error } = await ordenEditable(e.orden, ctx);
    if (error) return fallo(error);
    if (e.mecanicoId === undefined && e.fechaEstimada === undefined) return fallo('Dime el mecánico o la fecha estimada que quieres poner.');
    const cambios = [];
    const plan = { id: r.id, label: r.label, detalle: [] };
    if (e.mecanicoId !== undefined) {
      let nuevo = null;
      if (e.mecanicoId !== 'ninguno') {
        nuevo = await empleadoActivo(e.mecanicoId);
        if (!nuevo) return fallo('Ese mecánico no existe o está inactivo. Revisa listar_mecanicos.');
      }
      if ((nuevo ? nuevo.id : null) !== (r.employee_id || null)) {
        cambios.push({ campo: 'Mecánico', antes: r.mechanic || null, despues: nuevo ? nuevo.name : null });
        plan.employeeId = nuevo ? nuevo.id : null;
        plan.mechanic = nuevo ? nuevo.name : null;
        plan.detalle.push(nuevo ? `asignó a ${nuevo.name}` : 'quitó el mecánico');
      }
    }
    if (e.fechaEstimada !== undefined) {
      const f = e.fechaEstimada === 'ninguna' ? null : e.fechaEstimada;
      if (f !== null && !new RegExp(FECHA).test(f)) return fallo('La fecha estimada va en formato AAAA-MM-DD.');
      if (f !== (r.estimated_date || null)) {
        cambios.push({ campo: 'Fecha estimada', antes: r.estimated_date || null, despues: f });
        plan.estimatedDate = f;
        plan.detalle.push(f ? `fecha estimada ${f}` : 'quitó la fecha estimada');
      }
    }
    if (!cambios.length) return fallo('Esos valores ya son los actuales; no hay nada que cambiar.');
    return {
      ok: true,
      origen: `Asignar ${r.label}`,
      motivo: plan.detalle.join(', '),
      vista: vista({
        rotulo: 'Asignación de la orden',
        titulo: r.label,
        contexto: motoTexto(r.motorcycle),
        cambios,
        avisos: plan.employeeId !== undefined && plan.employeeId ? ['El mecánico la verá en su portal del taller.'] : [],
      }),
      plan,
    };
  },
  async escribir(p, ctx) {
    const { updateServiceOrder, addServiceOrderEvent } = dbc();
    const campos = {};
    if (p.employeeId !== undefined) { campos.employeeId = p.employeeId; campos.mechanic = p.mechanic; }
    if (p.estimatedDate !== undefined) campos.estimatedDate = p.estimatedDate;
    await updateServiceOrder(p.id, campos, actorDe(ctx));
    await addServiceOrderEvent(p.id, 'editado', actorDe(ctx), p.detalle.join(', '));
    return { hecho: true, resumen: `${p.label}: ${p.detalle.join(', ')}.`, enlace: `/admin/ordenes-servicio/${p.id}` };
  },
};

// ── 5. Comentar ───────────────────────────────────────────────────────────

const comentar_orden = {
  nombre: 'comentar_orden',
  descripcion: 'Agrega un comentario a la línea de tiempo de una orden, con el nombre del admin y la hora. No borra ni edita comentarios anteriores ni el campo de notas. No se ejecuta sola: el admin ve el texto y decide.',
  esquema: {
    type: 'object',
    properties: {
      orden: { type: 'string', minLength: 1, maxLength: 60 },
      comentario: { type: 'string', minLength: 1, maxLength: 500, description: 'El comentario, con las palabras de la persona. No lo adornes.' },
    },
    required: ['orden', 'comentario'],
    additionalProperties: false,
  },
  async preparar(e, ctx) {
    const r = await buscarOrdenPorRef(e.orden);
    if (!r) return fallo('No encontré esa orden. Búscala primero con buscar_ordenes.');
    const ajena = ajenaParaMecanico(r, ctx);
    if (ajena) return fallo(ajena);
    const texto = e.comentario.replace(/\s+/g, ' ').trim();
    return {
      ok: true,
      origen: `Comentar en ${r.label}`,
      motivo: texto.slice(0, 80),
      vista: vista({
        rotulo: 'Comentario en la orden',
        titulo: r.label,
        contexto: motoTexto(r.motorcycle),
        cambios: [{ campo: 'Comentario', antes: null, despues: texto }],
        avisos: ['Lo ve cualquiera que abra la orden en el panel.'],
        boton: 'Publicar comentario',
      }),
      plan: { id: r.id, label: r.label, texto },
    };
  },
  async escribir(p, ctx, extra) {
    const { db } = dbc();
    await db.execute({
      sql: `INSERT OR IGNORE INTO service_order_events (id, service_order_id, status, actor, detail, created_at)
            VALUES (?,?,?,?,?,?)`,
      args: [idDesde(extra.toolUseId, 'comentario'), p.id, 'comentario', actorDe(ctx), p.texto, new Date().toISOString()],
    });
    return { hecho: true, resumen: `Comentario agregado a ${p.label}.`, enlace: `/admin/ordenes-servicio/${p.id}` };
  },
};

// ── 6. Precio de producto ───────────────────────────────────────────────────

async function productoConVariantes(ref) {
  const { db } = dbc();
  const r = await db.execute({ sql: `SELECT ${COLS_PRODUCTO} FROM products WHERE id = ? LIMIT 1`, args: [ref] });
  const p = r.rows[0];
  if (!p) return { error: 'No encontré ese producto. Búscalo primero con buscar_productos y usa su id.' };
  const v = await db.execute({ sql: 'SELECT id, sku, color, size, price, stock FROM product_variants WHERE product_id = ? ORDER BY position', args: [p.id] });
  return { p, variantes: v.rows };
}
const nombreVariante = (v) => [v.color, v.size].filter(Boolean).join(' / ') || v.sku || 'Variante';
const numOrNull = (v) => (v === null || v === undefined ? null : Number(v));

async function recargarCatalogo() {
  try {
    await require('../catalog').loadCatalog();
  } catch (err) {
    console.error('[panel-ia] no se pudo recargar el catálogo:', err.message);
  }
}

const editar_precio_producto = {
  nombre: 'editar_precio_producto',
  descripcion: 'Cambia el precio, el descuento (%), el descuento club (%) o el precio de instalación de un producto de la tienda, o el precio de una variante. Pasa solo los campos que la persona pidió cambiar. No se ejecuta sola: el admin ve el antes y el después y decide.',
  esquema: {
    type: 'object',
    properties: {
      producto: { type: 'string', minLength: 1, maxLength: 80, description: 'Id del producto (de buscar_productos).' },
      varianteId: { type: 'string', maxLength: 80, description: 'Solo si el cambio es del precio de una variante (de ver_producto).' },
      precio: { type: 'integer', minimum: 1, maximum: 100000000, description: 'Precio en pesos, sin descuento.' },
      descuentoPct: { type: 'integer', minimum: 0, maximum: 90 },
      descuentoClubPct: { type: 'integer', minimum: 0, maximum: 90 },
      precioInstalacion: { type: 'integer', minimum: 0, maximum: 10000000 },
    },
    required: ['producto'],
    additionalProperties: false,
  },
  async preparar(e) {
    const { p, variantes, error } = await productoConVariantes(e.producto);
    if (error) return fallo(error);
    const avisos = [];
    const cambios = [];
    const plan = { id: p.id, nombre: p.name, set: {}, cond: {} };
    if (e.varianteId) {
      const v = variantes.find((x) => x.id === e.varianteId);
      if (!v) return fallo('Esa variante no es de este producto. Revisa ver_producto.');
      if (e.precio === undefined || e.descuentoPct !== undefined || e.descuentoClubPct !== undefined || e.precioInstalacion !== undefined) {
        return fallo('En una variante solo se cambia el precio. Los descuentos y la instalación son del producto.');
      }
      const antes = numOrNull(v.price);
      if (antes === e.precio) return fallo('Ese ya es el precio de la variante.');
      cambios.push({ campo: `Precio de ${nombreVariante(v)}`, antes: antes === null ? `igual al producto (${fmtCOP(p.price)})` : fmtCOP(antes), despues: fmtCOP(e.precio) });
      plan.variante = { id: v.id, nombre: nombreVariante(v), antes, despues: e.precio };
      const ref = antes === null ? Number(p.price) : antes;
      if (ref && Math.abs(e.precio - ref) / ref >= 0.5) avisos.push(`Cambio grande: ${Math.round(((e.precio - ref) / ref) * 100)} % frente al precio actual.`);
    } else {
      const campos = [
        ['precio', 'price', 'Precio', fmtCOP],
        ['descuentoPct', 'discount', 'Descuento', (n) => `${n} %`],
        ['descuentoClubPct', 'club_discount', 'Descuento club', (n) => `${n} %`],
        ['precioInstalacion', 'install_price', 'Precio de instalación', fmtCOP],
      ];
      for (const [k, col, etiqueta, fmt] of campos) {
        if (e[k] === undefined) continue;
        const antes = numOrNull(p[col]);
        if (antes === e[k]) continue;
        cambios.push({ campo: etiqueta, antes: antes === null ? null : fmt(antes), despues: fmt(e[k]) });
        plan.set[col] = e[k];
        plan.cond[col] = antes;
      }
      if (!cambios.length) return fallo('Esos valores ya son los actuales; no hay nada que cambiar.');
      const actual = unitPrice({ price: Number(p.price), discount: p.discount, clubDiscount: p.club_discount });
      const nuevo = unitPrice({
        price: plan.set.price ?? Number(p.price),
        discount: plan.set.discount ?? p.discount,
        clubDiscount: plan.set.club_discount ?? p.club_discount,
      });
      const hayDescuento = actual.regular !== Number(p.price) || nuevo.regular !== (plan.set.price ?? Number(p.price));
      if (hayDescuento && actual.regular !== nuevo.regular) cambios.push({ campo: 'Precio final en la tienda', antes: fmtCOP(actual.regular), despues: fmtCOP(nuevo.regular) });
      if ((actual.club ?? null) !== (nuevo.club ?? null)) cambios.push({ campo: 'Precio club', antes: actual.club === null ? null : fmtCOP(actual.club), despues: nuevo.club === null ? null : fmtCOP(nuevo.club) });
      if (plan.set.price !== undefined && Number(p.price) && Math.abs(plan.set.price - Number(p.price)) / Number(p.price) >= 0.5) {
        avisos.push(`Cambio grande: ${Math.round(((plan.set.price - Number(p.price)) / Number(p.price)) * 100)} % frente al precio actual.`);
      }
    }
    avisos.unshift(p.status === 'active'
      ? 'El producto está publicado: el nuevo precio lo ven los clientes en la tienda de inmediato.'
      : 'El producto está en borrador: los clientes no lo ven todavía.');
    return {
      ok: true,
      origen: `Cambiar precio de ${p.name}`,
      motivo: cambios.map((c) => `${c.campo}: ${c.despues}`).join(', ').slice(0, 160),
      vista: vista({ rotulo: 'Producto de la tienda', titulo: p.name, contexto: [p.brand, p.sku].filter(Boolean).join(' · ') || null, cambios, avisos }),
      plan,
    };
  },
  async escribir(p, ctx) {
    const { db, logAdminAction } = dbc();
    let r;
    if (p.variante) {
      r = await db.execute({
        sql: `UPDATE product_variants SET price = ? WHERE id = ? AND product_id = ? AND ${p.variante.antes === null ? 'price IS NULL' : 'price = ?'}`,
        args: [p.variante.despues, p.variante.id, p.id, ...(p.variante.antes === null ? [] : [p.variante.antes])],
      });
    } else {
      const cols = Object.keys(p.set);
      const conds = cols.map((c) => (p.cond[c] === null ? `${c} IS NULL` : `${c} = ?`));
      r = await db.execute({
        sql: `UPDATE products SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ? AND ${conds.join(' AND ')}`,
        args: [...cols.map((c) => p.set[c]), new Date().toISOString(), p.id, ...cols.filter((c) => p.cond[c] !== null).map((c) => p.cond[c])],
      });
    }
    if (afectadas(r) === 0) return fallo('El producto cambió justo antes de guardar; no se aplicó nada. Vuelve a revisarlo.');
    await recargarCatalogo();
    await logAdminAction(ctx.usuario.id, ctx.usuario.nombre, 'asistente:editar_precio_producto', 'product', p.id, JSON.stringify(p.variante || p.set)).catch(() => {});
    return { hecho: true, resumen: `Precio de ${p.nombre}${p.variante ? ` (${p.variante.nombre})` : ''} actualizado.`, enlace: `/admin/tienda/${p.id}/editar` };
  },
};

// ── 7. Stock ────────────────────────────────────────────────────────────────

const ajustar_stock_producto = {
  nombre: 'ajustar_stock_producto',
  descripcion: 'Fija el stock de un producto de la tienda (o de una de sus variantes) a un número exacto. Si el producto tiene variantes, indica la variante con su id (de ver_producto). No se ejecuta sola: el admin ve el cambio y decide.',
  esquema: {
    type: 'object',
    properties: {
      producto: { type: 'string', minLength: 1, maxLength: 80 },
      varianteId: { type: 'string', maxLength: 80 },
      stock: { type: 'integer', minimum: 0, maximum: 100000, description: 'Unidades disponibles (número final, no la diferencia).' },
    },
    required: ['producto', 'stock'],
    additionalProperties: false,
  },
  async preparar(e) {
    const { p, variantes, error } = await productoConVariantes(e.producto);
    if (error) return fallo(error);
    let objetivo;
    if (variantes.length) {
      if (!e.varianteId) return fallo(`${p.name} tiene variantes (${variantes.map(nombreVariante).join(', ')}): dime de cuál es el stock.`);
      const v = variantes.find((x) => x.id === e.varianteId);
      if (!v) return fallo('Esa variante no es de este producto. Revisa ver_producto.');
      objetivo = { tabla: 'product_variants', id: v.id, nombre: `${p.name} (${nombreVariante(v)})`, antes: numOrNull(v.stock) };
    } else {
      if (e.varianteId) return fallo('Ese producto no tiene variantes.');
      objetivo = { tabla: 'products', id: p.id, nombre: p.name, antes: numOrNull(p.stock) };
    }
    if (objetivo.antes === e.stock) return fallo(`El stock de ${objetivo.nombre} ya es ${e.stock}.`);
    const avisos = [];
    if (objetivo.antes === null) avisos.push('Hoy no controla inventario: desde ahora la tienda descuenta unidades con cada venta.');
    if (e.stock === 0 && p.status === 'active') avisos.push('Quedará agotado en la tienda.');
    return {
      ok: true,
      origen: `Ajustar stock de ${objetivo.nombre}`,
      motivo: `${objetivo.antes === null ? 'sin control' : objetivo.antes} → ${e.stock}`,
      vista: vista({
        rotulo: 'Stock de la tienda',
        titulo: objetivo.nombre,
        cambios: [{ campo: 'Stock', antes: objetivo.antes === null ? 'sin control de inventario' : String(objetivo.antes), despues: String(e.stock) }],
        avisos,
      }),
      plan: { ...objetivo, productoId: p.id, despues: e.stock },
    };
  },
  async escribir(p, ctx) {
    const { db, logAdminAction } = dbc();
    const r = await db.execute({
      sql: `UPDATE ${p.tabla} SET stock = ? WHERE id = ? AND ${p.antes === null ? 'stock IS NULL' : 'stock = ?'}`,
      args: [p.despues, p.id, ...(p.antes === null ? [] : [p.antes])],
    });
    if (afectadas(r) === 0) return fallo('El stock cambió justo antes de guardar (quizás una venta); no se aplicó nada. Vuelve a revisarlo.');
    await recargarCatalogo();
    await logAdminAction(ctx.usuario.id, ctx.usuario.nombre, 'asistente:ajustar_stock_producto', 'product', p.productoId, JSON.stringify({ id: p.id, antes: p.antes, despues: p.despues })).catch(() => {});
    return { hecho: true, resumen: `Stock de ${p.nombre}: ${p.despues}.`, enlace: `/admin/tienda/${p.productoId}/editar` };
  },
};

// ── 2b. Agregar ítems (versión del mecánico) ─────────────────────────────────

const agregar_items_orden = {
  nombre: 'agregar_items_orden',
  descripcion: 'Agrega partes o trabajos a una orden sin factura, con el nombre, tipo, precio y cantidad que diga la persona, y recalcula el total. No cambia ni quita los ítems que ya están. No se ejecuta sola: la persona ve los ítems nuevos y el total, y decide.',
  esquema: {
    type: 'object',
    properties: {
      orden: { type: 'string', minLength: 1, maxLength: 60, description: 'Id o consecutivo de la orden (de buscar_ordenes).' },
      items: { type: 'array', minItems: 1, maxItems: 20, items: ESQUEMA_ITEM },
    },
    required: ['orden', 'items'],
    additionalProperties: false,
  },
  preparar(e, ctx) {
    return editar_items_orden.preparar({
      orden: e.orden,
      cambios: e.items.map((it) => ({ accion: 'agregar', nombre: it.nombre, tipo: it.tipo, precio: it.precio, cantidad: it.cantidad })),
    }, ctx).then((p) => (p.ok ? { ...p, origen: p.origen.replace('Editar ítems de', 'Agregar ítems a'), vista: { ...p.vista, boton: 'Agregar a la orden' } } : p));
  },
  escribir: (p, ctx, extra) => editar_items_orden.escribir(p, ctx, extra),
};

const ESCRITURAS = [
  crear_orden_servicio, editar_items_orden, agregar_items_orden, cambiar_estado_orden, asignar_orden, comentar_orden,
  editar_precio_producto, ajustar_stock_producto,
];

/**
 * Tras "Aprobar": vuelve a preparar contra la base actual, compara con la
 * tarjeta aprobada y solo entonces escribe. Nunca lanza.
 */
async function ejecutarAprobada(escritura, entrada, ctx, extra) {
  try {
    const p = await escritura.preparar(entrada, ctx);
    if (!p.ok) return fallo(`Ya no se puede aplicar: ${p.error}`);
    const aprobada = extra && extra.vista ? JSON.stringify(extra.vista.cambios) : null;
    if (aprobada !== null && aprobada !== JSON.stringify(p.vista.cambios)) {
      return fallo('Los datos cambiaron desde que preparé la propuesta (otra persona o el taller los tocó). No guardé nada; revísalos de nuevo antes de volver a proponer.');
    }
    const r = await escritura.escribir(p.plan, ctx, extra);
    return r && r.ok === false ? r : { ok: true, datos: r };
  } catch (err) {
    console.error(`[panel-ia] ${escritura.nombre} falló:`, err);
    return fallo(`No se pudo guardar: ${err.message}`);
  }
}

module.exports = { ESCRITURAS, ejecutarAprobada, idDesde };
