'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { createQuotation, updateQuotation, getDraftQuotations, getQuotationById, updateQuotationPhone, deleteQuotation, getInvoiceById, getServiceOrderById } = require('../db');
const { products } = require('../data/catalog');

const router = express.Router();

const CONFIG_PATH   = path.join(__dirname, '..', 'data', 'cotizador-config.json');
const SERVICES_PATH = path.join(__dirname, '..', 'data', 'services-catalog.json');

function loadConfig() {
  try { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
  catch { return { waHeader: '🏍️ *Cotización Gorillaz Motorbikes*', waItemPrefix: '•', waFooter: 'gorillazmotorbikes.com', waNote: '' }; }
}

function loadServices() {
  try { return JSON.parse(fs.readFileSync(SERVICES_PATH, 'utf8')); }
  catch { return []; }
}

let catalogCache = null;

function buildCatalog() {
  if (catalogCache) return catalogCache;
  catalogCache = [
    ...loadServices(),
    ...products.map(p => ({ id: p.id, name: p.name, type: 'product', brand: p.brand || '' })),
  ];
  return catalogCache;
}

function invalidateCatalogCache() {
  catalogCache = null;
}

router.get('/liquidador', async (req, res) => {
  // Si llega ?id=, se reabre una cotización (borrador o confirmada) para editarla.
  let editQuotation = null;
  if (req.query.id) {
    try {
      const q = await getQuotationById(req.query.id);
      if (q) {
        editQuotation = {
          id: q.id, label: q.label, status: q.status,
          items: q.items, total: q.total,
          motorcycle: q.motorcycle, plate: q.plate,
        };
      }
    } catch (err) {
      console.error('GET /liquidador?id error:', err.message);
    }
  }
  res.render('liquidador', {
    title: 'Liquidador — Gorillaz Motorbikes',
    description: 'Crea cotizaciones rápidas de servicios y productos.',
    canonicalPath: '/liquidador',
    waConfig: loadConfig(),
    editQuotation,
  });
});

// Valida y normaliza los ítems/campos de una cotización.
// Devuelve { error } o { ok: true } según corresponda.
function validateQuotationFields({ items, motorcycle, plate, notes }, { allowEmptyItems = false } = {}) {
  if (!Array.isArray(items)) return { error: 'Ítems inválidos.' };
  if (!allowEmptyItems && items.length === 0)
    return { error: 'Se requiere al menos un ítem.' };
  if (items.length > 100)
    return { error: 'Máximo 100 ítems por cotización.' };
  for (const it of items) {
    if (typeof it.name !== 'string' || it.name.trim().length === 0 || it.name.length > 200)
      return { error: 'Nombre de ítem inválido (máx 200 caracteres).' };
    const price = Number(it.price);
    if (!Number.isInteger(price) || price < 1 || price > 9_999_999_999)
      return { error: 'Precio de ítem fuera de rango (1 – 9.999.999.999).' };
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 100)
      return { error: 'Cantidad de ítem fuera de rango (1 – 100).' };
  }
  if (motorcycle && String(motorcycle).length > 80)
    return { error: 'Moto/placa demasiado larga (máx 80 caracteres).' };
  if (plate && String(plate).length > 20)
    return { error: 'Placa demasiado larga (máx 20 caracteres).' };
  if (notes && String(notes).length > 500)
    return { error: 'Notas demasiado largas (máx 500 caracteres).' };
  return { ok: true };
}

function normalizeFields({ items, total, motorcycle, plate, notes }) {
  return {
    items,
    total: Number(total) || 0,
    motorcycle: motorcycle || null,
    plate: plate ? String(plate).toUpperCase().trim() : null,
    notes: notes || null,
  };
}

router.get('/api/liquidador/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 3) return res.json([]);

  const results = buildCatalog()
    .filter(item => item.name.toLowerCase().includes(q) || (item.brand || '').toLowerCase().includes(q))
    .slice(0, 12)
    .map(({ id, name, type, brand }) => ({ id, name, type, brand: brand || '' }));

  res.json(results);
});

// Autosave de borrador: crea (status='draft') o actualiza la cotización en curso.
// Permite retomar el trabajo desde cualquier dispositivo vía /liquidador?id=:id.
router.post('/api/liquidador/draft', async (req, res) => {
  try {
    const { id } = req.body;
    const check = validateQuotationFields(req.body, { allowEmptyItems: true });
    if (check.error) return res.status(400).json({ error: check.error });
    const fields = normalizeFields(req.body);

    if (id) {
      const existing = await getQuotationById(id);
      // Solo se puede autosalvar como borrador algo que siga en borrador.
      if (existing && existing.status === 'draft') {
        await updateQuotation(id, fields);
        return res.json({ ok: true, id, label: existing.label });
      }
    }
    const created = await createQuotation({ ...fields, status: 'draft' });
    res.json({ ok: true, id: created.id, label: created.label });
  } catch (err) {
    console.error('POST /api/liquidador/draft error:', err.message);
    res.status(500).json({ error: 'Error al guardar el borrador.' });
  }
});

// Lista de borradores sin terminar (para retomar desde otro dispositivo).
router.get('/api/liquidador/drafts', async (req, res) => {
  try {
    const drafts = await getDraftQuotations(15);
    res.json(drafts.map(d => ({
      id: d.id, label: d.label, total: d.total,
      itemCount: d.items.length, motorcycle: d.motorcycle, plate: d.plate,
      createdAt: d.createdAt,
    })));
  } catch (err) {
    console.error('GET /api/liquidador/drafts error:', err.message);
    res.status(500).json({ error: 'Error al cargar borradores.' });
  }
});

// Descartar un borrador sin terminar.
router.delete('/api/liquidador/draft/:id', async (req, res) => {
  try {
    const existing = await getQuotationById(req.params.id);
    if (existing && existing.status === 'draft') await deleteQuotation(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE /api/liquidador/draft/:id error:', err.message);
    res.status(500).json({ error: 'Error al descartar el borrador.' });
  }
});

// Confirma una cotización: convierte un borrador en confirmada, o crea una nueva.
router.post('/api/liquidador/quotation', async (req, res) => {
  try {
    const { id, clientPhone, clientPhoneCountry } = req.body;
    const check = validateQuotationFields(req.body);
    if (check.error) return res.status(400).json({ error: check.error });
    const fields = normalizeFields(req.body);

    if (id) {
      const existing = await getQuotationById(id);
      if (existing) {
        await updateQuotation(id, { ...fields, status: 'confirmed' });
        return res.json({ ok: true, id: existing.id, consecutive: existing.consecutive, label: existing.label });
      }
    }
    const created = await createQuotation({
      ...fields,
      clientPhone: clientPhone || null,
      clientPhoneCountry: clientPhoneCountry || '+57',
      status: 'confirmed',
    });
    res.json({ ok: true, id: created.id, consecutive: created.consecutive, label: created.label });
  } catch (err) {
    console.error('POST /api/liquidador/quotation error:', err.message);
    res.status(500).json({ error: 'Error al guardar la cotización.' });
  }
});

// Editar una cotización ya confirmada (ítems, moto, placa).
router.put('/api/liquidador/quotation/:id', async (req, res) => {
  try {
    const existing = await getQuotationById(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Cotización no encontrada.' });
    const check = validateQuotationFields(req.body);
    if (check.error) return res.status(400).json({ error: check.error });
    await updateQuotation(req.params.id, normalizeFields(req.body));
    res.json({ ok: true, id: existing.id, label: existing.label });
  } catch (err) {
    console.error('PUT /api/liquidador/quotation/:id error:', err.message);
    res.status(500).json({ error: 'Error al actualizar la cotización.' });
  }
});

router.post('/api/liquidador/quotation/:id/phone', async (req, res) => {
  try {
    const { clientPhone, clientPhoneCountry } = req.body;
    const digits = (clientPhone || '').replace(/\D/g, '');
    if (!digits) return res.status(400).json({ error: 'Número inválido.' });
    await updateQuotationPhone(req.params.id, digits, clientPhoneCountry || '+57');
    res.json({ ok: true });
  } catch (err) {
    console.error('POST /api/liquidador/quotation/:id/phone error:', err.message);
    res.status(500).json({ error: 'Error al guardar el teléfono.' });
  }
});

router.get('/cotizacion/:id', async (req, res) => {
  try {
    const quotation = await getQuotationById(req.params.id);
    if (!quotation || quotation.status === 'draft') return res.status(404).render('404');
    res.render('cotizacion', {
      title: `Cotización #${quotation.label} — Gorillaz Motorbikes`,
      description: 'Detalle de cotización Gorillaz Motorbikes.',
      canonicalPath: `/cotizacion/${quotation.id}`,
      quotation,
    });
  } catch (err) {
    console.error('GET /cotizacion/:id error:', err.message);
    res.status(500).render('500');
  }
});

router.get('/factura/:id', async (req, res) => {
  try {
    const invoice = await getInvoiceById(req.params.id);
    if (!invoice || invoice.status === 'anulada') return res.status(404).render('404');
    const order = invoice.serviceOrderId ? await getServiceOrderById(invoice.serviceOrderId) : null;
    res.render('factura', {
      title: `Factura ${invoice.label} — Gorillaz Motorbikes`,
      description: 'Detalle de factura Gorillaz Motorbikes.',
      canonicalPath: `/factura/${invoice.id}`,
      invoice,
      order,
    });
  } catch (err) {
    console.error('GET /factura/:id error:', err.message);
    res.status(500).render('500');
  }
});

module.exports = router;
module.exports.invalidateCatalogCache = invalidateCatalogCache;
