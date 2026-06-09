'use strict';
// Contenido editable del admin que antes se guardaba con saveJSON a disco y por
// tanto no persistía en serverless: cursos, clases y disponibilidad del
// calendario. Misma técnica que helpers/catalog.js — contenedores ESTABLES y
// compartidos que se mutan in-place, así los sitios de lectura no cambian. El
// valor canónico vive en app_settings; los JSON en /data quedan como seed.
const path = require('path');
const fs   = require('fs');
const settings = require('./settings');
const coursesSeed = require('../data/courses.json'); // array
const classesSeed = require('../data/classes.json'); // objeto/mapa

const courses = [];                        // array de cursos
const classes = {};                        // mapa cursoKey -> { title, topics }
const availability = { blockedDates: [] }; // { blockedDates, occupationLevels? }

function fillArray(arr, src) {
  arr.length = 0;
  if (Array.isArray(src)) for (const x of src) arr.push(x);
}
function fillObject(obj, src) {
  for (const k of Object.keys(obj)) delete obj[k];
  if (src && typeof src === 'object') Object.assign(obj, src);
}
function ensureAvailabilityShape() {
  if (!Array.isArray(availability.blockedDates)) availability.blockedDates = [];
}

// Seed inicial desde /data (availability no tiene archivo: queda el default).
fillArray(courses, coursesSeed);
fillObject(classes, classesSeed);
try {
  const avSeed = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'availability.json'), 'utf8'));
  fillObject(availability, avSeed);
} catch { /* sin archivo */ }
ensureAvailabilityShape();

// Rellena los contenedores desde app_settings (una vez por cold start).
function loadContent() {
  const c  = settings.get('courses');      if (c  !== undefined) fillArray(courses, c);
  const cl = settings.get('classes');      if (cl !== undefined) fillObject(classes, cl);
  const av = settings.get('availability'); if (av !== undefined) fillObject(availability, av);
  ensureAvailabilityShape();
}

const saveCourses      = () => settings.set('courses', courses);
const saveClasses      = () => settings.set('classes', classes);
const saveAvailability = () => settings.set('availability', availability);

module.exports = { courses, classes, availability, loadContent, saveCourses, saveClasses, saveAvailability };
