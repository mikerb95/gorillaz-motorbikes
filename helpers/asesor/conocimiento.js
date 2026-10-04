'use strict';
// Información pública que el asesor con IA puede usar. Se arma con código
// desde los mismos datos que pinta el sitio (servicios, preguntas frecuentes,
// cursos, categorías de la tienda), nunca a mano: si el taller cambia un texto
// o el precio de un curso, el asesor lo dice igual sin tocar el prompt.
//
// Lo que NO está publicado no entra aquí: precios de servicios del taller
// (viven en el liquidador, que es interno), stock de la tienda, horario
// (solo existe en el JSON-LD de la home, no en texto visible) ni porcentajes
// de descuento del club (decisión del dueño, oct 2026).
//
// Módulo PURO: las fuentes vivas (cursos y catálogo desde app_settings) se
// inyectan; `fuentesDelSitio()` las trae del sitio en producción.

const servicios = require('../../data/services-detail');
const faq = require('../../data/faq');

const WHATSAPP = '573213204299';
const WHATSAPP_VISIBLE = '321 320 4299';

// Beneficios de /club sin cifras: el dueño no quiere que el asesor dé
// porcentajes del club (los detalles cambian según el nivel de membresía).
const CLUB = [
  'Descuentos en el taller según el nivel de membresía',
  'Rodadas, paseos de fin de semana y eventos exclusivos en Bogotá y alrededores',
  'Acceso prioritario y precios especiales en cursos',
  'Prioridad en la agenda y recordatorios de SOAT y tecnomecánica para los vehículos registrados',
  'Sistema de puntos por visitas, rodadas y eventos',
  'Clasificados del club: los miembros publican motos, partes y accesorios en venta',
];

/** Pesos colombianos como los muestra el sitio: $450.000. */
function pesos(n) {
  return `$${Math.round(n).toLocaleString('es-CO')}`;
}

/** Quita etiquetas HTML y espacios de sobra (las respuestas del FAQ traen enlaces). */
function textoPlano(html) {
  return String(html || '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim();
}

/** Cursos y catálogo vivos (BD). Solo servidor. */
function fuentesDelSitio() {
  const { courses } = require('../content');
  const { catalog, publicProducts } = require('../catalog');
  // Solo lo publicado: ni borradores ni productos demo.
  return { cursos: courses, productos: publicProducts(), categorias: catalog.categories || [] };
}

function conocimiento(f) {
  const s = [];

  s.push(`## El negocio
Gorillaz Motorbikes es un taller y club de motos en Bogotá, Colombia, con tienda de accesorios y repuestos en línea y cursos. Sitio: gorillazmotorbikes.com. WhatsApp del taller: ${WHATSAPP_VISIBLE} (también está el botón flotante del sitio).`);

  s.push(`## Servicios del taller
Los servicios del taller NO tienen precio publicado y el taller NO da precios exactos por WhatsApp: siempre hay que revisar la moto en el taller, y el valor exacto solo se sabe al final del trabajo, cuando ya se tiene el total de repuestos que se necesitaron.
${servicios
  .map((v) => `- ${v.title} (/servicios/${v.slug}): ${v.desc} Incluye: ${(v.includes || []).join(', ')}.`)
  .join('\n')}
- Duplicado de placas y portaplacas (/duplicado-placas): solicitud de duplicado de placa de moto o carro y venta de portaplacas para moto. Tiempos y requisitos los confirma el taller por WhatsApp.`);

  s.push(`## Citas y seguimiento
- Para agendar: formulario en /servicios/agendar con los datos, el servicio y la fecha deseada. El taller contacta para confirmar la cita.
- Mecánica rápida (aceite, ajustes menores): se puede llegar sin cita o agendar para asegurar el espacio.
- Para saber cómo va una moto que ya está en el taller: aquí mismo en el chat con consultar_orden o en la página /mi-orden (las dos piden la placa y los últimos 4 dígitos del celular registrado), o por WhatsApp.
- Historial de una moto: /historial. Consulta RUNT: /runt.`);

  const cursos = (f.cursos || []).filter((c) => Number.isFinite(c.priceCOP));
  if (cursos.length) {
    s.push(`## Cursos (precio publicado en /cursos)
${cursos
  .map(
    (c) =>
      `- ${c.title} (/cursos/${c.slug}): ${c.short} ${c.modality || ''}${c.location ? `, ${c.location}` : ''}${
        c.durationHours ? `, ${c.durationHours} horas` : ''
      }${c.level ? `, nivel ${c.level}` : ''}. Precio: ${pesos(c.priceCOP)}.`
  )
  .join('\n')}
Fechas y cupos de los cursos: los confirma el taller por WhatsApp.`);
  }

  const cats = (f.categorias || []).map((c) => c.name).filter(Boolean);
  s.push(`## Tienda (/tienda)
Venta en línea de productos para moto${cats.length ? `: ${cats.join(', ')}` : ''}. Envíos a todo Colombia; el costo y el tiempo del envío se calculan en el checkout. Los precios de los productos SOLO salen de buscar_producto. Que un producto aparezca en la tienda no significa que haya unidades: la disponibilidad la confirma el taller por WhatsApp.`);

  s.push(`## Club Gorillaz (/club)
Membresía para motociclistas. Beneficios publicados:
${CLUB.map((b) => `- ${b}`).join('\n')}
El registro y la renovación se hacen en /club. No hay porcentajes ni valores de membresía publicados para que tú los digas.`);

  s.push(`## Preguntas frecuentes (/faq)
${faq.map((p) => `- ${p.q} ${textoPlano(p.a)}`).join('\n')}`);

  return s.join('\n\n');
}

/** Cifras de dinero publicadas que el asesor puede decir sin buscar nada: precios de cursos. */
function cifrasPublicas(f) {
  return (f.cursos || []).map((c) => c.priceCOP).filter((n) => Number.isFinite(n));
}

module.exports = { conocimiento, cifrasPublicas, fuentesDelSitio, pesos, textoPlano, WHATSAPP, WHATSAPP_VISIBLE, CLUB };
