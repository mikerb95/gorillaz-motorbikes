'use strict';
// Servicios que muestra la landing (views/home.ejs), en el orden en que la
// moto ilustrada los recorre. Los textos son los que ya tenía la home; las
// fotos son las mismas de /images/services, reducidas a WebP de 720 px en
// /images/landing/servicios para no descargar originales de 3000 px.
//
// La parte de la moto que resalta cada servicio NO vive aquí: es dato del
// componente (public/js/motion/lib/bike-systems.mjs). Un test comprueba que
// cada slug de esta lista tiene su sistema en la moto.

module.exports = [
  { slug: 'mecanica', name: 'Mecánica', desc: 'Diagnóstico, mantenimiento preventivo y correctivo con control de calidad.' },
  { slug: 'mecanica-rapida', name: 'Mecánica rápida', desc: 'Cambios de aceite, filtros y ajustes ágiles con cita.' },
  { slug: 'electricidad', name: 'Electricidad', desc: 'Diagnóstico eléctrico, sistema de carga, arranque e iluminación.' },
  { slug: 'escaneo-de-motos', name: 'Escaneo de motos', desc: 'Diagnóstico computarizado para detectar fallas electrónicas con precisión.' },
  { slug: 'alistamiento-tecnomecanica', name: 'Alistamiento tecnomecánica', desc: 'Revisión integral y ajustes previos a la inspección.' },
  { slug: 'torno', name: 'Torno', desc: 'Fabricación y ajuste de componentes según especificación.' },
  { slug: 'prensa', name: 'Prensa', desc: 'Montaje y desmontaje seguro de rodamientos y piezas a presión.' },
  { slug: 'pintura', name: 'Pintura', desc: 'Acabados profesionales, retoques y protección de superficies.' },
  { slug: 'lavado-motos', name: 'Lavado de motos', desc: 'Limpieza profunda para tu motocicleta, cuidando cada detalle para que luzca impecable y protegida.' },
  { slug: 'detailing-motos', name: 'Detailing de motos', desc: 'Restauración y protección estética paso a paso con productos premium para dejar tu moto como nueva.' },
  { slug: 'lavado-cascos', name: 'Lavado de cascos', desc: 'Desinfección y limpieza interior y exterior de tu casco, eliminando olores e impurezas acumuladas.' },
].map((s) => ({ ...s, href: `/servicios/${s.slug}`, img: `/images/landing/servicios/${s.slug}.webp` }));
