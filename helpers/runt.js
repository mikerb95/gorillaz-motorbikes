'use strict';

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

// URL del formulario de consulta ciudadana
const RUNT_URL = 'https://www.runt.gov.co/consultaCiudadana/#/consulta/vehiculo';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

// Normaliza fechas DD/MM/YYYY o DD-MM-YYYY a ISO YYYY-MM-DD
function normalizarFecha(raw) {
  if (!raw) return null;
  const s = raw.trim().replace(/\s+/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (!m) return null;
  let [, d, mo, y] = m;
  if (y.length === 2) y = `20${y}`;
  return `${y}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`;
}

// Expande un mat-expansion-panel y espera a que el contenido sea visible
async function expandirPanel(page, componentTag) {
  const header = `${componentTag} .mat-expansion-panel-header`;
  const content = `${componentTag} .mat-expansion-panel-content`;
  try {
    const panel = await page.$(header);
    if (!panel) return false;
    const expanded = await page.$eval(header, el => el.getAttribute('aria-expanded'));
    if (expanded !== 'true') {
      await panel.click();
      // Espera a que la animación termine
      await page.waitForTimeout(600);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Consulta el historial vehicular en el RUNT y retorna las fechas de
 * vencimiento del SOAT y la Revisión Técnico-Mecánica.
 *
 * @param {string} placa     Placa del vehículo (ej. "ABC123")
 * @param {string} documento Número de cédula del propietario
 */
async function consultarHistorialRunt(placa, documento) {
  let browser = null;

  try {
    browser = await chromium.launch({
      headless: false, // cambiar a true en producción
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

    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    });

    await page.goto(RUNT_URL, { waitUntil: 'networkidle', timeout: 30_000 });

    // ── Espera a que Angular cargue el formulario ────────────────────────────
    // El formulario usa Angular Material. Esperamos cualquier input visible.
    await page.waitForSelector('input, mat-select', { timeout: 15_000 });
    await page.waitForTimeout(1500); // Angular termina de renderizar

    // ── Rellena los campos del formulario ────────────────────────────────────
    const placaMayus = placa.toUpperCase().trim();

    // Intenta los selectores más comunes para Angular Material
    const selectorPlaca = [
      'input[formcontrolname="placa"]',
      'input[formcontrolname="numeroPlaca"]',
      'input[id*="placa" i]',
      'input[placeholder*="placa" i]',
      'input[name*="placa" i]',
    ].join(', ');

    const selectorDoc = [
      'input[formcontrolname="documento"]',
      'input[formcontrolname="numeroDocumento"]',
      'input[formcontrolname="cedula"]',
      'input[id*="documento" i]',
      'input[id*="cedula" i]',
      'input[placeholder*="documento" i]',
      'input[placeholder*="cédula" i]',
      'input[name*="documento" i]',
    ].join(', ');

    await page.fill(selectorPlaca, placaMayus).catch(() => null);
    await page.fill(selectorDoc, documento.trim()).catch(() => null);

    // ── TODO: INTEGRAR PASARELA DE CAPTCHA ──────────────────────────────────
    //
    // El RUNT puede usar reCAPTCHA v2/v3 antes de mostrar resultados.
    //
    // Opción A – 2Captcha (reCAPTCHA v2):
    //   const { Solver } = require('2captcha');
    //   const solver = new Solver(process.env.TWOCAPTCHA_API_KEY);
    //   const siteKey = await page.getAttribute('.g-recaptcha', 'data-sitekey');
    //   const { data: token } = await solver.recaptcha(siteKey, page.url());
    //   await page.evaluate(t => {
    //     document.getElementById('g-recaptcha-response').value = t;
    //   }, token);
    //
    // Opción B – 2Captcha (reCAPTCHA v3):
    //   const { data: token } = await solver.recaptchaV3(siteKey, page.url(), 'consultar');
    //   await page.evaluate(t => {
    //     document.getElementById('g-recaptcha-response').value = t;
    //   }, token);
    // ─────────────────────────────────────────────────────────────────────────

    // Envía el formulario
    await page.click([
      'button[type="submit"]',
      'button:has-text("Consultar")',
      'button:has-text("Buscar")',
      'input[type="submit"]',
    ].join(', ')).catch(() => null);

    // ── Espera la página de resultados (hasta 60 s para resolver captcha) ────
    // El componente raíz de resultados es 'cyrconsultavehiculo-info-vehiculo-detallada'
    await page.waitForSelector('cyrconsultavehiculo-info-vehiculo-detallada', {
      timeout: 60_000,
    });

    // ── Expande el panel de SOAT y el de RTM ─────────────────────────────────
    await expandirPanel(page, 'cyrconsultavehiculo-poliza-soat');
    await expandirPanel(page, 'cyrconsultavehiculo-rtm');

    // ── Extrae las fechas de vencimiento ─────────────────────────────────────
    const data = await page.evaluate(() => {
      // Obtiene el texto de la primera celda de una columna específica
      function textoDeCelda(scope, columnClass) {
        const cell = scope.querySelector(`.${columnClass}`);
        return cell ? cell.textContent.trim() : null;
      }

      // SOAT: columna fechaFinVigencia (fecha de vencimiento)
      const soatScope = document.querySelector('cyrconsultavehiculo-poliza-soat');
      let soat_raw = null;
      if (soatScope) {
        // Busca en mat-row la celda de fecha fin vigencia
        const soatRow = soatScope.querySelector('mat-row, tr');
        if (soatRow) {
          soat_raw = textoDeCelda(soatRow, 'mat-column-fechaFinVigencia')
            || textoDeCelda(soatScope, 'mat-column-fechaFinVigencia');
        }
        // Fallback: cualquier texto que parezca fecha después de "Fin Vigencia"
        if (!soat_raw) {
          const labels = soatScope.querySelectorAll('mat-header-cell, th');
          for (const label of labels) {
            if (/fin.*vigencia/i.test(label.textContent)) {
              const idx = Array.from(label.parentElement?.children || []).indexOf(label);
              const dataRow = soatScope.querySelector('mat-row, tr:not(:first-child)');
              if (dataRow && idx >= 0) {
                const cells = dataRow.querySelectorAll('mat-cell, td');
                soat_raw = cells[idx]?.textContent?.trim() || null;
              }
            }
          }
        }
      }

      // RTM: columna fechaVigencia (fecha de vencimiento del certificado)
      const rtmScope = document.querySelector('cyrconsultavehiculo-rtm');
      let tecno_raw = null;
      if (rtmScope) {
        const rtmRow = rtmScope.querySelector('mat-row, tr');
        if (rtmRow) {
          tecno_raw = textoDeCelda(rtmRow, 'mat-column-fechaVigencia')
            || textoDeCelda(rtmScope, 'mat-column-fechaVigencia');
        }
        if (!tecno_raw) {
          const labels = rtmScope.querySelectorAll('mat-header-cell, th');
          for (const label of labels) {
            if (/vigencia/i.test(label.textContent)) {
              const idx = Array.from(label.parentElement?.children || []).indexOf(label);
              const dataRow = rtmScope.querySelector('mat-row, tr:not(:first-child)');
              if (dataRow && idx >= 0) {
                const cells = dataRow.querySelectorAll('mat-cell, td');
                tecno_raw = cells[idx]?.textContent?.trim() || null;
              }
            }
          }
        }
      }

      return { soat_raw, tecno_raw };
    });

    return {
      success: true,
      data: {
        soat_vencimiento: normalizarFecha(data.soat_raw),
        tecno_vencimiento: normalizarFecha(data.tecno_raw),
      },
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
