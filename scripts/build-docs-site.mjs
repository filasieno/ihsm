#!/usr/bin/env node
/**
 * Assembles markdown sources and TypeDoc API output for the VitePress site.
 * Source of truth: docs/REFERENCE.md, tutorials/NN-name/README.md
 * Generated (gitignored): docs/reference/ (includes tutorials/)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { renderPlantumlBlocks } from './plantuml-render.mjs';
import { renderTraceBlocks } from './trace-render.mjs';
import { rewriteReferenceFileLinks, splitReferenceManual, referencePageForAnchor } from './reference-sections.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const repoUrl = 'https://github.com/filasieno/ihsm/blob/master';

const generatedReference = join(root, 'docs/reference');
const generatedTutorials = join(generatedReference, 'tutorials');
const diagramOutput = join(root, 'docs/public/diagrams');
const apiOut = join(root, '.typedoc-out/api');

function rewriteDocLinks(content) {
	return rewriteReferenceFileLinks(
		content
			.replace(/\]\(\.\.\/tutorials\/README\.md\)/g, '](/reference/tutorials/)')
			.replace(/\]\(\.\.\/tutorials\/([^/)]+)\/README\.md\)/g, '](/reference/tutorials/$1)')
			.replace(/\]\(\.\.\/tutorials\/([^/)]+)\/\)/g, '](/reference/tutorials/$1)')
			.replace(/\]\(\.\.\/(\d{2}-[^/)]+)\/README\.md\)/g, '](/reference/tutorials/$1)')
			.replace(/\]\(\.\.\/README\.md\)/g, '](/reference/tutorials/)')
			.replace(/\]\(\.\/(\d{2}-[^/)]+)\/README\.md\)/g, '](/reference/tutorials/$1)')
			.replace(/\]\(\.\/(\d{2}-[^/)]+)\/\)/g, '](/reference/tutorials/$1)')
			.replace(/\]\(\/tutorials\/([^)]+)\)/g, '](/reference/tutorials/$1)')
			.replace(/\]\(\/tutorials\/\)/g, '](/reference/tutorials/)')
			.replace(/\]\(\.\.\/docs\/REFERENCE\.md(#.*?)\)/g, (_m, hash) => `](${referencePageForAnchor(hash.slice(1))})`)
			.replace(/\]\(\.\.\/docs\/REFERENCE\.md\)/g, '](/reference/)')
			.replace(/\]\(\.\.\/\.\.\/docs\/REFERENCE\.md(#.*?)\)/g, (_m, hash) => `](${referencePageForAnchor(hash.slice(1))})`)
			.replace(/\]\(\.\.\/\.\.\/docs\/REFERENCE\.md\)/g, '](/reference/)')
			.replace(/\]\(\.\/REFERENCE\.md(#.*?)\)/g, (_m, hash) => `](${referencePageForAnchor(hash.slice(1))})`)
			.replace(/\]\(\.\/REFERENCE\.md\)/g, '](/reference/)'),
	);
}

function injectTraceSample(content, folder) {
	const traceFile = join(root, 'tutorials', folder, 'trace.sample.txt');
	if (!content.includes('{{TRACE}}')) {
		return content;
	}
	const trace = existsSync(traceFile)
		? readFileSync(traceFile, 'utf8').trim()
		: '(run `npm run traces:generate` to capture trace output)';
	return content.replace('{{TRACE}}', trace);
}

function rewriteTutorialLinks(content, folder) {
	let out = rewriteDocLinks(content);
	out = out.replace(/\]\(\.\/machine\.ts\)/g, `](${repoUrl}/tutorials/${folder}/machine.ts)`);
	out = injectTraceSample(out, folder);
	return out;
}

async function writeMarkdown(content, dest, transform = (s) => s, plantumlIdPrefix = 'diagram') {
	mkdirSync(dirname(dest), { recursive: true });
	const linked = transform(content);
	const rendered = renderTraceBlocks(
		await renderPlantumlBlocks(linked, {
			idPrefix: plantumlIdPrefix,
			outputDir: diagramOutput,
		}),
	);
	writeFileSync(dest, rendered, 'utf8');
}

async function copyMarkdown(src, dest, transform = (s) => s, plantumlIdPrefix = 'diagram') {
	const raw = readFileSync(src, 'utf8');
	await writeMarkdown(raw, dest, transform, plantumlIdPrefix);
}

console.log('→ cleaning generated doc paths');
rmSync(generatedReference, { recursive: true, force: true });
rmSync(generatedTutorials, { recursive: true, force: true });
rmSync(join(root, 'docs/tutorials'), { recursive: true, force: true });
rmSync(diagramOutput, { recursive: true, force: true });
rmSync(join(root, '.typedoc-out'), { recursive: true, force: true });
mkdirSync(join(root, '.typedoc-out'), { recursive: true });

console.log('→ TypeDoc API → .typedoc-out/api');
execSync('npx typedoc --options typedoc.json', { cwd: root, stdio: 'inherit' });

const imagesSrc = join(root, 'assets/images');
const imagesDest = join(apiOut, 'assets/images');
mkdirSync(imagesDest, { recursive: true });
for (const name of readdirSync(imagesSrc)) {
	cpSync(join(imagesSrc, name), join(imagesDest, name));
}

console.log('→ reference manual');
const referenceSource = readFileSync(join(root, 'docs/REFERENCE.md'), 'utf8');
const { index, sections } = splitReferenceManual(referenceSource);

await writeMarkdown(index, join(generatedReference, 'index.md'), (c) => rewriteDocLinks(c), 'reference-index');

for (const [slug, body] of sections) {
	await writeMarkdown(body, join(generatedReference, `${slug}.md`), rewriteDocLinks, slug);
}

console.log('→ tutorials');
await copyMarkdown(join(root, 'tutorials/README.md'), join(generatedTutorials, 'index.md'), rewriteDocLinks);

const tutorialDirs = readdirSync(join(root, 'tutorials'))
	.filter((name) => /^\d{2}-/.test(name))
	.sort();

for (const folder of tutorialDirs) {
	const readme = join(root, 'tutorials', folder, 'README.md');
	await copyMarkdown(
		readme,
		join(generatedTutorials, `${folder}.md`),
		(c) => rewriteTutorialLinks(c, folder),
		folder,
	);
}

console.log('→ done');
