#!/usr/bin/env node
/**
 * Publish reference/REFERENCE.md on the Docusaurus site as docs/reference/index.mdx.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plantumlAssetDir, plantumlUrlPrefix, renderPlantumlInMarkdown } from './render-plantuml.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = path.join(repoRoot, 'reference/REFERENCE.md');
const outPath = path.join(repoRoot, 'website/docs/reference/index.mdx');

/** ### headings that are link targets in the manual. */
const subsectionIds = {
	'### Transition taxonomy': '{#transition-taxonomy}',
	'### Advanced: Protocol typing and compile-time safety': '{#advanced-protocol-typing-and-compile-time-safety}',
	'### `sync()`': '{#sync}',
	'### Rules of thumb': '{#rules-of-thumb}',
};

function slugifySection(title) {
	return title
		.toLowerCase()
		.replace(/`/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function transformMarkdown(body) {
	let text = body.replace(/^# ihsm Reference Manual\n+/, '');

	text = text.replace(
		/Hands-on walkthroughs: \[interactive tutorials\]\([^)]+\) · \[source index\]\(\.\.\/tutorials\/README\.md\)/,
		'Hands-on walkthroughs: [tutorials](/tutorials) · [source index](https://github.com/filasieno/ihsm/tree/master/tutorials/README.md)'
	);

	text = text.replace(/\]\(https:\/\/filasieno\.github\.io\/ihsm\/tutorials([^)]*)\)/g, '](/tutorials$1)');
	text = text.replace(/\]\(\.\.\/tutorials\/README\.md\)/g, '](/tutorials)');
	text = text.replace(/\]\(\.\.\/tutorials\/(\d{2}-[^/)]+)\/README\.md\)/g, '](/tutorials/$1)');
	text = text.replace(
		/\]\(\.\.\/tutorials\/05-hierarchy\/cases\/\)/g,
		'](https://github.com/filasieno/ihsm/tree/master/tutorials/05-hierarchy/cases/)'
	);
	text = text.replace(/\[reference\/tutorials\/\]\(\/reference\/tutorials\/\)/g, '[tutorials](/tutorials)');
	text = text.replace(/\(also under \[reference\/tutorials\/\]\(\/reference\/tutorials\/\) on the site\)/g, '(also on the [tutorials](/tutorials) index)');

	text = text.replace(/^## (\d+)\. (.+)$/gm, (_match, num, title) => {
		const slug = slugifySection(title);
		return `## ${num}. ${title} {#_${num}-${slug}}`;
	});

	for (const [heading, id] of Object.entries(subsectionIds)) {
		text = text.replace(new RegExp(`^${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'), `${heading} ${id}`);
	}

	text = text.replace(/tutorials\/_shared\//g, 'tutorials/shared/');

	text = renderPlantumlInMarkdown(text, {
		assetDir: plantumlAssetDir(repoRoot),
		urlPrefix: plantumlUrlPrefix,
		fileBase: 'reference',
	});

	return text.trimEnd() + '\n';
}

const source = fs.readFileSync(sourcePath, 'utf8');
const body = transformMarkdown(source);

const mdx = `---
sidebar_position: 2
title: Reference
slug: /reference
id: reference
---

${body}`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, mdx);
console.log(`wrote ${path.relative(repoRoot, outPath)}`);
