// Playwright driver for the c2pa-web spike. Starts a Vite dev server (which
// resolves c2pa-web's bare specifiers, worker URL, and WASM ?url), loads
// index.html in headless Chromium, collects the manifestStore shape for each
// fixture, asserts the spike contract, and exits non-zero on any mismatch.
import { spawn } from 'node:child_process';
import { chromium } from 'playwright';
import { resolve } from 'node:path';

const PORT = process.env.SPIKE_PORT || 4319;
const BASE = `http://127.0.0.1:${PORT}`;
const SPIKE_DIR = resolve('tools/spike-web');

async function waitForServer(host, port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://${host}:${port}/`);
      if (r.ok || r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

async function main() {
  const vite = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--port', String(PORT)], {
    cwd: SPIKE_DIR,
    env: { ...process.env, SPIKE_PORT: String(PORT) },
    stdio: ['ignore', 'inherit', 'inherit'],
  });
  const kill = () => {
    try {
      vite.kill('SIGTERM');
    } catch {}
  };

  try {
    const up = await waitForServer('127.0.0.1', PORT, 20000);
    if (!up) {
      console.error('Vite dev server did not become ready.');
      process.exitCode = 1;
      return;
    }

    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      const consoleLines = [];
      const pageErrors = [];
      const reqFailed = [];
      page.on('console', (m) => consoleLines.push(`[${m.type()}] ${m.text()}`));
      page.on('pageerror', (e) => pageErrors.push(String(e)));
      page.on('requestfailed', (r) => reqFailed.push(`${r.url()} -- ${r.failure()?.errorText}`));
      page.on('response', (r) => {
        if (r.status() >= 400) consoleLines.push(`[http ${r.status()}] ${r.url()}`);
      });

      await page.goto(BASE + '/', { waitUntil: 'load' });
      let done = false;
      try {
        await page.waitForFunction(() => window.__done === true, { timeout: 60000 });
        done = true;
      } catch {
        done = false;
      }

      console.log('\n--- browser console ---');
      console.log(consoleLines.join('\n') || '(no console output)');
      console.log('\n--- page errors ---');
      console.log(pageErrors.join('\n') || '(none)');
      console.log('\n--- failed requests ---');
      console.log(reqFailed.join('\n') || '(none)');
      if (!done) {
        console.error('\nwindow.__done never became true (script did not complete).');
        process.exitCode = 1;
        return;
      }

      const err = await page.evaluate(() => window.__error);
      if (err) {
        console.error('\npage error:', err);
        process.exitCode = 1;
        return;
      }
      const results = await page.evaluate(() => window.__results);

      console.log('\n===== c2pa-web manifestStore shape (real browser) =====');
      for (const r of results) {
        console.log(JSON.stringify(r, null, 2));
      }

      // ---- Spike contract (the load-bearing facts for the mapper) ----
      const byName = Object.fromEntries(results.map((r) => [r.name, r]));
      const codes = (r) => {
        if (!r || !r.validation_status) return [];
        return r.validation_status.map((v) => v && v.code).filter(Boolean);
      };
      const tamperedCodes = codes(byName['tampered.png']);
      const verifiedCodes = codes(byName['verified.png']);
      const verifiedAiCodes = codes(byName['verified-ai.png']);
      const aiLabels = byName['verified-ai.png']?.assertionLabels || [];
      const aiType = byName['verified-ai.png']?.aiDigitalSourceType || null;
      const unknownNull = byName['unknown.png']?.msIsNull;

      const checks = [
        {
          name: 'tampered surfaces assertion.dataHash.mismatch',
          pass: tamperedCodes.some((c) => c.includes('dataHash.mismatch')),
        },
        { name: 'verified has empty validation_status', pass: verifiedCodes.length === 0 },
        {
          name: 'verified has NO signingCredential.untrusted (trust anchor resolved)',
          pass: !verifiedCodes.some((c) => c.includes('signingCredential.untrusted')),
        },
        { name: 'verified-ai has empty validation_status', pass: verifiedAiCodes.length === 0 },
        {
          name: 'verified-ai carries an AI assertion (c2pa.ai.*)',
          pass: aiLabels.some((l) => l && l.startsWith('c2pa.ai')),
        },
        {
          name: 'verified-ai AI digitalSourceType is trainedAlgorithmicMedia',
          pass: aiType === 'trainedAlgorithmicMedia',
        },
        { name: 'unknown (unsigned) has null manifestStore', pass: unknownNull === true },
      ];

      console.log('\n===== spike contract =====');
      let failed = 0;
      for (const c of checks) {
        console.log(`  ${c.pass ? 'OK   ' : 'FAIL '} ${c.name}`);
        if (!c.pass) failed++;
      }
      if (failed > 0) {
        console.error(`\n${failed} spike check(s) FAILED — c2pa-web shape/semantics changed.`);
        process.exitCode = 1;
      } else {
        console.log('\nall spike checks passed.');
      }
    } finally {
      await browser.close();
    }
  } finally {
    kill();
  }
}

main().catch((e) => {
  console.error('spike driver failed:', e?.stack || e);
  process.exit(1);
});
