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
import { referenceExamples, testingExamples, buildExampleIndexSection } from './reference-examples.mjs';
import { applySectionAnchors, convertTypedocLinks, prepareMarkdownBody, transformSiteLinks } from './doc-transforms.mjs';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const referencePath = path.join(repoRoot, 'reference/REFERENCE.md');
const testingPath = path.join(repoRoot, 'reference/TESTING.md');
const docsOut = process.env.IHSM_DOCS_DIR ? path.resolve(process.env.IHSM_DOCS_DIR) : path.join(repoRoot, 'website/docs');
const sidebarsPath = path.join(repoRoot, 'website/sidebars.ts');

function prepareReferenceBody(raw) {
	let body = convertTypedocLinks(raw);
	body = transformSiteLinks(body);
	body = applySectionAnchors(body);
	if (body.includes('<!-- @example-index -->')) {
		body = body.replace('<!-- @example-index -->', buildExampleIndexSection(referenceExamples));
	}
	return body.replace(/^# .+\n+/, '').trimEnd();
}

function buildReferenceMdx() {
	let body = prepareReferenceBody(fs.readFileSync(referencePath, 'utf8'));
	const { body: withPlaygrounds, imports } = expandExampleMarkers(body, referenceExamples, repoRoot);
	body = renderPlantumlInMarkdown(withPlaygrounds, {
		assetDir: plantumlAssetDir(repoRoot),
		urlPrefix: plantumlUrlPrefix,
		fileBase: 'reference',
	});

	const importBlock = imports.length > 0 ? `import InteractiveTutorial from '@site/src/components/InteractiveTutorial';\n${imports.join('\n')}\n\n` : '';

	return `---
title: Reference
slug: /reference
id: reference
sidebar_position: 2
toc_min_heading_level: 2
toc_max_heading_level: 4
description: Concepts, semantics, and interactive examples for ihsm hierarchical state machines.
---

${importBlock}${body.trimEnd()}
`;
}

function buildTestingMdx() {
	let body = prepareMarkdownBody(fs.readFileSync(testingPath, 'utf8'), { numberedSections: true });
	const { body: withPlaygrounds, imports } = expandExampleMarkers(body, testingExamples, repoRoot);
	body = renderPlantumlInMarkdown(withPlaygrounds, {
		assetDir: plantumlAssetDir(repoRoot),
		urlPrefix: plantumlUrlPrefix,
		fileBase: 'testing',
	});

	const importBlock = imports.length > 0 ? `import InteractiveTutorial from '@site/src/components/InteractiveTutorial';\n${imports.join('\n')}\n\n` : '';

	return `---
title: Deterministic Testing
slug: /testing
id: testing
sidebar_position: 3
description: Deterministic simulation testing with TestPort, mock ports, and DST patterns.
---

${importBlock}${body.trimEnd()}
`;
}

function writeSidebars() {
	const content = `import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

// GENERATED — docs navigation
const sidebars: SidebarsConfig = {
\tdocs: ['intro', 'reference', 'testing'],
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
const testingMdx = buildTestingMdx();
fs.writeFileSync(path.join(docsOut, 'testing.mdx'), testingMdx);
console.log(`wrote ${path.relative(repoRoot, path.join(docsOut, 'testing.mdx'))}`);
writeSidebars();
