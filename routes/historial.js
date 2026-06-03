'use strict';

const express = require('express');
const router  = express.Router();
const { getServiceOrdersByPlate, getQuotationsByMotorcyclePlates } = require('../db');

router.get('/', (req, res) => {
  res.render('historial', {
    title: 'Historial de Motocicleta | Gorillaz Motorbikes',
    description: 'Consulta el historial completo de servicios y cotizaciones de tu motocicleta.',
    canonicalPath: '/historial',
  });
});

router.get('/debug', async (req, res) => {
  const { getAllServiceOrders, getAllQuotations } = require('../db');
  const os = await getAllServiceOrders();
  const qs = await getAllQuotations();
  res.json({
    serviceOrders: os.map(o => ({ id: o.id, label: o.label, motorcycle: o.motorcycle, status: o.status })),
    quotations: qs.map(q => ({ id: q.id, label: q.label, motorcycle: q.motorcycle, status: q.status })),
  });
});

router.post('/buscar', async (req, res) => {
  const { placa } = req.body || {};
  if (!placa || typeof placa !== 'string' || placa.trim().length < 3) {
    return res.status(400).json({ ok: false, error: 'Ingresa una placa válida.' });
  }

  const clean = placa.trim().toUpperCase().replace(/\s/g, '');

  const [serviceOrders, quotations] = await Promise.all([
    getServiceOrdersByPlate(clean),
    getQuotationsByMotorcyclePlates([clean]),
  ]);

  res.json({ ok: true, serviceOrders, quotations });
});

module.exports = router;
