'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { createQuotation, updateQuotation, getDraftQuotations, getQuotationById, updateQuotationPhone } = require('../db');
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

router.post('/api/liquidador/quotation', async (req, res) => {
  try {
    const { items, total, clientPhone, clientPhoneCountry, motorcycle, plate, notes } = req.body;
    if (!Array.isArray(items) || items.length === 0)
      return res.status(400).json({ error: 'Se requiere al menos un ítem.' });
    if (items.length > 100)
      return res.status(400).json({ error: 'Máximo 100 ítems por cotización.' });
    for (const it of items) {
      if (typeof it.name !== 'string' || it.name.trim().length === 0 || it.name.length > 200)
        return res.status(400).json({ error: 'Nombre de ítem inválido (máx 200 caracteres).' });
      const price = Number(it.price);
      if (!Number.isInteger(price) || price < 1 || price > 9_999_999_999)
        return res.status(400).json({ error: 'Precio de ítem fuera de rango (1 – 9.999.999.999).' });
      const qty = Number(it.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 100)
        return res.status(400).json({ error: 'Cantidad de ítem fuera de rango (1 – 100).' });
    }
    if (motorcycle && String(motorcycle).length > 80)
      return res.status(400).json({ error: 'Moto/placa demasiado larga (máx 80 caracteres).' });
    if (plate && String(plate).length > 20)
      return res.status(400).json({ error: 'Placa demasiado larga (máx 20 caracteres).' });
    if (notes && String(notes).length > 500)
      return res.status(400).json({ error: 'Notas demasiado largas (máx 500 caracteres).' });

    const { id, consecutive, label } = await createQuotation({
      items,
      total: Number(total) || 0,
      clientPhone: clientPhone || null,
      clientPhoneCountry: clientPhoneCountry || '+57',
      motorcycle: motorcycle || null,
      plate: plate ? String(plate).toUpperCase().trim() : null,
      notes: notes || null,
    });
    res.json({ ok: true, id, consecutive, label });
  } catch (err) {
    console.error('POST /api/liquidador/quotation error:', err.message);
    res.status(500).json({ error: 'Error al guardar la cotización.' });
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
    if (!quotation) return res.status(404).render('404');
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

module.exports = router;
module.exports.invalidateCatalogCache = invalidateCatalogCache;
