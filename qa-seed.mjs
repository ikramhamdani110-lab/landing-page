// Seed sample content, then screenshot the logged-in CMS dashboard
export default async function run(page, ui) {
  // login via UI
  await page.fill('#loginUsername', 'admin');
  await page.fill('#loginPassword', 'talora-admin');
  await page.click('#loginBtn');
  await page.waitForSelector('#cmsView:not(.hidden)', { timeout: 5000 });

  // seed via the page's own fetch (same-origin, token from sessionStorage)
  const seeded = await page.evaluate(async () => {
    const token = sessionStorage.getItem('talora_admin_token');
    const rows = [
      ['Spring 2026 cohort update', 'Weekly update on the new talent cohort and onboarding pipeline.', 'Update', 'published'],
      ['Client portal v2 rollout', 'Second phase of the client portal shipped to production this week.', 'Project', 'draft'],
      ['ISO 27001 certification completed', 'Security certification audit passed with zero critical findings.', 'Certification', 'published']
    ];
    let n = 0;
    for (const [title, description, category, status] of rows) {
      const r = await fetch('/api/content', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ title, description, category, status })
      });
      if (r.ok) n++;
    }
    return n;
  });
  await page.waitForTimeout(800); // let the table re-render
  const rows = await page.locator('#tableBody tr').count();
  return { seeded, rows };
}
