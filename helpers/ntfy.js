'use strict';
// Avisos push al celular del dueño con ntfy (https://ntfy.sh). Sin librerías:
// un POST JSON al servidor. Si NTFY_TOPIC no está definido, no hace nada.
//
// Variables:
//   NTFY_TOPIC   tema al que está suscrita la app de ntfy (obligatoria)
//   NTFY_SERVER  servidor propio; por defecto https://ntfy.sh
//   NTFY_TOKEN   token de acceso si el tema está protegido (opcional)
//
// Se publica en JSON (no con cabeceras Title/Tags) porque las cabeceras HTTP
// no aceptan tildes ni eñes y los textos van en español.
// Nunca lanza: un aviso caído no debe tumbar una cita ni un pago.

const TIMEOUT_MS = 4000;

function ntfyEnabled() {
  return Boolean(process.env.NTFY_TOPIC);
}

function buildPayload({ title, message, tags, priority, click }) {
  const payload = { topic: process.env.NTFY_TOPIC, message: String(message || '').slice(0, 4000) };
  if (title) payload.title = String(title).slice(0, 200);
  if (tags && tags.length) payload.tags = tags;
  if (priority) payload.priority = priority;
  if (click) payload.click = click;
  return payload;
}

// En Vercel la función se congela al responder, así que hay que esperar el
// fetch (con tope de tiempo) antes de devolver la respuesta.
async function notify(opts, { fetchImpl = fetch } = {}) {
  if (!ntfyEnabled()) return false;
  const server = (process.env.NTFY_SERVER || 'https://ntfy.sh').replace(/\/+$/, '');
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.NTFY_TOKEN) headers.Authorization = `Bearer ${process.env.NTFY_TOKEN}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetchImpl(server, {
      method: 'POST', headers, body: JSON.stringify(buildPayload(opts)), signal: ctrl.signal,
    });
    if (!res.ok) console.error('[ntfy] respuesta', res.status);
    return res.ok;
  } catch (e) {
    console.error('[ntfy] error:', e.message);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { notify, ntfyEnabled, buildPayload };
