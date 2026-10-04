'use strict';
// Páginas legales y de políticas comerciales. Los datos de la empresa son los
// que ya publicaba /terminos. La fecha de actualización es fija: cambia solo
// cuando cambia el texto (antes mostraba la fecha del día en cada visita).

const LEGAL_UPDATED = '2026-10-04';

const COMPANY = {
  razonSocial: 'Time Line Craft SAS',
  nit: '900587957-7',
  actividad: 'Mantenimiento y reparación de motocicletas y de sus partes y piezas',
  domicilio: 'Bogotá D.C., Colombia',
  marca: 'Gorillaz Motorbikes',
};

const LEGAL_DOCS = [
  { path: '/terminos', view: 'legal/terminos', title: 'Términos y condiciones', short: 'Términos', description: 'Condiciones de uso del sitio, de la tienda en línea y de los servicios del taller Gorillaz Motorbikes.' },
  { path: '/privacidad', view: 'legal/privacidad', title: 'Política de tratamiento de datos personales', short: 'Datos personales', description: 'Cómo tratamos tus datos personales según la Ley 1581 de 2012 y cómo ejercer tus derechos.' },
  { path: '/envios', view: 'legal/envios', title: 'Envíos y entregas', short: 'Envíos', description: 'Recogida en el taller, domicilios en Bogotá y envíos nacionales: costos, tiempos y qué hacer al recibir tu pedido.' },
  { path: '/cambios-y-devoluciones', view: 'legal/cambios', title: 'Cambios y devoluciones', short: 'Cambios', description: 'Cómo pedir un cambio o una devolución de un producto comprado en la tienda Gorillaz Motorbikes.' },
  { path: '/garantias', view: 'legal/garantias', title: 'Garantías', short: 'Garantías', description: 'Garantía legal de productos y servicios del taller según la Ley 1480 de 2011 y cómo hacerla efectiva.' },
  { path: '/derecho-de-retracto', view: 'legal/retracto', title: 'Derecho de retracto y reversión del pago', short: 'Retracto', description: 'Tu derecho de retracto en compras a distancia y la reversión del pago según el Estatuto del Consumidor.' },
  { path: '/promociones', view: 'legal/promociones', title: 'Política de promociones, cupones y combos', short: 'Promociones', description: 'Condiciones de las promociones, cupones, combos, precio club y puntos de la tienda Gorillaz Motorbikes.' },
  { path: '/pqrs', view: 'legal/pqrs', title: 'Peticiones, quejas, reclamos y sugerencias (PQRS)', short: 'PQRS', description: 'Radica tu petición, queja, reclamo o sugerencia y consulta los tiempos de respuesta.' },
];

const LEGAL_PAGES = LEGAL_DOCS.map((d) => d.path);

module.exports = { LEGAL_UPDATED, COMPANY, LEGAL_DOCS, LEGAL_PAGES };
