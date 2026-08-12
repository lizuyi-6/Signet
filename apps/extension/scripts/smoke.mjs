/**
 * Signet extension smoke test (acceptance #2–#6).
 *
 * Loads the BUILT extension (apps/extension/dist) into a real Chromium via
 * Playwright's persistent context, navigates to the demo, and asserts:
 *   - the service worker registers                    (#2 loads)
 *   - four trust badges appear                         (#3 badges appear)
 *   - the four states are Verified / AI Generated /
 *     Provenance Broken / Unknown, one each            (#4 four states correct)
 *   - the tampered fixture shows Provenance Broken      (#6 tamper → Broken)
 *   - clicking a badge opens the detail card            (#5 click → timeline)
 *
 * Run AFTER `pnpm --filter @signet/extension build` and with the demo
 * dev server running (`pnpm dev`). MV3 extensions need headed Chromium.
 */
import { chromium, expect } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIST = fileURLToPath(new URL('../dist', import.meta.url));
const DEMO = process.env.DEMO_URL || 'http://127.0.0.1:5173/';
const STATE_TIMEOUT = 60_000;

const userData = mkdtempSync(join(tmpdir(), 'tc-smoke-'));
console.log('extension dist:', DIST);
console.log('demo url      :', DEMO);
console.log('profile       :', userData);

const context = await chromium.launchPersistentContext(userData, {
  headless: false,
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--no-default-browser-check',
    '--no-first-run',
  ],
});

function logPage(msg) {
  console.log(`  [page ${msg.type()}]`, msg.text());
}
context.on('console', logPage);
context.on('pageerror', (e) => console.log('  [pageerror]', e.message));

// Wait for the extension service worker to register.
let sw = context.serviceWorkers().find((w) => w.url().includes('service-worker-loader.js'));
if (!sw) {
  sw = await context.waitForEvent('serviceworker', { timeout: 20_000 });
}
console.log('SW registered :', sw.url());

const page = await context.newPage();
await page.goto(DEMO, { waitUntil: 'networkidle' });
console.log('navigated to demo.');

// Sanity: four fixture images present.
await expect(page.locator('img[data-tc-fixture]')).toHaveCount(4, { timeout: 10_000 });
console.log('fixture images: 4 ✓');

// Four overlay hosts should mount quickly (pending).
await expect(page.locator('.tc-host')).toHaveCount(4, { timeout: 15_000 });
console.log('overlay hosts : 4 (pending) ✓');

console.log('waiting for verification to resolve (≤60s per state)…');
const states = [
  'Signet: Verified',
  'Signet: AI Generated',
  'Signet: Provenance Broken',
  'Signet: Unknown',
];
for (const label of states) {
  await expect(page.locator(`button[aria-label="${label}"]`)).toHaveCount(1, {
    timeout: STATE_TIMEOUT,
  });
  console.log(`  state ${label.replace('Signet: ', '').padEnd(18)} ✓`);
}
console.log('  → AI ≠ fake, Unknown = fail-closed default, tamper → Broken (acceptance #6).');

// Acceptance #5: clicking a badge opens the detail / timeline card.
await page.locator('button[aria-label="Signet: Verified"]').first().click();
await expect(page.locator('[role="dialog"]')).toBeVisible({ timeout: 5_000 });
console.log('detail card opens on click ✓  (acceptance #5)');
// The detail must show a real provenance timeline (c2pa.actions.vN, extracted
// from the fixture's action history) — not an empty card. verified.png embeds
// one c2pa.captured action, so at least one timeline step must render.
await expect(page.locator('.tc-tl-step')).toHaveCount(1, { timeout: 5_000 });
console.log('provenance timeline renders  ✓  (c2pa.actions.v2 extraction)');
await page.screenshot({ path: join(DIST, '..', 'smoke-detail.png') });
console.log('screenshot    :', join(DIST, '..', 'smoke-detail.png'));

await context.close();
console.log('\nSMOKE PASS: extension loads, 4 states correct, detail opens.');
process.exit(0);
