#!/usr/bin/env node
/**
 * Embodiments + Glossary pages from reference/*.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareMarkdownBody } from './doc-transforms.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const docsOut = process.env.IHSM_DOCS_DIR ? path.resolve(process.env.IHSM_DOCS_DIR) : path.join(repoRoot, 'website/docs');

const pages = [
	{
		slug: 'embodiments',
		id: 'embodiments',
		title: 'Embodiments & facets',
		sidebar_position: 3,
		source: 'reference/EMBODIMENTS.md',
		description: 'Faceted actor API: notify, notifyNow, call, and embodiment matrix.',
	},
	{
		slug: 'glossary',
		id: 'glossary',
		title: 'Glossary',
		sidebar_position: 6,
		source: 'reference/GLOSSARY.md',
		description: 'Terms used across the ihsm reference and API docs.',
	},
];

	for (const page of pages) {
	const sourcePath = path.join(repoRoot, page.source);
	if (!fs.existsSync(sourcePath)) {
		console.error(`missing ${page.source}`);
		process.exit(1);
	}
	const body = prepareMarkdownBody(fs.readFileSync(sourcePath, 'utf8'));
	const mdx = `---
title: "${page.title.replace(/"/g, '\\"')}"
slug: /${page.slug}
id: ${page.id}
sidebar_position: ${page.sidebar_position}
description: "${page.description.replace(/"/g, '\\"')}"
---

${body}
`;
	fs.writeFileSync(path.join(docsOut, `${page.slug}.mdx`), mdx);
	console.log(`wrote ${path.relative(repoRoot, path.join(docsOut, `${page.slug}.mdx`))}`);
}
