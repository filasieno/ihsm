#!/usr/bin/env node
/**
 * Generate API reference MDX from TSDoc via TypeDoc → website/docs/api/ (gitignored).
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const typedocOut = path.join(repoRoot, '.typedoc-out');
const docsRoot = process.env.IHSM_DOCS_DIR
	? path.resolve(process.env.IHSM_DOCS_DIR)
	: path.join(repoRoot, 'website/docs');
const apiOut = path.join(docsRoot, 'api');
const typedocBin = path.join(repoRoot, 'node_modules/.bin/typedoc');

function runTypedoc() {
	const result = spawnSync(typedocBin, { cwd: repoRoot, stdio: 'inherit' });
	if (result.status !== 0) {
		process.exit(result.status ?? 1);
	}
}

function titleFromPath(relativePath) {
	const base = path.basename(relativePath, '.mdx');
	if (base === 'index') return 'API Reference';
	return base;
}

function frontmatterFor(relativePath) {
	const title = titleFromPath(relativePath);
	if (relativePath === 'index.mdx') {
		return `---
title: API Reference
slug: /api
id: api
sidebar_position: 3
---

# API Reference

Auto-generated from TSDoc comments in [\`src/index.ts\`](https://github.com/filasieno/ihsm/tree/master/src/index.ts).
For concepts, semantics, and usage patterns see the [Reference](/reference).

`;
	}
	return `---
title: ${title}
---

`;
}

function copyWithFrontmatter(srcDir, destDir, relativeDir = '') {
	for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
		const srcPath = path.join(srcDir, entry.name);
		const relPath = path.join(relativeDir, entry.name);
		const destPath = path.join(destDir, entry.name);

		if (entry.isDirectory()) {
			fs.mkdirSync(destPath, { recursive: true });
			copyWithFrontmatter(srcPath, destPath, relPath);
			continue;
		}

		if (!entry.name.endsWith('.mdx')) continue;

		const body = fs.readFileSync(srcPath, 'utf8').trimStart();
		const content = frontmatterFor(relPath.replace(/\\/g, '/')) + body + '\n';
		fs.writeFileSync(destPath, content);
	}
}

fs.rmSync(apiOut, { recursive: true, force: true });
fs.mkdirSync(apiOut, { recursive: true });

runTypedoc();

if (!fs.existsSync(path.join(typedocOut, 'index.mdx'))) {
	console.error('TypeDoc did not produce index.mdx');
	process.exit(1);
}

copyWithFrontmatter(typedocOut, apiOut);
console.log(`wrote ${path.relative(repoRoot, apiOut)}/`);
