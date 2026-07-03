const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  const errors = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  page.on('pageerror', err => errors.push(err.message));

  await page.goto('http://localhost:3000/checkin');
  await page.fill('#brand', 'yam');
  await page.waitForTimeout(200);
  await page.click('.brand-suggest-list li:has-text("Yamaha")');

  await page.click('#reference');
  await page.waitForTimeout(200);
  const modelListHtml = await page.locator('#reference').locator('xpath=../ul').innerHTML();

  await page.type('#reference', 'mt0');
  await page.waitForTimeout(200);
  const filteredHtml = await page.locator('#reference').locator('xpath=../ul').innerHTML();

  await page.screenshot({ path: '/tmp/claude-1000/-home-mike-dev-work-github-com-gorillaz-motorbikes/158dce71-b0c5-4aab-8c5a-ce13e3f400ff/scratchpad/checkin-model-dropdown.png' });

  await page.click('.brand-suggest-list li:has-text("MT03")');
  const refVal = await page.inputValue('#reference');

  console.log('brand value:', await page.inputValue('#brand'));
  console.log('model list on focus:', modelListHtml);
  console.log('model list filtered "mt0":', filteredHtml);
  console.log('reference value after click:', refVal);
  console.log('console errors:', errors);

  await browser.close();
})();
