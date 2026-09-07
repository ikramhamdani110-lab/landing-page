export default async function run(page, ui) {
  const results = {};

  // 1. Console errors are captured by the runner; check horizontal overflow at desktop
  results.desktopOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

  // 2. Orbital cards exist and one is active
  results.capCards = await page.evaluate(() => document.querySelectorAll('.cap-card').length);
  results.orbitClick = await page.evaluate(() => {
    document.getElementById('orbitNext').click();
    return true;
  });
  await page.waitForTimeout(1400);
  results.orbitAfterNext = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.cap-card')];
    const front = cards.find(c => parseFloat(getComputedStyle(c).opacity) > 0.9);
    return front ? front.querySelector('h3').textContent : 'none';
  });

  // 3. Join card cycle: click dot 2, expect title change
  await page.evaluate(() => document.querySelectorAll('.join-dot')[2].click());
  await page.waitForTimeout(1500);
  results.joinTitle = await page.evaluate(() => document.getElementById('joinTitle').textContent);
  results.joinDotActive = await page.evaluate(() =>
    [...document.querySelectorAll('.join-dot')].findIndex(d => d.classList.contains('active')));

  // 4. Studio timeline items present
  results.timelineItems = await page.evaluate(() => document.querySelectorAll('.timeline-item').length);
  results.marqueeWords = await page.evaluate(() => document.querySelector('.marquee-track span').textContent);

  // 5. Scroll to bottom, then click Home and verify hero replays (opacity recovers)
  await page.evaluate(() => document.querySelector('a[href="#home"]').click());
  await page.waitForTimeout(2200);
  results.heroHeadlineOpacity = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.hero-headline')).opacity);
  results.heroBadgeOpacity = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.hero-badge')).opacity);

  // 6. Mobile viewport overflow test
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(800);
  results.mobileOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.evaluate(() => document.getElementById('build').scrollIntoView());
  await page.waitForTimeout(700);
  results.mobileBuildOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1000);
  results.mobileHeroVisible = await page.evaluate(() =>
    getComputedStyle(document.querySelector('.hero-headline')).opacity);

  // 7. Tablet viewport
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.waitForTimeout(800);
  results.tabletOverflow = await page.evaluate(() =>
    document.documentElement.scrollWidth - document.documentElement.clientWidth);

  return results;
}
