#!/usr/bin/env node
/**
 * Finalize the dual library build:
 *   1. Write per-format package.json markers so Node loads each tree with the
 *      correct module system (lib/cjs → commonjs, lib/esm → module).
 *   2. Rewrite relative import/export specifiers in the ESM output to include
 *      explicit `.js` extensions, so the build is genuine, Node-loadable ESM
 *      (the source tree stays extensionless for ts-node).
 *
 * No runtime dependencies; pure Node stdlib. Mirrors packages/ihsm/scripts/finalize-build.mjs.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const cjsDir = path.join(repoRoot, 'lib/cjs');
const esmDir = path.join(repoRoot, 'lib/esm');

function writeMarker(dir, type) {
	if (!fs.existsSync(dir)) {
		throw new Error(`finalize-build: expected build output at ${dir} (run tsc first)`);
	}
	fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ type }, null, '\t') + '\n');
}

function walk(dir) {
	const out = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) out.push(...walk(full));
		else out.push(full);
	}
	return out;
}

function resolveSpecifier(spec, fileDir) {
	if (!spec.startsWith('.')) return spec;
	if (/\.(js|mjs|cjs|json)$/.test(spec)) return spec;
	if (fs.existsSync(path.resolve(fileDir, spec + '.js'))) return spec + '.js';
	if (fs.existsSync(path.resolve(fileDir, spec, 'index.js'))) {
		return spec.endsWith('/') ? spec + 'index.js' : spec + '/index.js';
	}
	return spec;
}

const SPECIFIER = /(\bfrom\s*|\bimport\s*\(\s*|\bexport\s+\*\s+from\s*|\brequire\s*\(\s*)(['"])(\.[^'"]*)\2/g;

function fixEsmExtensions(dir) {
	let changed = 0;
	for (const file of walk(dir)) {
		if (!/\.(js|d\.ts)$/.test(file)) continue;
		const fileDir = path.dirname(file);
		const original = fs.readFileSync(file, 'utf8');
		const updated = original.replace(SPECIFIER, (match, head, quote, spec) => {
			const fixed = resolveSpecifier(spec, fileDir);
			return fixed === spec ? match : `${head}${quote}${fixed}${quote}`;
		});
		if (updated !== original) {
			fs.writeFileSync(file, updated);
			changed += 1;
		}
	}
	return changed;
}

writeMarker(cjsDir, 'commonjs');
writeMarker(esmDir, 'module');
const fixed = fixEsmExtensions(esmDir);
console.log(`finalize-build: wrote lib/cjs/package.json, lib/esm/package.json; rewrote ${fixed} ESM file(s) with explicit extensions.`);
