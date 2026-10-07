'use strict';

const BASE = 'https://runtproapi.runt.gov.co/CYRConsultaVehiculoMS';

const HEADERS_BASE = {
  'accept': 'application/json, text/plain, */*',
  'accept-language': 'es-CO,es;q=0.9,en;q=0.8',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'x-funcionalidad': 'SHELL',
  'origin': 'https://www.runt.gov.co',
  'referer': 'https://www.runt.gov.co/',
};

// Cookies de la sesión del RUNT por captchaId, guardadas en la BD: el captcha y
// la consulta son dos requests y en Vercel pueden caer en instancias distintas.
// Una sesión vale 15 minutos (lo que el RUNT da de inactividad).
const SESSION_TTL_MIN = 15;

function sessionsDb() {
  return require('../db').db; // perezoso: db.js no debe cargarse al importar este módulo
}

const cookieStore = {
  async get(id) {
    const r = await sessionsDb().execute({
      sql: `SELECT cookies FROM runt_sessions WHERE id = ? AND created_at > strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)`,
      args: [String(id), `-${SESSION_TTL_MIN} minutes`],
    });
    return r.rows[0]?.cookies ?? '';
  },
  async set(id, cookies) {
    const conn = sessionsDb();
    await conn.execute({
      sql: `INSERT INTO runt_sessions (id, cookies) VALUES (?, ?)
            ON CONFLICT(id) DO UPDATE SET cookies = excluded.cookies`,
      args: [String(id), cookies || ''],
    });
    await conn.execute({
      sql: `DELETE FROM runt_sessions WHERE created_at < strftime('%Y-%m-%dT%H:%M:%SZ','now', ?)`,
      args: [`-${SESSION_TTL_MIN} minutes`],
    });
  },
  async delete(id) {
    await sessionsDb().execute({ sql: 'DELETE FROM runt_sessions WHERE id = ?', args: [String(id)] }).catch(() => {});
  },
};

function extractCookies(res) {
  try {
    const list = res.headers.getSetCookie?.() ?? [];
    return list.map(c => c.split(';')[0]).join('; ');
  } catch {
    return (res.headers.get('set-cookie') ?? '')
      .split(',')
      .map(c => c.split(';')[0].trim())
      .join('; ');
  }
}

async function fetchJson(url, options = {}) {
  const res = await fetch(url, options);
  if (!res.ok) throw new Error(`RUNT ${url.replace(BASE, '')} → HTTP ${res.status}`);
  return { data: await res.json(), cookies: extractCookies(res) };
}

function normalizarFecha(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Genera un captcha de imagen desde el RUNT.
 * También inicializa la sesión HTTP para capturar las cookies necesarias.
 */
async function generarCaptcha() {
  // Paso 1 — inicializar sesión (captura cookies de sesión, falla suave si no responde)
  let sessionCookie = '';
  try {
    const r = await fetchJson(`${BASE}/configuracion-sesion`, { headers: HEADERS_BASE });
    sessionCookie = r.cookies;
  } catch { /* continuar sin cookies de sesión */ }

  const headers1 = { ...HEADERS_BASE, ...(sessionCookie ? { cookie: sessionCookie } : {}) };

  // Paso 2 — obtener captcha
  const { data, cookies: captchaCookie } = await fetchJson(`${BASE}/captcha/libre-captcha/generar`, {
    headers: headers1,
  });

  const id = data.id ?? data.idLibreCaptcha ?? data.uuid;
  const allCookies = [sessionCookie, captchaCookie].filter(Boolean).join('; ');

  await cookieStore.set(id, allCookies);

  return {
    idLibreCaptcha: id,
    imagenBase64: data.imagen ?? data.image ?? data.captchaImage,
    raw: data,
  };
}

async function autenticar(placa, documento, idLibreCaptcha, captcha) {
  const cookie = await cookieStore.get(idLibreCaptcha);

  const body = {
    procedencia: 'NACIONAL',
    tipoConsulta: '1',
    placa: placa.toUpperCase().trim(),
    tipoDocumento: 'C',
    documento: documento.trim(),
    vin: null, soat: null, aseguradora: '', rtm: null, reCaptcha: null,
    captcha: captcha.trim(),
    valueCaptchaEncripted: '',
    idLibreCaptcha,
    verBannerSoat: true,
    configuracion: { tiempoInactividad: '900', tiempoCuentaRegresiva: '10' },
  };

  const { data, cookies: authCookie } = await fetchJson(`${BASE}/auth`, {
    method: 'POST',
    headers: {
      ...HEADERS_BASE,
      'content-type': 'application/json',
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });

  // Acumular cookies para las llamadas de datos
  const allCookies = [cookie, authCookie].filter(Boolean).join('; ');

  const token = data.token ?? data.authToken ?? data.access_token ?? data.jwt;
  if (!token) throw new Error('No se recibió token del RUNT: ' + JSON.stringify(data));
  return { token, cookie: allCookies };
}

async function consultarVigencias(token, cookie) {
  const headers = {
    ...HEADERS_BASE,
    'auth-token': `Bearer ${token}`,
    ...(cookie ? { cookie } : {}),
  };

  const [soatRes, rtmRes] = await Promise.allSettled([
    fetchJson(`${BASE}/soat`, { headers }),
    fetchJson(`${BASE}/rtms?tipo=N`, { headers }),
  ]);

  let soat_vencimiento = null;
  if (soatRes.status === 'fulfilled') {
    const polizas = Array.isArray(soatRes.value.data) ? soatRes.value.data : [];
    const activa = polizas.find(p => /vigente/i.test(p.estado ?? '')) ?? polizas[0];
    soat_vencimiento = normalizarFecha(activa?.fechaVencimSoat);
  }

  let tecno_vencimiento = null;
  if (rtmRes.status === 'fulfilled') {
    const revisiones = rtmRes.value.data?.revisiones ?? [];
    const vigente = revisiones.find(r => r.vigente === 'SI') ?? revisiones[0];
    tecno_vencimiento = normalizarFecha(vigente?.fechaVencimientoRvt);
  }

  return { soat_vencimiento, tecno_vencimiento };
}

async function consultarHistorialRunt(placa, documento, idLibreCaptcha, captcha) {
  try {
    const { token, cookie } = await autenticar(placa, documento, idLibreCaptcha, captcha);
    const vigencias = await consultarVigencias(token, cookie);
    await cookieStore.delete(idLibreCaptcha);
    return { success: true, data: vigencias, error: null };
  } catch (err) {
    await cookieStore.delete(idLibreCaptcha);
    return { success: false, data: null, error: err?.message ?? String(err) };
  }
}

module.exports = { generarCaptcha, consultarHistorialRunt, normalizarFecha };
