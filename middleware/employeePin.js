'use strict';
const bcrypt = require('bcryptjs');
const { getActiveEmployees, isThrottleLocked, recordThrottleFailure } = require('../db');

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
  res.json({ ok: true, name: emp.name });
}

// Enforcement server-side (defensa en profundidad): la acción real vuelve a
// exigir el PIN en el body, aunque el modal ya lo haya verificado. Deja el autor
// en req.pinActor / req.pinEmployee para registrarlo en la trazabilidad. Ante un
// POST forjado sin pasar por el modal, bloquea volviendo a la página anterior;
// un usuario normal nunca llega aquí con un PIN inválido.
function requirePin(fallback = '/') {
  return async (req, res, next) => {
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
    req.pinEmployee = emp;
    req.pinActor    = emp.name;
    next();
  };
}

module.exports = { matchEmployeePin, verifyPinHandler, requirePin };
