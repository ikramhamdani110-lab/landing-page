export default async function run(page, ui) {
  // Sign in only if the login view is showing (session may already be authed)
  if (await page.locator('#loginUsername').isVisible().catch(() => false)) {
    await page.fill('#loginUsername', 'admin');
    await page.fill('#loginPassword', 'talora-admin');
    await page.click('#loginBtn');
  }
  await page.waitForSelector('#siteGrid .site-card', { timeout: 10000 });

  // Count section cards
  const cards = await page.locator('#siteGrid .site-card').count();

  // Open the Hero section editor
  const heroBtn = page.locator('[data-site-section="hero"]');
  await heroBtn.click();
  await page.waitForSelector('#siteFields input', { timeout: 5000 });
  const heroBadgeVal = await page.inputValue('#sf_hero_badge');

  // Change the hero badge and save
  await page.fill('#sf_hero_badge', 'Creative Technology Studio — QA');
  await page.click('#siteSaveBtn');
  await page.waitForSelector('#alertBox.success', { timeout: 10000 });
  const alert = await page.textContent('#alertBox');

  // Verify persistence: reload the dashboard and reopen Hero
  await page.reload();
  await page.waitForSelector('#siteGrid .site-card', { timeout: 10000 });
  await page.locator('[data-site-section="hero"]').click();
  await page.waitForSelector('#siteFields input', { timeout: 5000 });
  const persisted = await page.inputValue('#sf_hero_badge');

  // Restore
  await page.fill('#sf_hero_badge', 'Creative Technology Studio');
  await page.click('#siteSaveBtn');
  await page.waitForSelector('#alertBox.success', { timeout: 10000 });

  // Sanity: legacy CRUD table still present
  const contentRows = await page.locator('#tableBody tr, #contentCards .content-card').count();

  return { cards, heroBadgeVal, alert, persistedAfterReload: persisted, legacyCrudRows: contentRows };
}
