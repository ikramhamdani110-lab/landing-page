import { chromium } from 'playwright';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:5500', { waitUntil: 'networkidle' });
await page.waitForTimeout(4000);

await page.evaluate(() => document.getElementById('studio').scrollIntoView());
await page.waitForTimeout(1000);
const t0 = Date.now();
await page.evaluate(() => document.querySelector('a[href="#home"]').click());

// sample hero element opacities every 500ms for 8s
const samples = [];
for (let i = 0; i < 16; i++) {
  await page.waitForTimeout(500);
  const s = await page.evaluate(() => ({
    scrollY: Math.round(window.scrollY),
    headline: +getComputedStyle(document.querySelector('.hero-headline')).opacity,
    cta: +getComputedStyle(document.querySelector('.hero-cta')).opacity,
    icon: +getComputedStyle(document.querySelector('.hero-constellation span')).opacity
  }));
  samples.push({ t: Date.now() - t0, ...s });
}
console.log(JSON.stringify(samples, null, 1));
await browser.close();
