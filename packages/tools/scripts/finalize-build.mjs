#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

for (const [dir, type] of [
	[path.join(repoRoot, 'lib/cjs'), 'commonjs'],
	[path.join(repoRoot, 'lib/esm'), 'module'],
]) {
	if (!fs.existsSync(dir)) {
		throw new Error(`finalize-build: expected ${dir}`);
	}
	fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ type }, null, '\t')}\n`);
}

console.log('finalize-build: wrote lib/cjs/package.json, lib/esm/package.json');
