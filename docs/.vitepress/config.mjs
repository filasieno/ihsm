import { defineConfig } from 'vitepress';

const referenceOutline = [
	{ text: 'Overview', link: '/reference/' },
	{ text: 'Introduction', link: '/reference/#introduction' },
	{ text: '1 · Key concepts', link: '/reference/01-key-concepts' },
	{ text: '2 · Key features', link: '/reference/02-key-features' },
	{ text: '3 · Static typing', link: '/reference/03-static-type-checking' },
	{ text: 'Advanced · Protocol typing', link: '/reference/03-static-type-checking#advanced-protocol-typing-and-compile-time-safety' },
	{ text: '4 · post, call, sync', link: '/reference/04-messaging-post-call-sync' },
	{ text: '5 · Transitions', link: '/reference/05-transitions' },
	{ text: '6 · Tracing', link: '/reference/06-tracing' },
	{ text: '7 · restore()', link: '/reference/07-restore' },
	{ text: '8 · Error model', link: '/reference/08-error-model' },
	{ text: '9 · Async handlers', link: '/reference/09-async-handlers' },
	{ text: '10 · then()', link: '/reference/10-then' },
	{ text: '11 · makeHsm', link: '/reference/11-make-hsm' },
	{ text: '12 · Zero dependencies', link: '/reference/12-zero-dependencies' },
	{ text: '13 · Code coverage', link: '/reference/13-code-coverage' },
	{ text: '14 · XState comparison', link: '/reference/14-comparison-with-xstate' },
	{ text: '15 · API quick reference', link: '/reference/15-api-quick-reference' },
];

const tutorialItems = [
	{ text: 'Tutorial index', link: '/reference/tutorials/' },
	{ text: '01 · Hello state machine', link: '/reference/tutorials/01-hello-state-machine' },
	{ text: '02 · Tracing', link: '/reference/tutorials/02-tracing' },
	{ text: '03 · Context', link: '/reference/tutorials/03-context' },
	{ text: '04 · Protocol typing', link: '/reference/tutorials/04-protocol-typing' },
	{ text: '05 · Hierarchy & transitions', link: '/reference/tutorials/05-hierarchy' },
	{
		text: '05 · Hierarchy cases',
		collapsed: true,
		items: [
			{ text: '01 · Initialization', link: '/reference/tutorials/05-hierarchy/01-initialization' },
			{ text: '02 · Internal', link: '/reference/tutorials/05-hierarchy/02-internal' },
			{ text: '03 · Sibling', link: '/reference/tutorials/05-hierarchy/03-sibling' },
			{ text: '04 · To parent', link: '/reference/tutorials/05-hierarchy/04-to-parent' },
			{ text: '05 · To ancestor', link: '/reference/tutorials/05-hierarchy/05-to-ancestor' },
			{ text: '06 · To root', link: '/reference/tutorials/05-hierarchy/06-to-root' },
			{ text: '07 · Cross leaf', link: '/reference/tutorials/05-hierarchy/07-cross-leaf' },
			{ text: '08 · Cross branch', link: '/reference/tutorials/05-hierarchy/08-cross-branch' },
			{ text: '09 · Cross mid', link: '/reference/tutorials/05-hierarchy/09-cross-mid' },
			{ text: '10 · Self', link: '/reference/tutorials/05-hierarchy/10-self' },
			{ text: '11 · East sibling', link: '/reference/tutorials/05-hierarchy/11-east-sibling' },
			{ text: '12 · Cross return', link: '/reference/tutorials/05-hierarchy/12-cross-return' },
			{ text: '13 · Async cross', link: '/reference/tutorials/05-hierarchy/13-async-cross' },
		],
	},
	{ text: '07 · Internal transitions', link: '/reference/tutorials/07-internal-transitions' },
	{ text: '08 · Post & sync', link: '/reference/tutorials/08-post-and-sync' },
	{ text: '09 · Deferred post', link: '/reference/tutorials/09-deferred-post' },
	{ text: '10 · Call services', link: '/reference/tutorials/10-call-services' },
	{ text: '11 · Restore', link: '/reference/tutorials/11-restore' },
	{ text: '12 · Error recovery', link: '/reference/tutorials/12-error-recovery' },
	{ text: '13 · Async handlers', link: '/reference/tutorials/13-async-handlers' },
	{ text: '14 · Nested machines', link: '/reference/tutorials/14-nested-machines' },
	{ text: '15 · Complex workflow', link: '/reference/tutorials/15-complex-workflow' },
	{ text: '16 · then()', link: '/reference/tutorials/16-then' },
	{ text: '17 · postNow()', link: '/reference/tutorials/17-post-now' },
];

const docsSidebar = [
	{
		text: 'Reference manual',
		collapsed: false,
		items: referenceOutline,
	},
	{
		text: 'Hands-on tutorials',
		collapsed: false,
		items: tutorialItems,
	},
];

/** @type {import('vitepress').UserConfig} */
export default defineConfig({
	base: '/ihsm/',
	title: 'ihsm',
	description: 'An idiomatic hierarchical state machine package for TypeScript',
	srcExclude: ['REFERENCE.md', 'API-README.md'],
	head: [['link', { rel: 'icon', href: '/ihsm/logo.svg' }]],
	ignoreDeadLinks: [/^https?:\/\/localhost/],
	markdown: {
		lineNumbers: true,
		languageAlias: { ts: 'typescript' },
	},
	themeConfig: {
		logo: '/logo.svg',
		nav: [
			{ text: 'Home', link: '/' },
			{ text: 'Documentation', link: '/reference/' },
			{ text: 'Tutorials', link: '/reference/tutorials/' },
			{ text: 'API', link: '/api/' },
			{ text: 'GitHub', link: 'https://github.com/filasieno/ihsm' },
		],
		sidebar: {
			'/reference/tutorials/': docsSidebar,
			'/reference/': docsSidebar,
		},
		socialLinks: [{ icon: 'github', link: 'https://github.com/filasieno/ihsm' }],
		footer: {
			message: 'MIT License · Fabio N. Filasieno, Roberto Boati',
			copyright: 'Copyright © 2020–present ihsm contributors',
		},
		search: { provider: 'local' },
		outline: { level: [2, 3] },
	},
});
