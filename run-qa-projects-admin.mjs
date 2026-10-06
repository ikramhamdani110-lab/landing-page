import { chromium } from 'playwright';
// Task 11 browser QA — admin project management flow.
// The dashboard's admin controls key off the user profile role; to exercise them in a
// browser we promote a freshly registered user to ADMIN via the existing Task 9 API,
// then log in through the UI and run the full flow.
const browser = await chromium.launch();
const page = await browser.newPage();
const results = {};
try {
  // Register a user via API (page must be open for same-origin fetch)
  await page.goto('http://localhost:5501/register.html');
  const email = 'admqa-' + Date.now().toString(36) + '@talora.dev';
  const reg = await page.evaluate(async (em) => {
    const r = await fetch('/api/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName: 'Admin QA', email: em, password: 'Str0ngPassw0rd!', confirmPassword: 'Str0ngPassw0rd!' }) });
    return r.status;
  }, email);
  results.register = reg;

  // Log in through the UI
  await page.goto('http://localhost:5501/login.html');
  await page.fill('#loginEmail', email);
  await page.fill('#loginPass', 'Str0ngPassw0rd!');
  await page.click('#loginBtn');
  await page.waitForTimeout(2000);
  const userId = await page.evaluate(async () => {
    const r = await fetch('/api/user/profile', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('talora_user_token') } });
    return (await r.json()).user.id;
  });

  // Promote to ADMIN via the Task 9 endpoint (admin session)
  const adminLogin = await page.evaluate(async () => {
    const r = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'talora-admin' }) });
    return (await r.json()).token;
  });
  const promoted = await page.evaluate(async ({ tok, uid }) => {
    const r = await fetch('/api/admin/users/' + uid, { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify({ role: 'ADMIN' }) });
    return r.status;
  }, { tok: adminLogin, uid: userId });
  results.promotedToAdmin = promoted;

  // Fresh login to pick up the new role
  await page.evaluate(() => sessionStorage.removeItem('talora_user_token'));
  await page.goto('http://localhost:5501/login.html');
  await page.fill('#loginEmail', email);
  await page.fill('#loginPass', 'Str0ngPassw0rd!');
  await page.click('#loginBtn');
  await page.waitForTimeout(2000);

  // Open Projects
  await page.click('.dash-nav-item[data-nav="projects"]');
  await page.waitForTimeout(1200);
  results.adminSeesCreate = await page.evaluate(() => !document.getElementById('projCreateBtn').classList.contains('hidden'));

  // Create a client first
  await page.click('#projClientsBtn');
  await page.waitForTimeout(800);
  await page.fill('#clientFormName', 'Browser QA Client');
  await page.click('#clientFormSave');
  await page.waitForTimeout(800);
  results.clientCreated = await page.evaluate(() => document.querySelectorAll('.client-row').length > 0);

  // Close clients modal, create a project
  await page.click('#clientsModalClose');
  await page.click('#projCreateBtn');
  await page.waitForTimeout(500);
  await page.fill('#projName', 'Browser QA Website');
  await page.selectOption('#projClient', { index: 1 });
  await page.selectOption('#projStatus', 'IN_PROGRESS');
  // Check the first team member checkbox if available
  const hasTeam = await page.evaluate(() => document.querySelectorAll('#projTeamBoxes input[type=checkbox]').length);
  if (hasTeam) await page.check('#projTeamBoxes input[type=checkbox]');
  await page.click('#projSaveBtn');
  await page.waitForTimeout(1500);
  results.projectCardShown = await page.evaluate(() => document.querySelectorAll('.proj-item').length > 0);
  results.projectName = await page.evaluate(() => (document.querySelector('.proj-name') || {}).textContent || null);

  // Edit: change status via the edit form
  await page.click('.proj-item .proj-edit');
  await page.waitForTimeout(500);
  await page.selectOption('#projStatus', 'COMPLETED');
  await page.click('#projSaveBtn');
  await page.waitForTimeout(1500);
  results.statusAfterEdit = await page.evaluate(() => (document.querySelector('.proj-status-chip') || {}).textContent || null);

  // Delete the project
  page.on('dialog', d => d.accept());
  await page.click('.proj-item .proj-delete');
  await page.waitForTimeout(2500);
  results.afterDeleteEmpty = await page.evaluate(() => !document.getElementById('projEmpty').classList.contains('hidden'));
  results.cardsLeft = await page.evaluate(() => document.querySelectorAll('.proj-item').length);

  console.log('PASS', JSON.stringify(results, null, 1));
} catch (e) {
  console.log('FAIL', JSON.stringify(results), e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
