'use strict';

const express = require('express');
const router  = express.Router();
const { getServiceOrdersByPlate, getQuotationsByMotorcyclePlates } = require('../db');

router.get('/debug/:placa', async (req, res) => {
  const { getAllServiceOrders, getAllQuotations } = require('../db');
  const placa = req.params.placa.toUpperCase();
  const os = await getAllServiceOrders();
  const qs = await getAllQuotations();
  const osMatch = os.filter(o => o.motorcycle && o.motorcycle.toUpperCase().includes(placa));
  const qMatch = qs.filter(q => q.motorcycle && q.motorcycle.toUpperCase().includes(placa));
  res.json({
    buscando: placa,
    totalOS: os.length,
    totalQS: qs.length,
    osEncontradas: osMatch.map(o => ({ label: o.label, motorcycle: o.motorcycle })),
    qsEncontradas: qMatch.map(q => ({ label: q.label, motorcycle: q.motorcycle })),
  });
});

router.get('/', (req, res) => {
  res.render('historial', {
    title: 'Historial de Motocicleta | Gorillaz Motorbikes',
    description: 'Consulta el historial completo de servicios y cotizaciones de tu motocicleta.',
    canonicalPath: '/historial',
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
