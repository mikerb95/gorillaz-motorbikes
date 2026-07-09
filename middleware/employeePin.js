'use strict';
const bcrypt = require('bcryptjs');
const jwt    = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');
const { getActiveEmployees, getEmployeeById, isThrottleLocked, recordThrottleFailure } = require('../db');

// Gate de PIN para acciones sensibles (financieras + cambios de estado de orden).
// El empleado teclea su PIN justo al ejecutar la acción: identifica al AUTOR real
// (trazabilidad, aunque el panel entre con una sola sesión de admin) y añade una
// barrera aunque la sesión quede abierta. Cualquier PIN de un empleado activo
// autoriza; el empleado que lo teclea queda como actor de la acción.
//
// Throttle global propio (clave separada) contra fuerza bruta distribuida, igual
// criterio que el login por PIN del taller/KDS.
const PIN_THROTTLE_KEY = 'action_pin';
const PIN_WINDOW_MS    = 15 * 60 * 1000;
const PIN_MAX_FAILURES = 20;

// Sesión corta de PIN: una vez tecleado, no se vuelve a pedir mientras el
// empleado siga interactuando con el panel (cada acción/petición desliza la
// ventana hacia adelante). Tras 1 minuto sin ninguna interacción, expira y la
// siguiente acción sensible vuelve a exigir el PIN. Cookie httpOnly firmada
// (autoridad real, verificada server-side); una segunda cookie no-httpOnly y
// sin datos sensibles solo le indica al cliente si puede saltarse el modal.
const PIN_SESSION_COOKIE      = 'kds_pin_session';
const PIN_SESSION_HINT_COOKIE = 'kds_pin_active';
const PIN_SESSION_MS          = 60 * 1000;

function setPinSessionCookies(res, emp) {
  const token = jwt.sign({ eid: emp.id }, JWT_SECRET, { expiresIn: Math.floor(PIN_SESSION_MS / 1000) });
  const base = { sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: PIN_SESSION_MS };
  res.cookie(PIN_SESSION_COOKIE, token, { ...base, httpOnly: true });
  res.cookie(PIN_SESSION_HINT_COOKIE, '1', { ...base, httpOnly: false });
}

function clearPinSessionCookies(res) {
  res.clearCookie(PIN_SESSION_COOKIE);
  res.clearCookie(PIN_SESSION_HINT_COOKIE);
}

async function getPinSessionEmployee(req) {
  const token = req.cookies && req.cookies[PIN_SESSION_COOKIE];
  if (!token) return null;
  try {
    const { eid } = jwt.verify(token, JWT_SECRET);
    const emp = await getEmployeeById(eid);
    return (emp && emp.active) ? emp : null;
  } catch {
    return null;
  }
}

async function matchEmployeePin(pin) {
  if (!/^\d{4,6}$/.test(pin || '')) return null;
  const employees = await getActiveEmployees();
  for (const emp of employees) {
    if (emp.pinHash && await bcrypt.compare(pin, emp.pinHash)) return emp;
  }
  return null;
}

// Endpoint JSON que usa el modal para verificar el PIN ANTES de enviar el
// formulario (feedback en línea). Se monta bajo la sesión de cada panel. No
// ejecuta ninguna acción: solo valida y devuelve el nombre para mostrarlo.
async function verifyPinHandler(req, res) {
  const pin = String(req.body.pin || '').trim();
  if (!/^\d{4,6}$/.test(pin)) return res.status(400).json({ ok: false, error: 'PIN inválido.' });
  if (await isThrottleLocked(PIN_THROTTLE_KEY, PIN_MAX_FAILURES, PIN_WINDOW_MS)) {
    return res.status(429).json({ ok: false, error: 'Demasiados intentos. Espera unos minutos.' });
  }
  const emp = await matchEmployeePin(pin);
  if (!emp) {
    await recordThrottleFailure(PIN_THROTTLE_KEY, PIN_WINDOW_MS);
    return res.status(401).json({ ok: false, error: 'PIN incorrecto.' });
  }
  setPinSessionCookies(res, emp);
  res.json({ ok: true, name: emp.name });
}

// Enforcement server-side (defensa en profundidad): la acción real vuelve a
// exigir el PIN en el body, aunque el modal ya lo haya verificado. Deja el autor
// en req.pinActor / req.pinEmployee para registrarlo en la trazabilidad. Ante un
// POST forjado sin pasar por el modal, bloquea volviendo a la página anterior;
// un usuario normal nunca llega aquí con un PIN inválido.
function requirePin(fallback = '/') {
  return async (req, res, next) => {
    const sessionEmp = await getPinSessionEmployee(req);
    if (sessionEmp) {
      setPinSessionCookies(res, sessionEmp); // desliza la ventana: la acción cuenta como interacción
      req.pinEmployee = sessionEmp;
      req.pinActor    = sessionEmp.name;
      return next();
    }

    const pin  = String(req.body.pin || '').trim();
    const back = req.get('Referer') || fallback;
    if (!/^\d{4,6}$/.test(pin) || await isThrottleLocked(PIN_THROTTLE_KEY, PIN_MAX_FAILURES, PIN_WINDOW_MS)) {
      return res.redirect(back);
    }
    const emp = await matchEmployeePin(pin);
    if (!emp) {
      await recordThrottleFailure(PIN_THROTTLE_KEY, PIN_WINDOW_MS);
      return res.redirect(back);
    }
    setPinSessionCookies(res, emp);
    req.pinEmployee = emp;
    req.pinActor    = emp.name;
    next();
  };
}

// Refresca la ventana de sesión de PIN cuando el empleado interactúa con el
// panel (p. ej. navegar entre órdenes) para que "interactuar" no se limite a
// las acciones gated. OJO: se excluye el polling automático (el board consulta
// /orders.json cada 8s, la pantalla del TV /tv/estado en bucle); si esos GET
// deslizaran la ventana, la sesión de PIN nunca expiraría y la tablet quedaría
// permanentemente autorizada sin que nadie teclee un PIN.
function touchPinSession(exemptPaths = []) {
  return async (req, res, next) => {
    if (exemptPaths.some(p => req.path.endsWith(p))) return next();
    const emp = await getPinSessionEmployee(req);
    if (emp) setPinSessionCookies(res, emp);
    next();
  };
}

module.exports = {
  matchEmployeePin, verifyPinHandler, requirePin, touchPinSession,
  clearPinSessionCookies,
};
