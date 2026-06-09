/**
 * Build expanded reference sections: when/why, diagram, full source, diagram + playground.
 */
import fs from 'node:fs';
import path from 'node:path';

export function extractPlantUmlBlocks(markdown) {
	const blocks = [];
	const re = /```plantuml\n([\s\S]*?)```/g;
	let m;
	while ((m = re.exec(markdown)) !== null) {
		blocks.push(m[1].trimEnd());
	}
	return blocks;
}

export function readExampleSources(repoRoot, exampleId, sourceFiles) {
	return sourceFiles.map(rel => {
		const abs = path.join(repoRoot, 'examples', exampleId, rel);
		if (!fs.existsSync(abs)) {
			throw new Error(`missing source ${abs} for example ${exampleId}`);
		}
		return {
			rel: `examples/${exampleId}/${rel}`,
			content: fs.readFileSync(abs, 'utf8').trimEnd(),
		};
	});
}

export function buildExampleBlock(spec, repoRoot) {
	const readmePath = path.join(repoRoot, 'examples', spec.id, 'README.md');
	if (!fs.existsSync(readmePath)) {
		throw new Error(`missing README for ${spec.id}`);
	}
	const readme = fs.readFileSync(readmePath, 'utf8');
	const diagrams = extractPlantUmlBlocks(readme);
	const idx = spec.diagramIndex ?? 0;
	if (diagrams.length === 0) {
		throw new Error(`no plantuml in ${readmePath}`);
	}
	if (idx >= diagrams.length) {
		throw new Error(`diagramIndex ${idx} out of range (${diagrams.length}) for ${spec.id}`);
	}
	const plantuml = diagrams[idx];
	const sources = readExampleSources(repoRoot, spec.id, spec.sourceFiles ?? ['machine.ts']);
	const hasSpec = sources.some(s => s.rel.endsWith('.spec.ts'));
	const sourceSections = sources
		.map(s => {
			const caption = s.rel.endsWith('.spec.ts') ? `#### \`${s.rel}\` — mocha + chai tests, executed against the mocks` : `#### \`${s.rel}\``;
			return `${caption}

\`\`\`typescript
${s.content}
\`\`\``;
		})
		.join('\n\n');

	const sourceHeading = hasSpec ? '### Machine source, then the unit tests' : '### Full example source';
	const sourceIntro = hasSpec
		? `Runnable code lives under [\`${spec.id}\`](https://github.com/filasieno/ihsm/tree/master/examples/${spec.id}). First the **machine** (the code under test), then the **mocha + chai spec** that drives it — the same tests run headlessly with \`npm run test:examples -- --grep '${spec.grepLabel}'\`.`
		: `Runnable code lives under [\`${spec.id}\`](https://github.com/filasieno/ihsm/tree/master/examples/${spec.id}). The listings below are the complete, commented sources used by the trace panel.`;

	return `
### When and why: ${spec.title}

${spec.whenAndWhy.trim()}

### State diagram

\`\`\`plantuml
${plantuml}
\`\`\`

${sourceHeading}

${sourceIntro}

${sourceSections}

### Try it

Dispatch events in the **Trace** panel and compare output to the diagram and source. Run \`npm run test:examples -- --grep '${spec.grepLabel}'\` for a headless check.

\`\`\`plantuml
${plantuml}
\`\`\`

<InteractiveTutorial meta={${spec.importName}} />
`.trim();
}

export function expandExampleMarkers(text, specs, repoRoot) {
	const imports = [];
	let out = text;
	for (const spec of specs) {
		const marker = `<!-- @example:${spec.id} -->`;
		if (!out.includes(marker)) {
			throw new Error(`reference marker not found: ${marker}`);
		}
		const interactivePath = path.join(repoRoot, 'examples', spec.id, 'interactive.ts');
		if (!fs.existsSync(interactivePath)) {
			throw new Error(`missing interactive.ts for ${spec.id}`);
		}
		imports.push(
			`import { interactive as ${spec.importName} } from '@examples/${spec.id}/interactive';`
		);
		const block = buildExampleBlock(spec, repoRoot);
		out = out.replace(marker, `\n${block}\n`);
	}
	return { body: out, imports };
}
