'use strict';
require('dotenv').config();

const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
chromium.use(StealthPlugin());

const RUNT_URL = 'https://www.runt.gov.co/consultaCiudadana/#/consulta/vehiculo';

(async () => {
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    viewport: { width: 1366, height: 768 },
  });
  const page = await context.newPage();
  await page.goto(RUNT_URL, { waitUntil: 'networkidle', timeout: 30_000 });

  console.log('👉 Llena el formulario, resuelve el captcha y espera los resultados.');
  console.log('👉 Cuando veas los datos en pantalla, presiona ENTER aquí para capturar.\n');

  // Espera a que presiones ENTER en la terminal
  await new Promise(resolve => process.stdin.once('data', resolve));

  // Captura screenshot y HTML en el momento exacto que indicas
  await page.screenshot({ path: 'runt-snapshot.png', fullPage: true });
  const html = await page.content();
  require('fs').writeFileSync('runt-snapshot.html', html);

  console.log('\n✅ Screenshot guardado en runt-snapshot.png');
  console.log('✅ HTML guardado en runt-snapshot.html');

  await browser.close();
})();
