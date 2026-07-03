const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:3000/checkin');
  await page.fill('#brand', 'ya');
  await page.waitForTimeout(300);
  const hiddenAfter2 = await page.locator('.brand-suggest-list').getAttribute('hidden');
  await page.type('#brand', 'm');
  await page.waitForTimeout(300);
  const html = await page.locator('.brand-suggest-list').innerHTML();
  const hiddenAfter3 = await page.locator('.brand-suggest-list').getAttribute('hidden');

  await page.screenshot({ path: '/tmp/claude-1000/-home-mike-dev-work-github-com-gorillaz-motorbikes/158dce71-b0c5-4aab-8c5a-ce13e3f400ff/scratchpad/checkin-dropdown.png' });

  await page.click('.brand-suggest-list li:has-text("Yamaha")');
  const val = await page.inputValue('#brand');

  console.log('hidden after 2 chars:', hiddenAfter2);
  console.log('hidden after 3 chars:', hiddenAfter3);
  console.log('list html:', html);
  console.log('value after click:', val);
  console.log('console errors:', errors);

  await browser.close();
})();
