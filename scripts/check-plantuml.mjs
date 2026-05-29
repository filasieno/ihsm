#!/usr/bin/env node
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import plantuml from 'node-plantuml';
import { Writable } from 'node:stream';

import { normalizePlantumlSource } from './plantuml-render.mjs';

const PLANTUML_FENCE = /```plantuml\r?\n([\s\S]*?)```/g;
const root = join(import.meta.dirname, '..');

function isErrorSvg(data) {
	return (
		data.includes('background:#000000') ||
		/#FF0000/.test(data) ||
		/cannot be used here|Syntax Error|Syntax error/i.test(data)
	);
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
						reject(new Error('No SVG output'));
						cb();
						return;
					}
					if (isErrorSvg(data)) {
						const detail = data.match(/>([^<]{10,120})</g)?.pop()?.slice(1, -1) ?? 'syntax error';
						reject(new Error(detail));
						cb();
						return;
					}
					cb();
					resolve(data);
				},
			}),
		);
	});
}

const files = [
	join(root, 'docs/REFERENCE.md'),
	...readdirSync(join(root, 'tutorials'))
		.filter((d) => /^\d{2}-/.test(d))
		.map((d) => join(root, 'tutorials', d, 'README.md')),
];

let failed = 0;
for (const file of files) {
	const md = readFileSync(file, 'utf8');
	const blocks = [...md.matchAll(PLANTUML_FENCE)];
	for (let i = 0; i < blocks.length; i++) {
		const label = `${file.replace(root + '/', '')} #${i + 1}`;
		try {
			await renderSvg(blocks[i][1]);
			console.log('OK  ', label);
		} catch (err) {
			failed += 1;
			console.log('FAIL', label, '-', err.message);
			console.log(blocks[i][1].trim());
			console.log('---');
		}
	}
}

if (failed > 0) {
	process.exit(1);
}

console.log('All PlantUML diagrams OK');
