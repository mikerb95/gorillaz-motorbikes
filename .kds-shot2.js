const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await page.goto('http://localhost:3000/kds/orden/b5e814b7-a15a-433b-81e4-4efd3e10ae96', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/claude-1000/-home-mike-dev-work-github-com-gorillaz-motorbikes/a613532f-a71f-4825-bfe9-dfe72867b254/scratchpad/kds-order-detail.png', fullPage: true });
  await page.goto('http://localhost:3000/kds/placa/buscar?placa=ZZZ999', { waitUntil: 'networkidle' });
  await page.screenshot({ path: '/tmp/claude-1000/-home-mike-dev-work-github-com-gorillaz-motorbikes/a613532f-a71f-4825-bfe9-dfe72867b254/scratchpad/kds-order-new.png', fullPage: true });
  await browser.close();
})();
