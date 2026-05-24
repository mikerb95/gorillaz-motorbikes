'use strict';
// Script de una sola vez para capturar los endpoints de la API del RUNT.
// Corre esto, haz la consulta manualmente en el browser que se abre,
// y el script imprimirá cada llamada de red que haga el portal.
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

  const llamadas = [];

  // Intercepta TODAS las llamadas de red
  page.on('request', req => {
    const url = req.url();
    const method = req.method();
    // Filtra solo las llamadas a APIs (JSON, no assets)
    if (method === 'POST' || url.includes('/api/') || url.includes('runt') && !url.match(/\.(js|css|png|svg|woff|ico)/)) {
      const entry = { method, url, headers: req.headers(), body: req.postData() };
      llamadas.push(entry);
      console.log(`\n📡 ${method} ${url}`);
      if (req.postData()) console.log('   Body:', req.postData());
    }
  });

  page.on('response', async res => {
    const url = res.url();
    const isApi = res.request().method() === 'POST' || url.includes('runtproapi') || url.includes('/api/');
    if (isApi) {
      try {
        const body = await res.json();
        const entry = llamadas.find(e => e.url === url && !e.response);
        if (entry) entry.response = body;
        console.log(`   ✅ Respuesta (${res.status()}):`, JSON.stringify(body).slice(0, 500));
      } catch { /* no es JSON */ }
    }
  });

  await page.goto(RUNT_URL, { waitUntil: 'networkidle', timeout: 30_000 });

  console.log('\n👉 Haz la consulta en el browser.');
  console.log('👉 Cuando veas los resultados, presiona ENTER aquí.\n');
  await new Promise(resolve => process.stdin.once('data', resolve));

  // Guarda un resumen con los endpoints únicos encontrados
  const fs = require('fs');
  fs.writeFileSync('runt-api-endpoints.json', JSON.stringify(llamadas, null, 2));
  console.log(`\n✅ ${llamadas.length} llamadas guardadas en runt-api-endpoints.json`);

  await browser.close();
})();
