// Desktop viewport, scroll to the dimmed region, identify the top element there
export default async function run(page, ui) {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', 'talora-admin');
  await page.click('#loginBtn');
  await page.waitForSelector('#cmsView:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('#tableBody tr, #contentCards .content-card', { timeout: 5000 });
  await page.waitForTimeout(300);
  const probe = await page.evaluate(() => {
    const el = document.elementFromPoint(400, 600); // inside dimmed area in previous shot
    return { top: el && (el.className || el.tagName), bodyBg: getComputedStyle(document.body).backgroundAttachment };
  });
  return { ...probe, rows: await page.locator('#tableBody tr').count(), cards: await page.locator('.content-card').count() };
}
