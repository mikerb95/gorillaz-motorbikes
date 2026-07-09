const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  page.on('console', m => console.log('CONSOLE:', m.text()));
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto('http://localhost:3000/kds/checkin');

  // Check clientName is readonly
  const isReadonly = await page.getAttribute('#clientName', 'readonly');
  console.log('clientName readonly attr:', isReadonly);

  await page.click('#clientName');
  await page.waitForTimeout(300);
  const kbdOpen = await page.evaluate(() => document.querySelector('.kds-vkb-wrap.open') !== null);
  console.log('keyboard opened after click:', kbdOpen);

  // type "Juan" using virtual keys
  const keys = ['j','u','a','n'];
  for (const k of keys) {
    await page.click(`.kds-vkb-key:text-is("${k}")`);
  }
  await page.waitForTimeout(100);
  const val = await page.inputValue('#clientName');
  console.log('clientName value after typing:', val);

  // press shift then a letter
  await page.click('.kds-vkb-key.action:text-is("⇧")');
  await page.click('.kds-vkb-key:text-is("P")');
  const val2 = await page.inputValue('#clientName');
  console.log('clientName value after shift+P:', val2);

  // backspace
  await page.click('.kds-vkb-key.action:text-is("⌫")');
  const val3 = await page.inputValue('#clientName');
  console.log('clientName value after backspace:', val3);

  // done
  await page.click('.kds-vkb-done');
  await page.waitForTimeout(200);
  const kbdClosed = await page.evaluate(() => !document.querySelector('.kds-vkb-wrap.open'));
  console.log('keyboard closed after done:', kbdClosed);

  // Test plate uppercase behavior
  await page.click('#plate');
  await page.waitForTimeout(200);
  await page.click('.kds-vkb-key:text-is("a")');
  await page.click('.kds-vkb-key:text-is("b")');
  await page.click('.kds-vkb-key:text-is("c")');
  const plateVal = await page.inputValue('#plate');
  console.log('plate value (should be uppercase):', plateVal);
  await page.click('.kds-vkb-done');

  // Test brand suggestion dropdown still works
  await page.click('#brand');
  await page.waitForTimeout(200);
  for (const k of ['y','a','m']) await page.click(`.kds-vkb-key:text-is("${k}")`);
  await page.waitForTimeout(300);
  const dropdownVisible = await page.evaluate(() => {
    const list = document.querySelector('.brand-suggest-list');
    return list && !list.hidden && list.children.length > 0;
  });
  console.log('brand dropdown visible with suggestions:', dropdownVisible);

  await browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
