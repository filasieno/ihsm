#!/usr/bin/env node
/**
 * Merge tutorial README prose with an embedded InteractiveTutorial on each docs page.
 * Source: tutorials/NN-name/README.md → tutorials/_site/docs/tutorials/NN-name.mdx
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tutorialsDir = path.join(repoRoot, 'tutorials');
const outDir = path.join(tutorialsDir, '_site/docs/tutorials');

/** @type {Record<string, string>} */
const titles = {
	'01-hello-state-machine': '01 · Hello state machine',
	'02-tracing': '02 · Tracing',
	'03-context': '03 · Context',
	'04-protocol-typing': '04 · Protocol typing',
	'05-hierarchy': '05 · Hierarchy',
	'07-internal-transitions': '07 · Internal transitions',
	'08-post-and-sync': '08 · post and sync',
	'09-deferred-post': '09 · deferredPost',
	'10-call-services': '10 · call services',
	'11-restore': '11 · restore',
	'12-error-recovery': '12 · Error recovery',
	'13-async-handlers': '13 · Async handlers',
	'14-nested-machines': '14 · Nested machines',
	'15-complex-workflow': '15 · Complex workflow',
	'16-then': '16 · then()',
	'17-post-now': '17 · postNow()',
};

const playgroundBlock = `
<InteractiveTutorial meta={interactive} />
`;

function transformMarkdown(body, tutorialId) {
	let text = body;

	text = text.replace(/^# .+\n+/, '');

	text = text.replace(/\]\(\.\.\/(\d{2}-[^/)]+)\/README\.md([^)]*)\)/g, '](/tutorials/$1$2)');
	text = text.replace(/\]\(\.\/cases\/([^/)]+)\/README\.md\)/g, '](https://github.com/filasieno/ihsm/tree/master/tutorials/05-hierarchy/cases/$1)');
	text = text.replace(
		/\]\(\.\/(machine\.ts|tutorial\.spec\.ts|trace-sibling\.ts|interactive\.ts)\)/g,
		`](https://github.com/filasieno/ihsm/tree/master/tutorials/${tutorialId}/$1)`
	);
	text = text.replace(
		/\]\(\.\.\/\.\.\/docs\/REFERENCE\.md([^)]*)\)/g,
		'](/reference$1)'
	);
	text = text.replace(
		/\]\(\.\.\/reference\/REFERENCE\.md([^)]*)\)/g,
		'](/reference$1)'
	);

	text = text.replace(
		/See the \*\*Trace\*\* panel on the \[interactive docs site\]\([^)]+\), or run `npm run test:tutorials` headlessly\.\n?/g,
		''
	);
	text = text.replace(
		/On the \[documentation page\]\([^)]+\), use the embedded playground to dispatch events and inspect the \*\*Trace\*\* panel\. Or run `npm run test:tutorials` headlessly\.\n?/g,
		''
	);
	text = text.replace(
		/When exercising the deep stacks below, use the embedded playground on the \[documentation page\]\([^)]+\), or run `npm run test:tutorials` headlessly\.\n?/g,
		''
	);

	if (text.includes('## Reading the trace')) {
		text = text.replace(/^## Reading the trace\n/m, `## Reading the trace\n${playgroundBlock}\n`);
	} else {
		text = text.replace(/^## Verify\n/m, `## Try it\n${playgroundBlock}\n## Verify\n`);
	}

	return text.trimEnd() + '\n';
}

function generateMdx(tutorialId, readmeBody) {
	const title = titles[tutorialId];
	if (!title) {
		throw new Error(`Missing title mapping for ${tutorialId}`);
	}

	const body = transformMarkdown(readmeBody, tutorialId);

	return `---
title: "${title}"
id: ${tutorialId}
slug: /tutorials/${tutorialId}
---

import InteractiveTutorial from '@site/src/components/InteractiveTutorial';
import { interactive } from '@tutorials/${tutorialId}/interactive';

# ${title}

${body}`;
}

const tutorialDirs = fs
	.readdirSync(tutorialsDir, { withFileTypes: true })
	.filter(entry => entry.isDirectory() && /^\d{2}-/.test(entry.name))
	.map(entry => entry.name)
	.sort();

for (const tutorialId of tutorialDirs) {
	const readmePath = path.join(tutorialsDir, tutorialId, 'README.md');
	if (!fs.existsSync(readmePath)) {
		console.warn(`skip ${tutorialId}: no README.md`);
		continue;
	}

	const readmeBody = fs.readFileSync(readmePath, 'utf8');
	const mdx = generateMdx(tutorialId, readmeBody);
	const outPath = path.join(outDir, `${tutorialId}.mdx`);
	fs.writeFileSync(outPath, mdx);
	console.log(`wrote ${path.relative(repoRoot, outPath)}`);
}
