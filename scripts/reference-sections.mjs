/**
 * Reference manual section map — one docs site page per top-level §.
 */

/** @type {{ slug: string, match: RegExp, numberedAnchor: string, subAnchors?: string[] }[]} */
export const REFERENCE_SECTIONS = [
	{ slug: '01-key-concepts', match: /^## 1\. Key concepts/, numberedAnchor: '_1-key-concepts' },
	{ slug: '02-key-features', match: /^## 2\. Key features/, numberedAnchor: '_2-key-features' },
	{
		slug: '03-static-type-checking',
		match: /^## 3\. Static type checking/,
		numberedAnchor: '_3-static-type-checking',
		subAnchors: ['advanced-protocol-typing-and-compile-time-safety'],
	},
	{
		slug: '04-messaging-post-call-sync',
		match: /^## 4\. Messaging: post, call, sync/,
		numberedAnchor: '_4-messaging-post-call-sync',
		subAnchors: ['reading-uml-statecharts', 'sync'],
	},
	{
		slug: '05-transitions',
		match: /^## 5\. Transitions/,
		numberedAnchor: '_5-transitions',
		subAnchors: ['transition-taxonomy'],
	},
	{ slug: '06-tracing', match: /^## 6\. Tracing/, numberedAnchor: '_6-tracing' },
	{ slug: '07-restore', match: /^## 7\. restore/, numberedAnchor: '_7-restore' },
	{ slug: '08-error-model', match: /^## 8\. Error model/, numberedAnchor: '_8-error-model' },
	{ slug: '09-async-handlers', match: /^## 9\. Async handlers/, numberedAnchor: '_9-async-handlers' },
	{
		slug: '10-hsmfactory-configuration',
		match: /^## 10\. HsmFactory configuration/,
		numberedAnchor: '_10-hsmfactory-configuration',
	},
	{ slug: '11-zero-dependencies', match: /^## 11\. Zero dependencies/, numberedAnchor: '_11-zero-dependencies' },
	{ slug: '12-code-coverage', match: /^## 12\. Code coverage/, numberedAnchor: '_12-code-coverage' },
	{
		slug: '13-comparison-with-xstate',
		match: /^## 13\. Comparison with XState/,
		numberedAnchor: '_13-comparison-with-xstate',
	},
	{
		slug: '14-api-quick-reference',
		match: /^## 14\. API quick reference/,
		numberedAnchor: '_14-api-quick-reference',
	},
];

/** @param {string} anchor without leading # */
export function referencePageForAnchor(anchor) {
	if (anchor === 'introduction') {
		return '/reference/#introduction';
	}
	for (const section of REFERENCE_SECTIONS) {
		if (section.numberedAnchor === anchor) {
			return `/reference/${section.slug}`;
		}
		for (const sub of section.subAnchors ?? []) {
			if (sub === anchor) {
				return `/reference/${section.slug}#${sub}`;
			}
		}
	}
	return `/reference/#${anchor}`;
}

/** @param {string} content */
export function rewriteReferenceAnchors(content) {
	let out = content;
	for (const section of REFERENCE_SECTIONS) {
		out = out.replaceAll(`](#${section.numberedAnchor})`, `](/reference/${section.slug})`);
		for (const sub of section.subAnchors ?? []) {
			out = out.replaceAll(`](#${sub})`, `](/reference/${section.slug}#${sub})`);
		}
	}
	out = out.replaceAll('](#introduction)', '](/reference/#introduction)');
	return out;
}

/** @param {string} content */
export function rewriteReferenceFileLinks(content) {
	let out = rewriteReferenceAnchors(content);
	out = out.replace(/\]\([^)]*REFERENCE\.md#([^)]+)\)/g, (_m, anchor) => `](${referencePageForAnchor(anchor)})`);
	out = out.replace(/\]\([^)]*REFERENCE\.md\)/g, '](/reference/)');
	return out;
}

/**
 * Split docs/REFERENCE.md into index preamble + one markdown body per section.
 * @param {string} markdown
 */
export function splitReferenceManual(markdown) {
	const chunks = markdown.split(/\n(?=## )/);
	const preamble = chunks[0]?.trim() ?? '';
	const sections = new Map();
	let indexTail = '';

	for (let i = 1; i < chunks.length; i++) {
		const chunk = chunks[i];
		const firstLine = chunk.split('\n', 1)[0];
		if (firstLine === '## Introduction' || firstLine === '## Table of contents') {
			indexTail += `${chunk.trim()}\n\n---\n\n`;
			continue;
		}
		if (firstLine === '## Learning path') {
			indexTail += `${chunk.trim()}\n`;
			continue;
		}
		const def = REFERENCE_SECTIONS.find((s) => s.match.test(firstLine));
		if (!def) {
			throw new Error(`Unknown reference section heading: ${firstLine}`);
		}
		const body = chunk.replace(/^##\s+\d+\.\s*/, '# ').trim();
		sections.set(def.slug, body);
	}

	const index = `${preamble}\n\n---\n\n${rewriteReferenceAnchors(indexTail.trim())}`;
	return { index, sections };
}
