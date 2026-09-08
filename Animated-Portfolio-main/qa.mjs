export default async function run(page, ui) {
    const results = {};
    const name = page.locator('#name');
    const email = page.locator('#email');
    const subject = page.locator('#subject');
    const message = page.locator('#message');
    const send = page.locator('#contact-form button[type="submit"]');

    // Layout check: form on the left, social cards stacked on the right
    await page.locator('#contact').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1200);
    const main = await page.locator('.contact-main').boundingBox();
    const cards = await page.locator('.contact-social-cards').boundingBox();
    results.layout = {
        formLeftOfCards: main && cards ? main.x + main.width <= cards.x : false,
        sameRow: main && cards ? Math.abs((main.y + main.height / 2) - (cards.y + cards.height / 2)) < 200 : false,
        cardCount: await page.locator('.contact-social-cards .social-card').count(),
        stacked: cards ? cards.height > cards.width : false
    };

    // Empty form -> error toast
    await send.click();
    await page.waitForTimeout(600);
    results.emptyForm = await page.locator('#taloraToast').evaluate(el => ({ text: el.innerText, error: el.classList.contains('error') }));

    // Invalid email -> error toast
    await name.fill('Test User');
    await email.fill('hello');
    await subject.fill('New Project Inquiry');
    await message.fill('This is a test inquiry.');
    await send.click();
    await page.waitForTimeout(600);
    results.invalidEmail = await page.locator('#taloraToast').evaluate(el => ({ text: el.innerText, error: el.classList.contains('error') }));

    // Valid submit -> success toast, form resets (including subject)
    await email.fill('test@example.com');
    await send.click();
    await page.waitForFunction(() => document.querySelector('#taloraToast').classList.contains('visible'));
    results.validSubmit = await page.locator('#taloraToast').evaluate(el => ({ text: el.innerText, error: el.classList.contains('error') }));
    results.nameReset = await name.inputValue();
    results.subjectReset = await subject.inputValue();
    return results;
}
