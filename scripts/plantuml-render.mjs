#!/usr/bin/env node
/**
 * Renders ```plantuml fenced blocks to SVG assets for static VitePress output.
 */
import plantuml from 'node-plantuml';
import { Writable } from 'node:stream';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PLANTUML_FENCE = /```plantuml\r?\n([\s\S]*?)```/g;
const WHITE_BG = 'skinparam backgroundColor #FFFFFF';

export function normalizePlantumlSource(source) {
	const trimmed = source.trim();
	let body = trimmed;
	if (!body.startsWith('@startuml')) {
		body = `@startuml\n${body}\n@enduml`;
	} else if (!body.endsWith('@enduml')) {
		body = `${body}\n@enduml`;
	}
	if (!/skinparam\s+backgroundColor/i.test(body)) {
		body = body.replace(/^@startuml\r?\n/, `@startuml\n${WHITE_BG}\n`);
	}
	return body;
}

function renderSvg(source) {
	return new Promise((resolve, reject) => {
		const gen = plantuml.generate(normalizePlantumlSource(source), { format: 'svg' });
		let data = '';
		gen.out.on('error', reject);
		gen.out.pipe(
			new Writable({
				write(chunk, _enc, cb) {
					data += chunk.toString();
					cb();
				},
				final(cb) {
					if (!data.includes('<svg')) {
						reject(new Error('PlantUML did not produce SVG output'));
						cb();
						return;
					}
					if (
						data.includes('background:#000000') ||
						/#FF0000/.test(data) ||
						/cannot be used here|Syntax Error|Syntax error/i.test(data)
					) {
						reject(new Error('PlantUML syntax error — check diagram source'));
						cb();
						return;
					}
					cb();
					resolve(data.trim());
				},
			}),
		);
	});
}

/**
 * @param {string} markdown
 * @param {{ idPrefix?: string, outputDir: string, publicPath?: string }} options
 * @returns {Promise<string>}
 */
export async function renderPlantumlBlocks(markdown, options) {
	const { idPrefix = 'diagram', outputDir, publicPath = '/diagrams' } = options;
	let index = 0;
	const blocks = [...markdown.matchAll(PLANTUML_FENCE)];

	if (blocks.length === 0) {
		return markdown;
	}

	mkdirSync(outputDir, { recursive: true });

	let result = markdown;
	for (const match of blocks) {
		const source = match[1];
		const svg = await renderSvg(source);
		const hash = createHash('sha1').update(source).digest('hex').slice(0, 8);
		const fileName = `${idPrefix}-${index}-${hash}.svg`;
		const filePath = join(outputDir, fileName);
		writeFileSync(filePath, svg, 'utf8');
		index += 1;
		const html = `<figure class="plantuml-diagram"><img src="${publicPath}/${fileName}" alt="UML statechart" loading="lazy" /></figure>`;
		result = result.replace(match[0], html);
	}

	return result;
}
