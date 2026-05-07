'use strict';
const express = require('express');
const { createQuotation } = require('../db');
const { products } = require('../data/catalog');
const services = require('../data/services-catalog');

const router = express.Router();

// Build combined searchable catalog (products + services) — no prices here
const catalog = [
  ...services,
  ...products.map(p => ({
    id: p.id,
    name: p.name,
    type: 'product',
    brand: p.brand || '',
  })),
];

router.get('/liquidador', (req, res) => {
  res.render('liquidador', {
    title: 'Liquidador — Gorillaz Motorbikes',
    description: 'Crea cotizaciones rápidas de servicios y productos.',
    canonicalPath: '/liquidador',
  });
});

router.get('/api/liquidador/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (q.length < 3) return res.json([]);

  const results = catalog
    .filter(item => item.name.toLowerCase().includes(q) || (item.brand || '').toLowerCase().includes(q))
    .slice(0, 12)
    .map(item => ({
      id: item.id,
      name: item.name,
      type: item.type,
      brand: item.brand || '',
    }));

  res.json(results);
});

router.post('/api/liquidador/quotation', async (req, res) => {
  try {
    const { items, total, clientPhone, clientPhoneCountry } = req.body;

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Se requiere al menos un ítem.' });
    }

    const { id, consecutive } = await createQuotation({
      items,
      total: Number(total) || 0,
      clientPhone: clientPhone || null,
      clientPhoneCountry: clientPhoneCountry || '+57',
    });

    res.json({ ok: true, id, consecutive });
  } catch (err) {
    console.error('POST /api/liquidador/quotation error:', err.message);
    res.status(500).json({ error: 'Error al guardar la cotización.' });
  }
});

module.exports = router;
