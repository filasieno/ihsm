#!/usr/bin/env node
/**
 * Ensure generated website/docs exist before Docusaurus start/build.
 * Avoids webpack "Can't resolve @site/docs/api/…" after a failed or partial prepare.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(repoRoot, 'website/docs');
const markers = [
	path.join(docsDir, 'api/index.mdx'),
	path.join(docsDir, 'reference.mdx'),
	path.join(repoRoot, 'website/sidebars.ts'),
];

const missing = markers.filter(p => !fs.existsSync(p));
if (missing.length === 0) {
	process.exit(0);
}

console.log('website/docs incomplete — running prepare-website-docs.mjs');
console.log(`  missing: ${missing.map(p => path.relative(repoRoot, p)).join(', ')}`);

const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/prepare-website-docs.mjs')], {
	cwd: repoRoot,
	stdio: 'inherit',
});
process.exit(result.status ?? 1);
