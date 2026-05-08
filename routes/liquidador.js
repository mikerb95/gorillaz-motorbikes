'use strict';
const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const { createQuotation, getQuotationById, updateQuotationPhone } = require('../db');
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

function buildCatalog() {
  return [
    ...loadServices(),
    ...products.map(p => ({ id: p.id, name: p.name, type: 'product', brand: p.brand || '' })),
  ];
}

router.get('/liquidador', (req, res) => {
  res.render('liquidador', {
    title: 'Liquidador — Gorillaz Motorbikes',
    description: 'Crea cotizaciones rápidas de servicios y productos.',
    canonicalPath: '/liquidador',
    waConfig: loadConfig(),
  });
});

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
    const { items, total, clientPhone, clientPhoneCountry, motorcycle, notes } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un ítem.' });
    }
    const { id, consecutive, label } = await createQuotation({
      items,
      total: Number(total) || 0,
      clientPhone: clientPhone || null,
      clientPhoneCountry: clientPhoneCountry || '+57',
      motorcycle: motorcycle || null,
      notes: notes || null,
    });
    res.json({ ok: true, id, consecutive, label });
  } catch (err) {
    console.error('POST /api/liquidador/quotation error:', err.message);
    res.status(500).json({ error: 'Error al guardar la cotización.' });
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
    res.status(500).render('404');
  }
});

module.exports = router;
