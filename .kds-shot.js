const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const pages = [
    ['login', 'http://localhost:3000/kds/login'],
    ['board', 'http://localhost:3000/kds'],
    ['placa', 'http://localhost:3000/kds/placa'],
  ];
  for (const [name, url] of pages) {
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `/tmp/claude-1000/-home-mike-dev-work-github-com-gorillaz-motorbikes/a613532f-a71f-4825-bfe9-dfe72867b254/scratchpad/kds-${name}.png` });
  }
  await browser.close();
})();
