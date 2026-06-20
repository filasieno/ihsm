#!/usr/bin/env node
/**
 * Pack built ihsm into ihsm-dev.tgz for local dev/test.
 * Avoids `file:../ihsm`, which would install ihsm's full dev tree (Docusaurus, Playwright, …).
 */
import { execSync } from 'node:child_process';
import { existsSync, readdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ihsmRoot = join(root, '..', 'ihsm');
const libMain = join(ihsmRoot, 'lib', 'cjs', 'index.js');
const tgz = join(root, 'ihsm-dev.tgz');

if (!existsSync(libMain)) {
	console.error('ihsm lib missing — build ihsm first: cd packages/ihsm && npm run build');
	console.error('  or from repo root: nix build .#ihsm');
	process.exit(1);
}

const libMtime = statSync(libMain).mtimeMs;
const tgzMtime = existsSync(tgz) ? statSync(tgz).mtimeMs : 0;
if (tgzMtime >= libMtime) {
	process.exit(0);
}

if (existsSync(tgz)) unlinkSync(tgz);
execSync(`npm pack "${ihsmRoot}" --pack-destination "${root}"`, { stdio: 'inherit', cwd: root });
const packed = readdirSync(root).find(f => /^ihsm-.*\.tgz$/.test(f));
if (packed === undefined) {
	console.error('npm pack did not produce ihsm-*.tgz');
	process.exit(1);
}
renameSync(join(root, packed), tgz);
