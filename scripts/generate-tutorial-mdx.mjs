#!/usr/bin/env node
/**
 * Merge tutorial README prose with an embedded InteractiveTutorial on each docs page.
 * Source: tutorials/NN-name/README.md → website/docs/tutorials/NN-name.mdx
 * Also regenerates website/sidebars.ts tutorial items.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { plantumlAssetDir, plantumlUrlPrefix, renderPlantumlInMarkdown } from './render-plantuml.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tutorialsDir = path.join(repoRoot, 'tutorials');
const outDir = path.join(repoRoot, 'website/docs/tutorials');
const sidebarsPath = path.join(repoRoot, 'website/sidebars.ts');

const playgroundBlock = `
<InteractiveTutorial meta={interactive} />
`;

function titleFromReadme(readmeBody, tutorialId) {
	const match = readmeBody.match(/^#\s+(.+)\s*$/m);
	if (!match) {
		throw new Error(`${tutorialId}: README.md missing level-1 heading`);
	}
	return match[1].trim();
}

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

	text = text.replace(/tutorials\/_shared\//g, 'tutorials/shared/');

	if (text.includes('## Reading the trace')) {
		text = text.replace(/^## Reading the trace\n/m, `## Reading the trace\n${playgroundBlock}\n`);
	} else {
		text = text.replace(/^## Verify\n/m, `## Try it\n${playgroundBlock}\n## Verify\n`);
	}

	text = renderPlantumlInMarkdown(text, {
		assetDir: plantumlAssetDir(repoRoot),
		urlPrefix: plantumlUrlPrefix,
		fileBase: tutorialId,
	});

	// Repeat the (external) statechart image just before "Reading the trace" so
	// readers can correlate trace lines with states without scrolling back up.
	// Reuses the same rendered SVG asset — a copy of the embed, not a re-render.
	const firstDiagram = text.match(/!\[UML state diagram\]\([^)]+\)/);
	if (firstDiagram && /^## Reading the trace$/m.test(text)) {
		const diagramCopy = `_State diagram (repeated for reference):_\n\n${firstDiagram[0]}\n\n`;
		text = text.replace(/^## Reading the trace$/m, `${diagramCopy}## Reading the trace`);
	}

	return text.trimEnd() + '\n';
}

function generateMdx(tutorialId, readmeBody) {
	const title = titleFromReadme(readmeBody, tutorialId);
	const body = transformMarkdown(readmeBody, tutorialId);

	return `---
title: "${title.replace(/"/g, '\\"')}"
id: ${tutorialId}
slug: /tutorials/${tutorialId}
---

import InteractiveTutorial from '@site/src/components/InteractiveTutorial';
import { interactive } from '@tutorials/${tutorialId}/interactive';

# ${title}

${body}`;
}

function writeSidebars(tutorialIds) {
	const items = tutorialIds.map(id => `'tutorials/${id}'`).join(', ');
	const content = `import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// GENERATED — unified docs sidebar (reference + tutorials)
const sidebars: SidebarsConfig = {
\tdocs: [
\t\t'intro',
\t\t{
\t\t\ttype: 'category',
\t\t\tlabel: 'Documentation',
\t\t\tcollapsed: false,
\t\t\titems: [
\t\t\t\t'reference/reference',
\t\t\t\t{
\t\t\t\t\ttype: 'category',
\t\t\t\t\tlabel: 'Tutorials',
\t\t\t\t\tlink: { type: 'doc', id: 'tutorials/tutorial-index' },
\t\t\t\t\titems: [${items}],
\t\t\t\t},
\t\t\t],
\t\t},
\t],
};

export default sidebars;
`;
	fs.writeFileSync(sidebarsPath, content);
	console.log(`wrote ${path.relative(repoRoot, sidebarsPath)}`);
}

function updateTutorialIndex(tutorialIds) {
	const indexPath = path.join(repoRoot, 'website/docs/tutorials/index.mdx');
	const marker = '<!-- TUTORIAL_TABLE -->';
	let content = fs.readFileSync(indexPath, 'utf8');
	if (!content.includes(marker)) {
		throw new Error(`${indexPath} missing ${marker}`);
	}

	const rows = tutorialIds.map(id => {
		const readmePath = path.join(tutorialsDir, id, 'README.md');
		const readmeBody = fs.readFileSync(readmePath, 'utf8');
		const num = id.slice(0, 2);
		const title = titleFromReadme(readmeBody, id);
		return `| ${num} | [${title}](/tutorials/${id}) |`;
	});

	const table = ['| # | Tutorial |', '| --- | -------- |', ...rows].join('\n');
	content = content.replace(marker, table);
	fs.writeFileSync(indexPath, content);
	console.log(`updated ${path.relative(repoRoot, indexPath)}`);
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

writeSidebars(tutorialDirs);
updateTutorialIndex(tutorialDirs);
