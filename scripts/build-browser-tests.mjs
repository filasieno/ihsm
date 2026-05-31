#!/usr/bin/env node
import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repoRoot, '.test-browser');

spawnSync(process.execPath, [path.join(repoRoot, 'scripts/generate-browser-test-entries.mjs')], {
	cwd: repoRoot,
	stdio: 'inherit',
});

fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

const shared = {
	bundle: true,
	minify: true,
	keepNames: false,
	// The specs use a bare `import 'mocha'`; real mocha is loaded from the HTML
	// shell, so esbuild correctly drops these side-effect-only imports. Silence
	// just that (expected) warning instead of disabling tree-shaking annotations.
	logOverride: { 'ignored-bare-import': 'silent' },
	format: 'iife',
	platform: 'browser',
	target: 'es2022',
	sourcemap: 'inline',
	logLevel: 'info',
	alias: {
		mocha: path.join(repoRoot, 'test/browser/mocha-stub.ts'),
	},
	tsconfigRaw: {
		compilerOptions: {
			experimentalDecorators: true,
			useDefineForClassFields: false,
			target: 'ES2022',
		},
	},
};

function htmlShell(suite) {
	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>ihsm ${suite} tests (minified browser)</title>
  <link rel="stylesheet" href="mocha.css" />
</head>
<body>
  <div id="mocha"></div>
  <script src="mocha.js"></script>
  <script>
    mocha.setup({ ui: 'bdd', timeout: 10000 });
  </script>
  <script src="${suite}.bundle.js"></script>
  <script>
    mocha.run(function (failures) {
      globalThis.__TEST_DONE__ = { failures: failures, status: failures === 0 ? 'pass' : 'fail' };
    });
  </script>
</body>
</html>
`;
}

// Vendor mocha's browser assets locally so the suite runs fully offline
// (the Nix sandbox has no network; loading mocha from a CDN would fail).
const mochaDir = path.dirname(fileURLToPath(import.meta.resolve('mocha/package.json')));
for (const asset of ['mocha.js', 'mocha.css']) {
	fs.copyFileSync(path.join(mochaDir, asset), path.join(outDir, asset));
}

for (const suite of ['unit', 'tutorials']) {
	await esbuild.build({
		...shared,
		entryPoints: [path.join(repoRoot, 'test/browser/entries', `${suite}.ts`)],
		outfile: path.join(outDir, `${suite}.bundle.js`),
	});
	fs.writeFileSync(path.join(outDir, `${suite}.html`), htmlShell(suite));
}

console.log(`browser test bundles written to ${path.relative(repoRoot, outDir)}/`);
