export default async function run(page, ui) {
    await page.locator('#contact').scrollIntoViewIfNeeded();
    await page.waitForTimeout(1500);
    const box = await page.locator('.contact-container').boundingBox();
    const main = await page.locator('.contact-main').boundingBox();
    const cards = await page.locator('.contact-social-cards').boundingBox();
    await page.screenshot({ path: 'c:\\Users\\pc\\Desktop\\Animated\\contact-section.png' });
    return { container: box, main, cards,
        sideBySide: main && cards ? Math.abs((main.y + main.height / 2) - (cards.y + cards.height / 2)) < 200 : false };
}
