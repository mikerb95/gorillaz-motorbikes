'use strict';

const BASE = 'https://runtproapi.runt.gov.co/CYRConsultaVehiculoMS';

const HEADERS_BASE = {
  'accept': 'application/json, text/plain, */*',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
  'x-funcionalidad': 'SHELL',
  'referer': '',
};

function normalizarFecha(raw) {
  if (!raw) return null;
  const s = String(raw).trim().replace(/\s+/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

async function get(path, token) {
  const headers = { ...HEADERS_BASE };
  if (token) headers['auth-token'] = `Bearer ${token}`;
  const res = await fetch(`${BASE}${path}`, { headers });
  if (!res.ok) throw new Error(`RUNT ${path} → HTTP ${res.status}`);
  return res.json();
}

async function post(path, body) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { ...HEADERS_BASE, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RUNT ${path} → HTTP ${res.status}`);
  return res.json();
}

/**
 * Genera un captcha de imagen desde el RUNT.
 * Retorna { idLibreCaptcha, imagenBase64 } para mostrar al usuario.
 */
async function generarCaptcha() {
  const data = await get('/captcha/libre-captcha/generar');
  // La API retorna algo como: { id, imagen } o { idLibreCaptcha, imagen }
  return {
    idLibreCaptcha: data.id ?? data.idLibreCaptcha ?? data.uuid,
    imagenBase64: data.imagen ?? data.image ?? data.captchaImage,
    raw: data,
  };
}

/**
 * Autentica contra el RUNT y retorna el JWT.
 * @param {string} placa
 * @param {string} documento
 * @param {string} idLibreCaptcha  - ID recibido al generar el captcha
 * @param {string} captcha         - Texto que el usuario leyó de la imagen
 */
async function autenticar(placa, documento, idLibreCaptcha, captcha) {
  const body = {
    procedencia: 'NACIONAL',
    tipoConsulta: '1',
    placa: placa.toUpperCase().trim(),
    tipoDocumento: 'C',
    documento: documento.trim(),
    vin: null,
    soat: null,
    aseguradora: '',
    rtm: null,
    reCaptcha: null,
    captcha: captcha.trim(),
    valueCaptchaEncripted: '',
    idLibreCaptcha,
    verBannerSoat: true,
    configuracion: { tiempoInactividad: '900', tiempoCuentaRegresiva: '10' },
  };
  const data = await post('/auth', body);
  // La API retorna el token en data.token, data.authToken, o en el header
  const token = data.token ?? data.authToken ?? data.access_token ?? data.jwt;
  if (!token) throw new Error('No se recibió token del RUNT: ' + JSON.stringify(data));
  return token;
}

/**
 * Con el JWT activo, consulta las pólizas SOAT y los certificados RTM.
 * Retorna { soat_vencimiento, tecno_vencimiento } en formato YYYY-MM-DD.
 */
async function consultarVigencias(token) {
  // Llamadas en paralelo a los endpoints de datos
  const [soatData, rtmData] = await Promise.allSettled([
    get('/poliza-soat', token),
    get('/revision-tecnico-mecanica', token),
  ]);

  let soat_vencimiento = null;
  if (soatData.status === 'fulfilled') {
    const polizas = soatData.value?.polizas ?? soatData.value?.data ?? soatData.value ?? [];
    const activa = Array.isArray(polizas)
      ? polizas.find(p => /vigente|activ/i.test(p.estado ?? '')) ?? polizas[0]
      : polizas;
    soat_vencimiento = normalizarFecha(
      activa?.fechaFinVigencia ?? activa?.fechaVencimiento ?? activa?.vigencia
    );
  }

  let tecno_vencimiento = null;
  if (rtmData.status === 'fulfilled') {
    const certificados = rtmData.value?.certificados ?? rtmData.value?.data ?? rtmData.value ?? [];
    const vigente = Array.isArray(certificados)
      ? certificados.find(c => c.vigente === true || c.vigente === 'SI') ?? certificados[0]
      : certificados;
    tecno_vencimiento = normalizarFecha(
      vigente?.fechaVigencia ?? vigente?.fechaVencimiento ?? vigente?.vigencia
    );
  }

  return { soat_vencimiento, tecno_vencimiento };
}

/**
 * Flujo completo. Requiere que el frontend haya pedido el captcha antes.
 *
 * @param {string} placa
 * @param {string} documento
 * @param {string} idLibreCaptcha
 * @param {string} captcha         - Texto del captcha que escribió el usuario
 */
async function consultarHistorialRunt(placa, documento, idLibreCaptcha, captcha) {
  try {
    const token = await autenticar(placa, documento, idLibreCaptcha, captcha);
    const vigencias = await consultarVigencias(token);
    return { success: true, data: vigencias, error: null };
  } catch (err) {
    return { success: false, data: null, error: err?.message ?? String(err) };
  }
}

module.exports = { generarCaptcha, consultarHistorialRunt };
