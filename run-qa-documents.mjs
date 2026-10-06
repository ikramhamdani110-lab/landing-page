// Task 10 — browser QA: full documents upload flow with Playwright.
// Prereq: node serve.js running.  Run:  node run-qa-documents.mjs
import { chromium } from 'playwright';

const results = {};
const browser = await chromium.launch();
const page = await browser.newPage();
try {
  await page.goto('http://localhost:5501/register.html');
  const email = 'doc-qa-' + Date.now() + '@talora-test.dev';
  await page.fill('#regName', 'Doc QA User');
  await page.fill('#regEmail', email);
  await page.fill('#regPass', 'Str0ngPassw0rd!');
  await page.fill('#regPass2', 'Str0ngPassw0rd!');
  await page.click('#registerBtn');
  await page.waitForURL('**/login.html', { timeout: 15000 });
  await page.fill('#loginEmail', email);
  await page.fill('#loginPass', 'Str0ngPassw0rd!');
  await page.click('#loginBtn');
  await page.waitForURL('**/dashboard.html', { timeout: 15000 });
  await page.waitForTimeout(1500);
  var state = await page.evaluate(async function () {
    var el = document.getElementById('dashContent');
    var guest = document.getElementById('dashGuest');
    var status = null;
    try {
      var r = await fetch('/api/user/profile', { headers: { Authorization: 'Bearer ' + sessionStorage.getItem('talora_user_token') } });
      status = r.status;
    } catch (_) { status = 'fetch-failed'; }
    return {
      contentHidden: el ? el.classList.contains('hidden') : 'NOEL',
      guestHidden: guest ? guest.classList.contains('hidden') : 'NOEL',
      profileStatus: status
    };
  });
  console.log('dashboard state:', JSON.stringify(state));

  // Open the Documents panel
  await page.click('.dash-nav-item[data-nav="documents"]');
  await page.waitForSelector('#panel-documents:not(.hidden)');
  await page.waitForFunction(() => !document.getElementById('docEmpty').classList.contains('hidden'));
  results.emptyState = true;

  // Real file selection + upload (multipart through the real backend)
  const fs = await import('node:fs');
  fs.writeFileSync('qa-doc.pdf', '%PDF-1.4\n%browser-qa\n%%EOF\n', 'utf8');
  await page.setInputFiles('#docFile', 'qa-doc.pdf');
  results.selectedShown = await page.textContent('#docSelectedName');
  await page.click('#docUploadBtn');
  await page.waitForSelector('#docListWrap:not(.hidden)');
  results.uploadedDoc = await page.textContent('.doc-item .doc-name');

  // Invalid type rejected in the UI before upload
  fs.writeFileSync('qa-bad.exe', 'MZ', 'utf8');
  await page.setInputFiles('#docFile', 'qa-bad.exe');
  results.invalidMsg = await page.textContent('#docMessage');
  fs.unlinkSync('qa-bad.exe');

  // Delete and confirm it disappears
  await page.setInputFiles('#docFile', 'qa-doc.pdf');
  await page.click('#docUploadBtn');
  await page.waitForFunction(() => document.querySelectorAll('.doc-item').length === 2);
  await page.click('.doc-item .doc-delete');
  await page.waitForFunction(() => document.querySelectorAll('.doc-item').length === 1);
  results.deletedOne = true;

  fs.unlinkSync('qa-doc.pdf');
  console.log('PASS', JSON.stringify(results, null, 2));
} catch (e) {
  console.log('FAIL', results, e.message);
  process.exitCode = 1;
} finally {
  await browser.close();
}
