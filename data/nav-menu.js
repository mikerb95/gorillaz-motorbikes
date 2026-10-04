'use strict';
// Menú de la navbar (views/partials/head.ejs): el panel de escritorio y el de
// móvil se pintan desde aquí para que la lista de servicios no viva dos veces.
// Los nombres salen de data/landing-services.js; aquí solo se decide el grupo,
// el ícono (símbolo #ni-<icon> del sprite en head.ejs) y una descripción corta
// para el panel. Un test comprueba que cada slug exista en landing-services.

const services = require('./landing-services');
const bySlug = Object.fromEntries(services.map((s) => [s.slug, s]));

const svc = (slug, icon, desc) => ({
  href: `/servicios/${slug}`,
  slug,
  label: bySlug[slug] ? bySlug[slug].name : slug,
  icon,
  desc,
});

const serviceGroups = [
  {
    title: 'Taller',
    items: [
      svc('mecanica', 'wrench', 'Preventivo y correctivo'),
      svc('mecanica-rapida', 'clock', 'Aceite, frenos y cadena'),
      svc('electricidad', 'bolt', 'Carga, arranque y luces'),
      svc('escaneo-de-motos', 'scan', 'Diagnóstico computarizado'),
      svc('torno', 'gear', 'Bujes, ejes y roscas'),
      svc('prensa', 'press', 'Rodamientos y pasadores'),
    ],
  },
  {
    title: 'Estética',
    items: [
      svc('pintura', 'brush', 'Rayones y color original'),
      svc('lavado-motos', 'drop', 'Cuida pintura y plásticos'),
      svc('detailing-motos', 'sparkle', 'Pulido y sellado cerámico'),
      svc('lavado-cascos', 'helmet', 'Ozono e hipoalergénico'),
    ],
  },
  {
    title: 'Trámites',
    items: [
      svc('alistamiento-tecnomecanica', 'check', 'Listo para la revisión'),
      { href: '/duplicado-placas', slug: null, label: 'Duplicado de placas', icon: 'doc', desc: 'Placas y portaplacas' },
    ],
  },
];

// Las categorías de la tienda no viven aquí: salen del catálogo (solo las que
// tienen productos publicados, ver middleware/locals.js → shopNavCategories).
const shop = {
  quick: [
    { href: '/tienda', label: 'Ver toda la tienda' },
    { href: '/tienda/combos', label: 'Combos y kits' },
    { href: '/tienda/pedido', label: 'Seguir mi pedido' },
  ],
};

module.exports = { serviceGroups, shop };
