'use strict';

const { chromium } = require('playwright-extra');
const StealthPlugin = require('playwright-extra-plugin-stealth');

chromium.use(StealthPlugin());

const RUNT_URL = 'https://www.runt.gov.co/consultaCiudadana/#/consulta/vehiculo';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

/**
 * Normaliza una cadena de fecha al formato ISO YYYY-MM-DD.
 * Soporta: "DD/MM/YYYY", "DD-MM-YYYY", "DD/MM/YY", y variaciones con espacios.
 */
function normalizarFecha(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, '');
  // Intento directo si ya viene en ISO
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Formatos DD/MM/YYYY o DD-MM-YYYY
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

/**
 * Consulta el historial vehicular en el portal RUNT y retorna las fechas de
 * vencimiento del SOAT y la Revisión Técnico-Mecánica (RTM).
 *
 * @param {string} placa    - Placa del vehículo (ej. "ABC123").
 * @param {string} documento - Número de cédula del propietario.
 * @returns {Promise<{success: boolean, data: {soat_vencimiento: string|null, tecno_vencimiento: string|null}|null, error: string|null}>}
 */
async function consultarHistorialRunt(placa, documento) {
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
      ],
    });

    const context = await browser.newContext({
      userAgent: USER_AGENT,
      viewport: { width: 1366, height: 768 },
      locale: 'es-CO',
      timezoneId: 'America/Bogota',
    });

    const page = await context.newPage();

    // Oculta navigator.webdriver incluso con stealth activo (doble capa)
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(RUNT_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // ── Selección de tipo de consulta ────────────────────────────────────────
    // El portal RUNT muestra un select/radio de tipo de búsqueda.
    // Selecciona "Procedencia Nacional / Placa y Propietario".
    await page.selectOption('select[name="tipoBusqueda"], #tipoBusqueda', {
      label: /procedencia nacional/i,
    }).catch(() => {
      // Si es un radio button en vez de select
      page.click('input[type="radio"][value*="NACIONAL"], label:has-text("Procedencia Nacional")');
    });

    // ── Relleno del formulario ───────────────────────────────────────────────
    const placaMayus = placa.toUpperCase().trim();

    await page.fill('input[name="placa"], #placa, input[placeholder*="placa" i]', placaMayus);
    await page.fill(
      'input[name="cedula"], input[name="documento"], #nroDocumento, input[placeholder*="documento" i]',
      documento.trim()
    );

    // ── TODO: INTEGRAR PASARELA DE CAPTCHA ──────────────────────────────────
    //
    // El RUNT usa reCAPTCHA v2/v3 o un control visual personalizado.
    // Para automatización desatendida, integra un servicio de resolución:
    //
    // Opción A – 2Captcha (reCAPTCHA v2):
    //   const Captcha2 = require('2captcha');
    //   const solver = new Captcha2.Solver(process.env.TWOCAPTCHA_API_KEY);
    //   const siteKey = await page.getAttribute('.g-recaptcha', 'data-sitekey');
    //   const { data: token } = await solver.recaptcha(siteKey, page.url());
    //   await page.evaluate(t => { document.getElementById('g-recaptcha-response').value = t; }, token);
    //
    // Opción B – Anti-Captcha:
    //   const AntiCaptcha = require('anticaptcha');
    //   ... (misma lógica, API compatible)
    //
    // Opción C – Modo asistido (pruebas):
    //   El script espera a que el usuario resuelva el captcha manualmente.
    //   Lanza el navegador con headless: false y aumenta el timeout.
    // ─────────────────────────────────────────────────────────────────────────

    // Envío del formulario
    await Promise.all([
      page.click(
        'button[type="submit"], input[type="submit"], button:has-text("Consultar"), button:has-text("Buscar")'
      ),
      // Espera la tabla de resultados hasta 30 s (tiempo para resolver captcha asistido)
      page.waitForSelector(
        'table.resultado, table[class*="result"], .informacion-vehiculo, #datosVehiculo',
        { timeout: 30_000 }
      ),
    ]);

    // ── Extracción de fechas ─────────────────────────────────────────────────
    const data = await page.evaluate(() => {
      /**
       * Busca en el DOM la celda que sigue al encabezado que coincide con `keyword`.
       * Recorre todas las filas de tablas y divs con estructura label/valor.
       */
      function buscarValor(keyword) {
        const re = new RegExp(keyword, 'i');

        // Estrategia 1: tablas <th>/<td>
        for (const th of document.querySelectorAll('th, td.label, td.titulo')) {
          if (re.test(th.textContent)) {
            const td = th.nextElementSibling || th.parentElement?.nextElementSibling?.querySelector('td');
            if (td) return td.textContent;
          }
        }

        // Estrategia 2: filas con dos columnas (label | valor)
        for (const tr of document.querySelectorAll('tr')) {
          const cells = tr.querySelectorAll('td');
          if (cells.length >= 2 && re.test(cells[0].textContent)) {
            return cells[1].textContent;
          }
        }

        // Estrategia 3: dt/dd
        for (const dt of document.querySelectorAll('dt')) {
          if (re.test(dt.textContent)) {
            const dd = dt.nextElementSibling;
            if (dd && dd.tagName === 'DD') return dd.textContent;
          }
        }

        // Estrategia 4: divs con clase que contenga "valor" o "value"
        for (const el of document.querySelectorAll('[class*="valor"], [class*="value"], [class*="dato"]')) {
          const label = el.previousElementSibling;
          if (label && re.test(label.textContent)) return el.textContent;
        }

        return null;
      }

      return {
        soat_raw: buscarValor('soat.*venc|venc.*soat|vigencia.*soat'),
        tecno_raw: buscarValor('tecno.?mec|rtm.*venc|venc.*rtm|revis.*t[eé]cn|vigencia.*revis'),
      };
    });

    const soat_vencimiento = normalizarFecha(data.soat_raw);
    const tecno_vencimiento = normalizarFecha(data.tecno_raw);

    return {
      success: true,
      data: { soat_vencimiento, tecno_vencimiento },
      error: null,
    };
  } catch (err) {
    return {
      success: false,
      data: null,
      error: err?.message ?? String(err),
    };
  } finally {
    if (browser) await browser.close();
  }
}

module.exports = { consultarHistorialRunt };
