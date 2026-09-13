// Full UI CRUD lifecycle test for the TALORA CMS
export default async function run(page, ui) {
  const out = {};
  // 1. login
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', 'talora-admin');
  await page.click('#loginBtn');
  await page.waitForSelector('#cmsView:not(.hidden)', { timeout: 5000 });
  out.loggedIn = true;
  await page.waitForSelector('#emptyState:not(.hidden), #tableWrap:not(.hidden)', { timeout: 5000 });
  out.emptyStateShown = await page.locator('#emptyState').isVisible();

  // 2. add content
  await page.click('#addBtn');
  await page.waitForSelector('#modalOverlay:not(.hidden)');
  await page.fill('#fTitle', 'UI Test Content');
  await page.fill('#fDescription', 'Created through the CMS user interface.');
  await page.selectOption('#fCategory', 'Project');
  await page.selectOption('#fStatus', 'published');
  await page.click('#saveBtn');
  await page.waitForSelector('#tableWrap:not(.hidden)', { timeout: 5000 });
  out.rowAfterCreate = await page.locator('#tableBody tr').count();
  out.createdVisible = await page.locator('.cell-title', { hasText: 'UI Test Content' }).count() > 0;
  out.successAlert = await page.locator('#alertBox').textContent();

  // 3. reload — persistence check
  await page.reload();
  await page.waitForSelector('#tableWrap:not(.hidden)', { timeout: 5000 });
  out.persistedAfterReload = await page.locator('.cell-title', { hasText: 'UI Test Content' }).count() > 0;

  // 4. edit
  const editBtn = page.locator('#tableBody tr').first().locator('.action-btn.edit');
  await editBtn.click();
  await page.waitForSelector('#modalOverlay:not(.hidden)');
  await page.waitForFunction(() => document.getElementById('fTitle').value.includes('UI Test'), { timeout: 5000 });
  out.editFormLoaded = true;
  await page.fill('#fTitle', 'UI Test Content (edited)');
  await page.click('#saveBtn');
  await page.waitForSelector('#tableWrap:not(.hidden)', { timeout: 5000 });
  out.editedVisible = await page.locator('.cell-title', { hasText: '(edited)' }).count() > 0;

  // 5. delete with confirmation
  await page.locator('#tableBody tr').first().locator('.action-btn.delete').click();
  await page.waitForSelector('#deleteOverlay:not(.hidden)');
  out.confirmText = await page.locator('.delete-text').textContent();
  await page.click('#deleteConfirm');
  await page.waitForSelector('#emptyState:not(.hidden), #tableWrap:not(.hidden)', { timeout: 5000 });
  await page.waitForTimeout(400);
  out.deletedGone = await page.locator('.cell-title', { hasText: 'UI Test Content' }).count() === 0;

  // 6. reload — deletion persisted
  await page.reload();
  await page.waitForSelector('#emptyState:not(.hidden), #tableWrap:not(.hidden)', { timeout: 5000 });
  out.stillGoneAfterReload = await page.locator('.cell-title', { hasText: 'UI Test Content' }).count() === 0;
  return out;
}
