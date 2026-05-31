#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, '.test-browser');

const suiteArg = process.argv.indexOf('--suite');
const suites =
	suiteArg >= 0 ? [process.argv[suiteArg + 1]] : ['unit', 'tutorials'];

const build = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/build-browser-tests.mjs')], {
	cwd: repoRoot,
	stdio: 'inherit',
});
if (build.status !== 0) {
	process.exit(build.status ?? 1);
}

// Honor an explicit Chromium path (e.g. the Nix sandbox sets
// PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH so we use the pinned system browser
// instead of Playwright's separately-downloaded headless shell).
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined;
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
let failed = false;

try {
	for (const suite of suites) {
		const htmlPath = path.join(outDir, `${suite}.html`);
		const page = await browser.newPage();
		page.on('console', msg => {
			const text = msg.text();
			if (text.trim()) {
				console.log(`[browser:${suite}] ${text}`);
			}
		});
		page.on('pageerror', err => console.error(`[browser:${suite}]`, err));

		await page.goto(`file://${htmlPath}`);
		await page.waitForFunction(() => globalThis.__TEST_DONE__ !== undefined, null, { timeout: 120_000 });
		const result = await page.evaluate(() => globalThis.__TEST_DONE__);
		await page.close();

		if (!result || result.failures > 0) {
			console.error(`browser suite "${suite}" failed (${result?.failures ?? 'unknown'} failures)`);
			failed = true;
		} else {
			console.log(`browser suite "${suite}" passed`);
		}
	}
} finally {
	await browser.close();
}

process.exit(failed ? 1 : 0);
