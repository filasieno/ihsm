/**
 * Parse reference/REFERENCE.md into numbered sections and ### subsections.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {{ preamble: string, subsections: Map<string, string> }} ParsedSection */

/**
 * @param {string} content
 * @returns {{
 *   introduction: string,
 *   sections: Map<string, ParsedSection>,
 *   learningPath: string,
 * }}
 */
export function parseReferenceMarkdown(content) {
	const introduction = extractBlock(content, '## Introduction', '## Table of contents');
	const learningPath = extractBlock(content, '## Learning path', null);

	/** @type {Map<string, ParsedSection>} */
	const sections = new Map();

	const sectionRe = /^## (\d+)\. (.+)$/gm;
	const matches = [...content.matchAll(sectionRe)];

	for (let i = 0; i < matches.length; i++) {
		const match = matches[i];
		const num = match[1];
		const title = match[2];
		const start = match.index + match[0].length + 1;
		const end = i + 1 < matches.length ? matches[i + 1].index : content.length;
		const body = content.slice(start, end).trimEnd();
		sections.set(num, {
			title: `${num}. ${title}`,
			...splitSubsections(body),
		});
	}

	return { introduction, sections, learningPath };
}

/**
 * @param {string} body
 * @returns {ParsedSection}
 */
function splitSubsections(body) {
	const parts = body.split(/\n(?=### )/);
	let preamble = '';
	/** @type {Map<string, string>} */
	const subsections = new Map();

	for (const part of parts) {
		if (part.startsWith('### ')) {
			const newline = part.indexOf('\n');
			const heading = part.slice(4, newline >= 0 ? newline : undefined).trim();
			const text = newline >= 0 ? part.slice(newline + 1).trimEnd() : '';
			subsections.set(heading, text);
		} else {
			preamble += part;
		}
	}

	return { preamble: preamble.trimEnd(), subsections };
}

function extractBlock(content, startHeading, endHeading) {
	const start = content.indexOf(`\n${startHeading}\n`);
	if (start < 0) return '';
	const from = start + startHeading.length + 2;
	if (!endHeading) return content.slice(from).trimEnd();
	const end = content.indexOf(`\n${endHeading}\n`, from);
	return end < 0 ? content.slice(from).trimEnd() : content.slice(from, end).trimEnd();
}

/**
 * @param {Map<string, ParsedSection>} sections
 * @param {{ section: string, all?: boolean, subsections?: string[] }} spec
 * @returns {string}
 */
export function composeReferenceParts(sections, spec) {
	const entry = sections.get(spec.section);
	if (!entry) {
		throw new Error(`reference section ${spec.section} not found`);
	}

	if (spec.all) {
		return renderSection(entry.title, entry.preamble, entry.subsections);
	}

	const picked = new Map();
	for (const name of spec.subsections ?? []) {
		if (!entry.subsections.has(name)) {
			throw new Error(`subsection "${name}" not found in section ${spec.section}. ${entry.title}`);
		}
		picked.set(name, entry.subsections.get(name));
	}

	return renderSection(entry.title, entry.preamble, picked);
}

/**
 * @param {string} title
 * @param {string} preamble
 * @param {Map<string, string>} subsections
 */
function renderSection(title, preamble, subsections) {
	const chunks = [`## ${title}`];
	if (preamble) chunks.push(preamble);
	for (const [heading, body] of subsections) {
		chunks.push(`### ${heading}`, body);
	}
	return chunks.join('\n\n').trimEnd();
}

export function loadReferenceSections() {
	const sourcePath = path.join(repoRoot, 'reference/REFERENCE.md');
	const content = fs.readFileSync(sourcePath, 'utf8');
	return parseReferenceMarkdown(content);
}
