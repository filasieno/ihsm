#!/usr/bin/env node
/**
 * Ensure generated website/docs exist before Docusaurus start/build.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsDir = path.join(pkgRoot, 'website/docs');
const marker = path.join(docsDir, 'intro.mdx');

if (fs.existsSync(marker)) {
	process.exit(0);
}

console.log('website/docs incomplete — running prepare-website-docs.mjs');
const result = spawnSync(process.execPath, [path.join(pkgRoot, 'scripts/prepare-website-docs.mjs')], {
	cwd: pkgRoot,
	stdio: 'inherit',
});
process.exit(result.status ?? 1);
