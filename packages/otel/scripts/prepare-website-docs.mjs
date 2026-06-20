#!/usr/bin/env node
/**
 * Materialize website/docs/ from docs-src/. Output is gitignored.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const pkgRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsSrc = path.join(pkgRoot, 'website/docs-src');
const docsOut = path.join(pkgRoot, 'website/docs');

/** @param {string} src @param {string} dest */
function copyDir(src, dest) {
	fs.mkdirSync(dest, { recursive: true });
	for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
		const from = path.join(src, ent.name);
		const to = path.join(dest, ent.name);
		if (ent.isDirectory()) {
			copyDir(from, to);
		} else {
			fs.copyFileSync(from, to);
		}
	}
}

if (!fs.existsSync(docsSrc)) {
	console.error('missing website/docs-src/');
	process.exit(1);
}

fs.rmSync(docsOut, { recursive: true, force: true });
copyDir(docsSrc, docsOut);
console.log('website/docs/ ← docs-src/');
