#!/usr/bin/env node
/**
 * Materialize website/docs/ from docs-src + generators. Output is gitignored.
 * Builds into .docs-staging first so a failed step never leaves docs/ empty.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsSrc = path.join(repoRoot, 'website/docs-src');
const docsOut = path.join(repoRoot, 'website/docs');
const staging = path.join(repoRoot, 'website/.docs-staging');
const docusaurusCache = path.join(repoRoot, 'website/.docusaurus');

function run(script) {
	const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts', script)], {
		cwd: repoRoot,
		stdio: 'inherit',
		env: { ...process.env, IHSM_DOCS_DIR: staging },
	});
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function assertPrepared() {
	for (const rel of ['api/index.mdx', 'reference.mdx', 'testing.mdx', 'intro.mdx']) {
		const p = path.join(staging, rel);
		if (!fs.existsSync(p)) {
			console.error(`prepare incomplete: missing ${rel}`);
			process.exit(1);
		}
	}
}

if (!fs.existsSync(docsSrc)) {
	console.error('missing website/docs-src/');
	process.exit(1);
}

fs.rmSync(staging, { recursive: true, force: true });
fs.rmSync(path.join(repoRoot, 'website/static/img/plantuml'), { recursive: true, force: true });
fs.mkdirSync(staging, { recursive: true });
fs.cpSync(docsSrc, staging, { recursive: true });
fs.rmSync(path.join(staging, 'README.md'), { force: true });

// API first so a reference/plantuml failure still leaves api/ in staging (not swapped).
run('generate-api-docs.mjs');
run('generate-reference-mdx.mjs');

assertPrepared();

fs.rmSync(docsOut, { recursive: true, force: true });
fs.renameSync(staging, docsOut);
fs.rmSync(docusaurusCache, { recursive: true, force: true });

console.log('website/docs/ prepared (gitignored); cleared website/.docusaurus');
