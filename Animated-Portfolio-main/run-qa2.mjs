import { chromium } from 'playwright-core';
import qa2 from './qa2.mjs';

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('pageerror', e => consoleErrors.push('pageerror: ' + e.message));
page.on('console', m => { if (m.type() === 'error') consoleErrors.push('console: ' + m.text()); });

await page.goto('http://localhost:5500', { waitUntil: 'networkidle' });
const results = await qa2(page, console);
console.log(JSON.stringify(results, null, 2));
if (consoleErrors.length) {
  console.log('CONSOLE ERRORS:');
  consoleErrors.forEach(e => console.log(' -', e));
} else {
  console.log('No console errors.');
}
await browser.close();
