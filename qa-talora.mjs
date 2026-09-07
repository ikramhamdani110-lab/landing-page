import { chromium } from 'playwright';

const BASE = 'http://localhost:5500';
const VIEWPORTS = [
  [375, 667], [390, 844], [414, 896], [768, 1024],
  [1024, 768], [1280, 800], [1440, 900], [1920, 1080]
];

const browser = await chromium.launch();
const report = { errors: [], overflow: {}, checks: {} };

// --- 1. Console errors on desktop viewport ---
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('console', m => { if (m.type() === 'error') report.errors.push(m.text()); });
page.on('pageerror', e => report.errors.push('PAGEERROR: ' + e.message));
await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForTimeout(2500);

// --- 2. Contact chooser behavior ---
const activeDefault = await page.$eval('.audience-btn.active', el => el.dataset.audience);
await page.click('.audience-btn[data-audience="join"]');
await page.waitForTimeout(400);
const afterJoin = await page.$eval('.audience-btn.active', el => el.dataset.audience);
const ariaJoin = await page.$eval('.audience-btn[data-audience="join"]', el => el.getAttribute('aria-selected'));
const hiddenVal1 = await page.$eval('#audienceInput', el => el.value);
const ctxText = await page.$eval('#formContext', el => el.textContent);
await page.click('.audience-btn[data-audience="project"]');
await page.waitForTimeout(400);
const afterProject = await page.$eval('.audience-btn.active', el => el.dataset.audience);
const hiddenVal2 = await page.$eval('#audienceInput', el => el.value);
const activeCount = await page.$$eval('.audience-btn.active', els => els.length);

report.checks.chooser = { activeDefault, afterJoin, ariaJoin, hiddenVal1, ctxText, afterProject, hiddenVal2, activeCount };

// Form fields work
await page.fill('#name', 'QA Tester');
await page.fill('#email', 'qa@test.dev');
await page.fill('#message', 'Hello TALORA');
report.checks.formFields = 'ok';

// Social card links
report.checks.githubHref = await page.$eval('.github-card', el => el.href);
report.checks.linkedinHref = await page.$eval('.linkedin-card', el => el.href);

// --- 3. Join carousel scroll behavior ---
await page.evaluate(() => document.getElementById('join').scrollIntoView());
await page.waitForTimeout(800);
const title0 = await page.$eval('#joinTitle', el => el.textContent);
const dot0 = await page.$$eval('.join-dot.active', els => els.map(e => e.dataset.state));

// scroll through pin range
await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
await page.waitForTimeout(1200);
const title1 = await page.$eval('#joinTitle', el => el.textContent);
const y1 = await page.$eval('#joinCard', el => el.getBoundingClientRect().top);
await page.evaluate(() => window.scrollBy(0, window.innerHeight * 1.2));
await page.waitForTimeout(1200);
const title2 = await page.$eval('#joinTitle', el => el.textContent);
const dot2 = await page.$$eval('.join-dot.active', els => els.map(e => e.dataset.state));
const y2 = await page.$eval('#joinCard', el => el.getBoundingClientRect().top);

report.checks.join = { title0, dot0, title1, title2, dot2, y1, y2 };

// --- 4. Orbit behavior ---
await page.evaluate(() => document.getElementById('build').scrollIntoView());
await page.waitForTimeout(1500);
const orbitBefore = await page.$eval('#orbitalCards .cap-card', el => el.style.transform);
await page.click('#orbitNext');
await page.waitForTimeout(1400);
const orbitAfter = await page.$eval('#orbitalCards .cap-card', el => el.style.transform);
await page.click('#orbitPrev');
await page.waitForTimeout(1400);
const orbitBack = await page.$eval('#orbitalCards .cap-card', el => el.style.transform);
// orbit size: stage height
report.checks.orbit = {
  orbitBefore, orbitAfter, orbitBack,
  stageH: await page.$eval('.orbital-stage', el => el.getBoundingClientRect().height),
  stageW: await page.$eval('.orbital-stage', el => el.getBoundingClientRect().width)
};

// --- 5. Atmosphere: no purple planet ---
const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundImage);
report.checks.bodyBg = bodyBg.slice(0, 160);
const purple = await page.evaluate(() => {
  const hits = [];
  document.querySelectorAll('.bg-glow').forEach(el => {
    const bg = getComputedStyle(el).backgroundImage;
    if (bg.includes('110, 60, 190') || bg.includes('138, 43, 226')) hits.push(bg.slice(0, 80));
  });
  return hits;
});
report.checks.purpleGlow = purple;

// --- 6. Horizontal overflow at all viewports ---
for (const [w, h] of VIEWPORTS) {
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  p.on('pageerror', e => report.errors.push(`[${w}] PAGEERROR: ` + e.message));
  await p.goto(BASE, { waitUntil: 'networkidle' });
  await p.waitForTimeout(2000);
  const res = await p.evaluate(() => ({
    scrollW: document.documentElement.scrollWidth,
    clientW: document.documentElement.clientWidth,
    bodyScrollW: document.body.scrollWidth
  }));
  // also scroll to each section and check
  for (const id of ['build', 'join', 'contact']) {
    await p.evaluate(i => document.getElementById(i).scrollIntoView(), id);
    await p.waitForTimeout(700);
    const r2 = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (r2.sw > r2.cw + 1) res['overflowAt_' + id] = r2.sw - r2.cw;
  }
  report.overflow[w] = res;
  await p.close();
}

console.log(JSON.stringify(report, null, 1));
await browser.close();
