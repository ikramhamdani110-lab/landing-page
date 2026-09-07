export default async function run(page, ui) {
  await page.bringToFront();
  // wait for hero tween to fully settle
  await page.waitForTimeout(5000);
  const initial = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.hero-headline')).opacity);

  // scroll away and come back via Home
  await page.evaluate(() => document.getElementById('studio').scrollIntoView());
  await page.waitForTimeout(1000);
  await page.evaluate(() => document.querySelector('a[href="#home"]').click());
  await page.waitForTimeout(5000);
  const afterHome = await page.evaluate(() => ({
    headline: getComputedStyle(document.querySelector('.hero-headline')).opacity,
    badge: getComputedStyle(document.querySelector('.hero-badge')).opacity,
    cta: getComputedStyle(document.querySelector('.hero-cta')).opacity,
    icon: getComputedStyle(document.querySelector('.hero-constellation span')).opacity
  }));

  // repeat the cycle once more
  await page.evaluate(() => document.getElementById('join').scrollIntoView());
  await page.waitForTimeout(800);
  await page.evaluate(() => document.querySelector('a[href="#home"]').click());
  await page.waitForTimeout(5000);
  const afterHome2 = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.hero-headline')).opacity);

  return { initial, afterHome, afterHome2 };
}
