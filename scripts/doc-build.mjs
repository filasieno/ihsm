#!/usr/bin/env node
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const apiOut = join(root, '.typedoc-out/api');
const publicApi = join(root, 'docs/public/api');
const distApi = join(root, 'docs/.vitepress/dist/api');

execSync('node scripts/build-docs-site.mjs', { cwd: root, stdio: 'inherit' });

if (existsSync(apiOut)) {
	rmSync(publicApi, { recursive: true, force: true });
	mkdirSync(publicApi, { recursive: true });
	cpSync(apiOut, publicApi, { recursive: true });
}

execSync('npx vitepress build docs', { cwd: root, stdio: 'inherit' });

if (existsSync(apiOut)) {
	cpSync(apiOut, distApi, { recursive: true });
	console.log('→ copied TypeDoc API to site dist');
}
