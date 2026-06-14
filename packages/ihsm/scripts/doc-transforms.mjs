/**
 * Shared markdown transforms for ihsm Docusaurus generators.
 */

export function slugifySection(title) {
	return title
		.toLowerCase()
		.replace(/`/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '');
}

/** Turn TSDoc `{@link …}` into backticks — API docs are not published on the site. */
export function convertTypedocLinks(text) {
	return text.replace(/\{@link\s+([^}]+)\}/g, (_m, raw) => {
		const target = raw.trim();
		const short = target.replace(/^ihsm(?:\/testing)?[.!]/, '').split(/[.|]/).pop();
		const label = target.includes('|') ? target.split('|').pop().trim() : short;
		return `\`${label}\``;
	});
}

export function transformSiteLinks(text) {
	let out = text;

	out = out.replace(/\([^)]*REFERENCE\.md(#[^)]+)\)/gi, '($1)');
	out = out.replace(/\]\(https:\/\/filasieno\.github\.io\/ihsm\/guide([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(\/guide([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(\.\.\/tutorials\/README\.md\)/g, '](/reference)');
	out = out.replace(/\]\(\.\.\/examples\/README\.md\)/g, '](/reference)');

	out = out.replace(/\]\(\.\/EMBODIMENTS\.md([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(EMBODIMENTS\.md([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(\.\/GLOSSARY\.md([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(GLOSSARY\.md([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(\.\.\/reference\/EMBODIMENTS\.md([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(\.\.\/reference\/GLOSSARY\.md([^)]*)\)/g, '](/reference$1)');
	out = out.replace(/\]\(\.\.\/examples\/00-config\/README\.md([^)]*)\)/g, '](/reference#_1-key-concepts$1)');

	const exampleAnchors = {
		'01-hello-state-machine': '#_1-key-concepts',
		'02-tracing': '#_6-tracing',
		'03-context': '#_2-key-features',
		'04-protocol-typing': '#_3-static-type-checking',
		'05-hierarchy': '#_5-transitions',
		'07-internal-transitions': '#_2-key-features',
		'08-post-and-sync': '#_4-messaging-notifications-services-sync',
		'09-deferred-post': '#_4-messaging-notifications-services-sync',
		'10-call-services': '#_4-messaging-notifications-services-sync',
		'11-restore': '#_7-restore',
		'12-error-recovery': '#_8-error-model',
		'13-async-handlers': '#_9-async-handlers',
		'14-nested-machines': '#_2-key-features',
		'15-complex-workflow': '#rules-of-thumb',
		'17-post-now': '#_4-messaging-notifications-services-sync',
		'18-chained-child-actors': '#_2-key-features',
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

	out = out.replace(/Hands-on topics: \[guide\]\([^)]+\) · \[source index\]\([^)]+\)\n?/, 'Documentation: [Reference](/reference) · [Testing](/testing)\n\n');

	out = out.replace(/^Tutorial: \[.*\]\([^)]+\)\n?/gm, '');
	out = out.replace(/^Tutorial: \[.*\]\([^)]+\) \([^)]+\)\n?/gm, '');

	out = out.replace(/\(see \[tutorial \d+\]\([^)]+\)\)/g, '(see the interactive example below)');
	out = out.replace(/\[tutorial \d+\]\(\.\.\/tutorials\/[^)]+\)/g, '[hierarchy example](#_5-transitions)');
	out = out.replace(/\[tutorial \d+\]\(\.\.\/examples\/[^)]+\)/g, '[hierarchy example](#_5-transitions)');

	out = out.replace(/\[§14 Comparison with XState\]\(#_13-comparison-with-xstate\)/g, '[Comparison with XState](#_13-comparison-with-xstate)');
	out = out.replace(/\[§3 Advanced: Protocol typing\]\(#advanced-protocol-typing-and-compile-time-safety\)/g, '[Protocol typing](#advanced-protocol-typing-and-compile-time-safety)');
	out = out.replace(/\[§4 `sync\(\)`\]\(#sync\)/g, '[`actor.hsm.sync()`](#sync)');

	out = out.replace(/tutorials\/shared\//g, 'examples/shared/');
	out = out.replace(/`tutorials\//g, '`examples/');
	out = out.replace(/npm run test:tutorials/g, 'npm run test:examples');
	out = out.replace(/each tutorial page/gi, 'the reference page');
	out = out.replace(/Tutorial READMEs/gi, 'Reference');
	out = out.replace(/ihsm tutorials and the reference/gi, 'ihsm reference');

	return out;
}

export function applySectionAnchors(text) {
	return text.replace(/^## (\d+)\. (.+)$/gm, (_match, num, title) => {
		const slug = slugifySection(title);
		return `## ${num}. ${title} {#_${num}-${slug}}`;
	});
}

/** Drop the first markdown H1 — Docusaurus uses frontmatter `title`. */
export function stripLeadingH1(text) {
	return text.replace(/^# .+\n+/, '');
}

export function prepareMarkdownBody(raw, { numberedSections = false } = {}) {
	let body = convertTypedocLinks(raw);
	body = transformSiteLinks(body);
	if (numberedSections) {
		body = applySectionAnchors(body);
	}
	body = stripLeadingH1(body);
	return body.trimEnd();
}
