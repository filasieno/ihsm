#!/usr/bin/env node
/**
 * Single Reference page: reference/REFERENCE.md + inline playgrounds from examples/.
 * Output: website/docs/reference.mdx and website/sidebars.ts
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plantumlAssetDir, plantumlUrlPrefix, renderPlantumlInMarkdown } from './render-plantuml.mjs';
import { expandExampleMarkers } from './expand-reference-examples.mjs';
import { referenceExamples } from './reference-examples.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const referencePath = path.join(repoRoot, 'reference/REFERENCE.md');
const docsOut = process.env.IHSM_DOCS_DIR
	? path.resolve(process.env.IHSM_DOCS_DIR)
	: path.join(repoRoot, 'website/docs');
const sidebarsPath = path.join(repoRoot, 'website/sidebars.ts');

function slugifySection(title) {
	return title
		.toLowerCase()
		.replace(/`/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

function transformSiteLinks(text) {
	let out = text;

	out = out.replace(/\([^)]*REFERENCE\.md(#[^)]+)\)/gi, '($1)');
	out = out.replace(/\]\(https:\/\/filasieno\.github\.io\/ihsm\/guide([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(\/guide([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(\.\.\/tutorials\/README\.md\)/g, '](/reference)');
	out = out.replace(/\]\(\.\.\/examples\/README\.md\)/g, '](/reference)');
	const exampleAnchors = {
		'01-hello-state-machine': '#_1-key-concepts',
		'02-tracing': '#_6-tracing',
		'03-context': '#_2-key-features',
		'04-protocol-typing': '#_3-static-type-checking',
		'05-hierarchy': '#_5-transitions',
		'07-internal-transitions': '#_2-key-features',
		'08-post-and-sync': '#_4-messaging-post-call-sync',
		'09-deferred-post': '#_4-messaging-post-call-sync',
		'10-call-services': '#_4-messaging-post-call-sync',
		'11-restore': '#_7-restore',
		'12-error-recovery': '#_8-error-model',
		'13-async-handlers': '#_9-async-handlers',
		'14-nested-machines': '#_2-key-features',
		'15-complex-workflow': '#rules-of-thumb',
		'17-post-now': '#_4-messaging-post-call-sync',
	};
	for (const [id, anchor] of Object.entries(exampleAnchors)) {
		out = out.replaceAll(`](/reference/${id})`, `](${anchor})`);
		out = out.replaceAll(`](/reference/${id}#`, `](${anchor}#`);
	}
	out = out.replace(/\]\(\.\.\/tutorials\/(\d{2}-[^/)]+)\/README\.md([^)]*)\)/g, (_m, id, hash) => {
		const anchor = exampleAnchors[id] ?? '/reference';
		return `](${anchor}${hash || ''})`;
	});
	out = out.replace(/\]\(\.\.\/examples\/(\d{2}-[^/)]+)\/README\.md([^)]*)\)/g, (_m, id, hash) => {
		const anchor = exampleAnchors[id] ?? '/reference';
		return `](${anchor}${hash || ''})`;
	});
	out = out.replace(/\]\(\/tutorials(\/[^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(https:\/\/filasieno\.github\.io\/ihsm\/tutorials([^)]*)\)/g, '](/reference$1)');

	out = out.replace(
		/Hands-on topics: \[guide\]\([^)]+\) · \[source index\]\([^)]+\)\n?/,
		'Documentation: [Reference](/reference) · [API](/api)\n\n'
	);

	out = out.replace(/^Tutorial: \[.*\]\([^)]+\)\n?/gm, '');
	out = out.replace(/^Tutorial: \[.*\]\([^)]+\) \([^)]+\)\n?/gm, '');

	out = out.replace(
		/\(see \[tutorial \d+\]\([^)]+\)\)/g,
		'(see the interactive example below)'
	);
	out = out.replace(
		/\[tutorial \d+\]\(\.\.\/tutorials\/[^)]+\)/g,
		'[hierarchy example](#_5-transitions)'
	);
	out = out.replace(
		/\[tutorial \d+\]\(\.\.\/examples\/[^)]+\)/g,
		'[hierarchy example](#_5-transitions)'
	);

	out = out.replace(
		/\[§14 Comparison with XState\]\(#_13-comparison-with-xstate\)/g,
		'[Comparison with XState](#_13-comparison-with-xstate)'
	);
	out = out.replace(
		/\[§3 Advanced: Protocol typing\]\(#advanced-protocol-typing-and-compile-time-safety\)/g,
		'[Protocol typing](#advanced-protocol-typing-and-compile-time-safety)'
	);
	out = out.replace(/\[§4 `sync\(\)`\]\(#sync\)/g, '[`sync()`](#sync)');

	out = out.replace(/tutorials\/shared\//g, 'examples/shared/');
	out = out.replace(/`tutorials\//g, '`examples/');
	out = out.replace(/npm run test:tutorials/g, 'npm run test:examples');
	out = out.replace(/each tutorial page/gi, 'the reference page');
	out = out.replace(/Tutorial READMEs/gi, 'Reference');
	out = out.replace(/ihsm tutorials and the reference/gi, 'ihsm reference');

	return out;
}

function applySectionAnchors(text) {
	return text.replace(/^## (\d+)\. (.+)$/gm, (_match, num, title) => {
		const slug = slugifySection(title);
		return `## ${num}. ${title} {#_${num}-${slug}}`;
	});
}

function buildReferenceMdx() {
	let body = fs.readFileSync(referencePath, 'utf8');
	body = transformSiteLinks(body);
	body = applySectionAnchors(body);
	const { body: withPlaygrounds, imports } = expandExampleMarkers(body, referenceExamples, repoRoot);
	body = renderPlantumlInMarkdown(withPlaygrounds, {
		assetDir: plantumlAssetDir(repoRoot),
		urlPrefix: plantumlUrlPrefix,
		fileBase: 'reference',
	});

	const importBlock =
		imports.length > 0
			? `import InteractiveTutorial from '@site/src/components/InteractiveTutorial';\n${imports.join('\n')}\n\n`
			: '';

	return `---
title: Reference
slug: /reference
id: reference
sidebar_position: 2
---

${importBlock}# Reference

${body.trimEnd()}
`;
}

function writeSidebars() {
	const content = `import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// GENERATED — Reference (single page) + API (TSDoc)
const sidebars: SidebarsConfig = {
\tdocs: [
\t\t'intro',
\t\t'reference',
\t\t{
\t\t\ttype: 'category',
\t\t\tlabel: 'API Reference',
\t\t\tlink: { type: 'doc', id: 'api/api' },
\t\t\tcollapsed: true,
\t\t\titems: [{ type: 'autogenerated', dirName: 'api' }],
\t\t},
\t],
};

export default sidebars;
`;
	fs.writeFileSync(sidebarsPath, content);
	console.log(`wrote ${path.relative(repoRoot, sidebarsPath)}`);
}

fs.mkdirSync(docsOut, { recursive: true });
const mdx = buildReferenceMdx();
fs.writeFileSync(path.join(docsOut, 'reference.mdx'), mdx);
console.log(`wrote ${path.relative(repoRoot, path.join(docsOut, 'reference.mdx'))}`);
writeSidebars();
