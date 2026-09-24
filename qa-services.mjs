// Task 6 UI E2E: CMS services CRUD + public website dynamic rendering
export default async function run(page, ui) {
  const out = {};

  // ---------- 1. Public site: services section exists ----------
  await page.goto('http://localhost:5501/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const publicText = await page.locator('#servicesGrid').textContent();
  out.publicSection = publicText.trim().slice(0, 80);

  // ---------- 2. CMS: create a service via the UI ----------
  await page.goto('http://localhost:5501/cms.html', { waitUntil: 'domcontentloaded' });
  if (await page.locator('#loginUsername').isVisible().catch(() => false)) {
    await page.fill('#loginUsername', 'admin');
    await page.fill('#loginPassword', 'talora-admin');
    await page.click('#loginBtn');
  }
  await page.waitForSelector('#serviceTableWrap:not(.hidden), #serviceEmptyState:not(.hidden)', { timeout: 10000 });
  await page.click('#svcAddBtn');
  await page.waitForSelector('#serviceModalOverlay:not(.hidden)');
  await page.fill('#sfTitle', 'QA Browser Service');
  await page.fill('#sfDescription', 'Created through the CMS UI by the Task 6 browser test.');
  await page.fill('#sfIcon', 'bx-rocket');
  await page.selectOption('#sfStatus', 'active');
  await page.click('#serviceSaveBtn');
  await page.waitForSelector('#serviceTableWrap:not(.hidden)', { timeout: 10000 });
  out.createdInCms = await page.locator('.cell-title', { hasText: 'QA Browser Service' }).count() > 0;
  out.successAlert = (await page.locator('#serviceAlertBox').textContent()).trim();

  // validation: try to save with empty title
  await page.click('#svcAddBtn');
  await page.waitForSelector('#serviceModalOverlay:not(.hidden)');
  await page.click('#serviceSaveBtn');
  out.titleValidationError = (await page.locator('#seTitle').textContent()).trim();
  await page.click('#serviceCancelBtn');

  // ---------- 3. Public site now shows it (no reload of CMS data, fresh fetch) ----------
  await page.goto('http://localhost:5501/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.service-card', { timeout: 10000 });
  out.publicShowsCreated = await page.locator('.service-card', { hasText: 'QA Browser Service' }).count() > 0;

  // ---------- 4. Edit via CMS, verify public reflects it ----------
  await page.goto('http://localhost:5501/cms.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#serviceTableWrap:not(.hidden)', { timeout: 10000 });
  await page.locator('[data-service-id]').first().locator('.action-btn.edit').click();
  await page.waitForSelector('#serviceModalOverlay:not(.hidden)');
  await page.waitForFunction(() => document.getElementById('sfTitle').value.includes('QA Browser'), { timeout: 5000 });
  await page.fill('#sfTitle', 'QA Browser Service (updated)');
  await page.click('#serviceSaveBtn');
  await page.waitForTimeout(800);
  out.editedInCms = await page.locator('.cell-title', { hasText: '(updated)' }).count() > 0;

  await page.goto('http://localhost:5501/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.service-card', { timeout: 10000 });
  out.publicShowsUpdate = await page.locator('.service-card', { hasText: '(updated)' }).count() > 0;

  // ---------- 5. Delete with confirmation, verify public no longer shows it ----------
  await page.goto('http://localhost:5501/cms.html', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#serviceTableWrap:not(.hidden)', { timeout: 10000 });
  await page.locator('[data-service-id]').first().locator('.action-btn.delete').click();
  await page.waitForSelector('#serviceDeleteOverlay:not(.hidden)');
  out.confirmText = (await page.locator('#serviceDeleteOverlay .delete-text').textContent()).trim();
  await page.click('#serviceDeleteConfirm');
  await page.waitForTimeout(800);
  out.deletedFromCms = await page.locator('.cell-title', { hasText: 'QA Browser Service' }).count() === 0;

  await page.goto('http://localhost:5501/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(1500);
  const afterDelete = await page.locator('#servicesGrid').textContent();
  out.publicAfterDelete = afterDelete.includes('QA Browser Service') ? 'STILL SHOWN (FAIL)' : 'gone';
  out.publicStateAfterDelete = afterDelete.trim().slice(0, 80);

  return out;
}
