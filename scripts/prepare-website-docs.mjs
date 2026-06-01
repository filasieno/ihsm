#!/usr/bin/env node
/**
 * Materialize website/docs/ from docs-src + generators. Output is gitignored.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsSrc = path.join(repoRoot, 'website/docs-src');
const docsOut = path.join(repoRoot, 'website/docs');

function run(script) {
	const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', script)], {
		cwd: repoRoot,
		stdio: 'inherit',
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

if (!fs.existsSync(docsSrc)) {
	console.error('missing website/docs-src/');
	process.exit(1);
}

fs.rmSync(docsOut, { recursive: true, force: true });
fs.rmSync(path.join(repoRoot, 'website/static/img/plantuml'), { recursive: true, force: true });
fs.cpSync(docsSrc, docsOut, { recursive: true });
// Contributor README only — not a doc page
fs.rmSync(path.join(docsOut, 'README.md'), { force: true });

run('generate-reference-mdx.mjs');
run('generate-api-docs.mjs');

console.log('website/docs/ prepared (gitignored)');
