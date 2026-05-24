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

// Cookie store keyed by captchaId — válido mientras la instancia esté activa.
// En Vercel Fluid Compute la misma instancia atiende ambas requests en la
// ventana de tiempo normal (usuario llena el formulario).
const cookieStore = new Map();

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

  cookieStore.set(id, allCookies);
  // Limpiar entradas viejas (máx 200)
  if (cookieStore.size > 200) cookieStore.delete(cookieStore.keys().next().value);

  return {
    idLibreCaptcha: id,
    imagenBase64: data.imagen ?? data.image ?? data.captchaImage,
    raw: data,
  };
}

async function autenticar(placa, documento, idLibreCaptcha, captcha) {
  const cookie = cookieStore.get(idLibreCaptcha) ?? '';

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
  if (authCookie) {
    cookieStore.set(idLibreCaptcha, [cookie, authCookie].filter(Boolean).join('; '));
  }

  const token = data.token ?? data.authToken ?? data.access_token ?? data.jwt;
  if (!token) throw new Error('No se recibió token del RUNT: ' + JSON.stringify(data));
  return { token, cookie: cookieStore.get(idLibreCaptcha) ?? '' };
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
    cookieStore.delete(idLibreCaptcha);
    return { success: true, data: vigencias, error: null };
  } catch (err) {
    cookieStore.delete(idLibreCaptcha);
    return { success: false, data: null, error: err?.message ?? String(err) };
  }
}

module.exports = { generarCaptcha, consultarHistorialRunt };
