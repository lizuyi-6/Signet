// Phase H: Playwright acceptance check for the demo Intelligence Report page.
// Loads /report.html, asserts the in-browser self-check renders ALL PASS and
// all four asset cards render. Usage: node apps/extension/scripts/report-check.mjs
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

// Screenshot output is anchored to this script's location, not a machine-specific
// absolute path (Phase J5): resolves to <repo>/apps/demo/report-smoke.png.
const SCREENSHOT = fileURLToPath(new URL('../../demo/report-smoke.png', import.meta.url));
const browser = await chromium.launch();
const page = await browser.newPage();
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto('http://127.0.0.1:5173/report.html', { waitUntil: 'networkidle' });
const text = await page.locator('body').innerText();
const allPass = text.includes('ALL PASS');
const someFail = text.includes('SOME FAIL');
const cards = await page.locator('article.card').count();
console.log('report cards:', cards);
console.log('ALL PASS present:', allPass, '| SOME FAIL present:', someFail);
console.log(await page.locator('.checks').innerText());
await page.screenshot({ path: SCREENSHOT });
await browser.close();
process.exit(allPass && !someFail && cards === 4 ? 0 : 1);
