'use strict';
// Datos del negocio en un solo lugar: dirección, coordenadas, horarios,
// teléfonos y redes. El valor editable vive en app_settings('business') y el
// admin lo cambia desde /admin/negocio. JSON-LD, footer, banner de horarios,
// estado abierto/cerrado y botones de WhatsApp leen de aquí.
//
// Un dato vacío se omite (no se rellena con un valor inventado).

const settings = require('./settings');

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const DAY_NAMES = { mon: 'Lunes', tue: 'Martes', wed: 'Miércoles', thu: 'Jueves', fri: 'Viernes', sat: 'Sábado', sun: 'Domingo' };
const DAY_SHORT = { mon: 'Lun', tue: 'Mar', wed: 'Mié', thu: 'Jue', fri: 'Vie', sat: 'Sáb', sun: 'Dom' };
const SCHEMA_DAYS = { mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday', sun: 'Sunday' };
const WEEK = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

// Semilla con lo que el sitio ya publicaba. El horario es el del banner de
// /servicios/agendar; hoursConfirmed=false hasta que el dueño lo valide.
const DEFAULTS = {
  name: 'Gorillaz Motorbikes',
  address: { street: 'Tv. 42a #5i 20', locality: 'Bogotá', region: 'Bogotá D.C.', postalCode: '', country: 'CO' },
  geo: { lat: null, lng: null },
  phone: '+573213204299',
  whatsapp: '573213204299',
  email: '',
  hours: {
    mon: [['09:00', '18:00']], tue: [['09:00', '18:00']], wed: [['09:00', '18:00']],
    thu: [['09:00', '18:00']], fri: [['09:00', '18:00']], sat: [['10:00', '16:00']], sun: [],
  },
  hoursConfirmed: false,
  social: {
    facebook: 'https://www.facebook.com/gorillazmotorbikes',
    instagram: 'https://www.instagram.com/gorillazmotorbikes',
  },
  mapsUrl: 'https://www.google.com/maps?cid=842246296160373199',
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

function normalizeHours(raw) {
  const out = {};
  for (const d of WEEK) {
    const ranges = Array.isArray(raw && raw[d]) ? raw[d] : DEFAULTS.hours[d];
    out[d] = ranges.filter((r) => Array.isArray(r) && HHMM.test(r[0]) && HHMM.test(r[1]) && r[0] < r[1]);
  }
  return out;
}

function getBusiness() {
  const raw = settings.get('business') || {};
  return {
    ...DEFAULTS,
    ...raw,
    address: { ...DEFAULTS.address, ...(raw.address || {}) },
    geo: { ...DEFAULTS.geo, ...(raw.geo || {}) },
    social: { ...DEFAULTS.social, ...(raw.social || {}) },
    hours: normalizeHours(raw.hours || DEFAULTS.hours),
  };
}

// Colombia no tiene horario de verano: America/Bogota es siempre UTC−5.
function bogotaParts(date = new Date()) {
  const d = new Date(date.getTime() - 5 * 3600 * 1000);
  return { day: DAYS[d.getUTCDay()], minutes: d.getUTCHours() * 60 + d.getUTCMinutes() };
}
const toMin = (hhmm) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

function fmtHour(hhmm) {
  let h = Number(hhmm.slice(0, 2));
  const m = hhmm.slice(3, 5);
  const suf = h >= 12 ? 'p. m.' : 'a. m.';
  h = h % 12 || 12;
  return `${h}:${m} ${suf}`;
}

// ¿Está abierto ahora (hora de Bogotá)? Devuelve también el texto de hoy.
function openStatus(biz = getBusiness(), date = new Date()) {
  const { day, minutes } = bogotaParts(date);
  const ranges = biz.hours[day] || [];
  const current = ranges.find(([a, b]) => minutes >= toMin(a) && minutes < toMin(b));
  if (current) return { open: true, label: `Abierto hasta las ${fmtHour(current[1])}` };
  const later = ranges.find(([a]) => toMin(a) > minutes);
  if (later) return { open: false, label: `Cerrado. Abre hoy a las ${fmtHour(later[0])}` };
  // Próximo día con horario.
  const idx = WEEK.indexOf(day);
  for (let i = 1; i <= 7; i++) {
    const next = WEEK[(idx + i) % 7];
    const r = biz.hours[next] || [];
    if (r.length) return { open: false, label: `Cerrado. Abre ${i === 1 ? 'mañana' : `el ${DAY_NAMES[next].toLowerCase()}`} a las ${fmtHour(r[0][0])}` };
  }
  return { open: false, label: 'Cerrado' };
}

// Agrupa días consecutivos con el mismo horario: [{ days: 'Lun - Vie', text }].
function hoursSummary(biz = getBusiness()) {
  const key = (d) => JSON.stringify(biz.hours[d] || []);
  const groups = [];
  for (const d of WEEK) {
    const last = groups[groups.length - 1];
    if (last && last.key === key(d)) last.to = d;
    else groups.push({ key: key(d), from: d, to: d });
  }
  return groups.map((g) => {
    const ranges = biz.hours[g.from] || [];
    return {
      days: g.from === g.to ? DAY_SHORT[g.from] : `${DAY_SHORT[g.from]} - ${DAY_SHORT[g.to]}`,
      text: ranges.length ? ranges.map(([a, b]) => `${fmtHour(a)} - ${fmtHour(b)}`).join(', ') : 'Cerrado',
      closed: !ranges.length,
    };
  });
}

function openingHoursSpecification(biz = getBusiness()) {
  const specs = [];
  for (const d of WEEK) {
    for (const [opens, closes] of biz.hours[d] || []) {
      const same = specs.find((s) => s.opens === opens && s.closes === closes);
      if (same) same.dayOfWeek.push(SCHEMA_DAYS[d]);
      else specs.push({ '@type': 'OpeningHoursSpecification', dayOfWeek: [SCHEMA_DAYS[d]], opens, closes });
    }
  }
  return specs;
}

function fullAddress(biz = getBusiness()) {
  const a = biz.address;
  return [a.street, a.locality].filter(Boolean).join(', ');
}

// Negocio local para el home. Solo incluye lo que está configurado.
function localBusinessJsonLd(siteUrl, biz = getBusiness()) {
  const a = biz.address;
  const ld = {
    '@context': 'https://schema.org',
    '@type': 'AutoRepair',
    '@id': `${siteUrl}/#negocio`,
    name: biz.name,
    url: siteUrl,
    logo: `${siteUrl}/images/nobg_logo/logo_transp.png`,
    image: `${siteUrl}/images/og-default.jpg`,
    description: 'Taller de motos en Bogotá: mecánica, electricidad, escaneo, pintura, alistamiento para la revisión técnico-mecánica y tienda de accesorios con instalación.',
    address: {
      '@type': 'PostalAddress',
      ...(a.street ? { streetAddress: a.street } : {}),
      addressLocality: a.locality,
      addressRegion: a.region,
      ...(a.postalCode ? { postalCode: a.postalCode } : {}),
      addressCountry: a.country,
    },
    telephone: biz.phone,
    areaServed: { '@type': 'City', name: 'Bogotá' },
    sameAs: Object.values(biz.social || {}).filter(Boolean),
  };
  if (Number.isFinite(biz.geo.lat) && Number.isFinite(biz.geo.lng)) {
    ld.geo = { '@type': 'GeoCoordinates', latitude: biz.geo.lat, longitude: biz.geo.lng };
  }
  const hours = openingHoursSpecification(biz);
  if (hours.length) ld.openingHoursSpecification = hours;
  if (biz.mapsUrl) ld.hasMap = biz.mapsUrl;
  return ld;
}

module.exports = {
  DEFAULTS, WEEK, DAY_NAMES, DAY_SHORT, getBusiness, normalizeHours, bogotaParts, openStatus, hoursSummary,
  openingHoursSpecification, localBusinessJsonLd, fullAddress, fmtHour,
};
