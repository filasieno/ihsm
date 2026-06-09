#!/usr/bin/env node
/**
 * Ensure generated website/docs exist before Docusaurus start/build.
 * Regenerates when API/reference/testing output is missing or PlantUML was left as code fences.
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
	path.join(docsDir, 'testing.mdx'),
	path.join(repoRoot, 'website/sidebars.ts'),
];

/** @returns {string[]} */
function unrenderedPlantumlPages() {
	const pages = ['reference.mdx', 'testing.mdx'];
	const stale = [];
	for (const name of pages) {
		const p = path.join(docsDir, name);
		if (fs.existsSync(p) && /```plantuml\n/.test(fs.readFileSync(p, 'utf8'))) {
			stale.push(name);
		}
	}
	return stale;
}

const missing = markers.filter(p => !fs.existsSync(p));
const stalePlantuml = unrenderedPlantumlPages();
if (missing.length === 0 && stalePlantuml.length === 0) {
	process.exit(0);
}

console.log('website/docs incomplete — running prepare-website-docs.mjs');
if (missing.length > 0) {
	console.log(`  missing: ${missing.map(p => path.relative(repoRoot, p)).join(', ')}`);
}
if (stalePlantuml.length > 0) {
	console.log(`  unrendered PlantUML: ${stalePlantuml.join(', ')}`);
}

const result = spawnSync(process.execPath, [path.join(repoRoot, 'scripts/prepare-website-docs.mjs')], {
	cwd: repoRoot,
	stdio: 'inherit',
});
process.exit(result.status ?? 1);
