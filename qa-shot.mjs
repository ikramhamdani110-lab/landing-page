// Login and wait for the table to render (data already in DB from seeding)
export default async function run(page, ui) {
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', 'talora-admin');
  await page.click('#loginBtn');
  await page.waitForSelector('#cmsView:not(.hidden)', { timeout: 5000 });
  await page.waitForSelector('#tableBody tr', { timeout: 5000 });
  return { rows: await page.locator('#tableBody tr').count() };
}
