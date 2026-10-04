'use strict';
// Taxonomía de la tienda. Regla: categoría = tipo de producto. El tipo de moto
// y el modelo compatible son atributos (filtros), nunca categorías.
//
// Se conservan las categorías que ya existían (repuestos, guantes, cuidado y
// limpieza) y se suman las nuevas. "Iluminación" incluye farolas.

const DEFAULT_CATEGORIES = [
  { slug: 'accesorios',       name: 'Accesorios' },
  { slug: 'iluminacion',      name: 'Iluminación y farolas' },
  { slug: 'espejos',          name: 'Espejos' },
  { slug: 'consumibles',      name: 'Aceites y consumibles' },
  { slug: 'seguridad',        name: 'Seguridad' },
  { slug: 'indumentaria',     name: 'Indumentaria' },
  { slug: 'cascos',           name: 'Cascos' },
  { slug: 'guantes',          name: 'Guantes' },
  { slug: 'carga',            name: 'Carga y equipaje' },
  { slug: 'tecnologia',       name: 'Tecnología' },
  { slug: 'repuestos',        name: 'Repuestos' },
  { slug: 'cuidado-limpieza', name: 'Cuidado y limpieza' },
];

// Tipos de moto: atributo del producto y filtro del listado.
const BIKE_TYPES = [
  { slug: 'naked',     name: 'Naked' },
  { slug: 'sport',     name: 'Sport' },
  { slug: 'adventure', name: 'Adventure' },
  { slug: 'enduro',    name: 'Enduro' },
  { slug: 'scooter',   name: 'Scooter' },
  { slug: 'touring',   name: 'Touring' },
  { slug: 'urbana',    name: 'Urbana' },
];
const BIKE_TYPE_SLUGS = new Set(BIKE_TYPES.map((t) => t.slug));

// Productos demo del seed (data/catalog.js): su "categoría" era un tipo de moto.
// Al pasarlos a tablas se reubican en su tipo de producto real.
const DEMO_CATEGORY_MAP = {
  'nk-helmet-pro': 'cascos',
  'nk-gloves': 'guantes',
  'adv-jacket': 'indumentaria',
  'adv-panniers': 'carga',
  'sp-boots': 'indumentaria',
  'sp-brakes': 'repuestos',
  'sc-cover': 'accesorios',
  'sc-lock': 'seguridad',
  'en-handguards': 'accesorios',
  'en-tyres': 'repuestos',
};

module.exports = { DEFAULT_CATEGORIES, BIKE_TYPES, BIKE_TYPE_SLUGS, DEMO_CATEGORY_MAP };
