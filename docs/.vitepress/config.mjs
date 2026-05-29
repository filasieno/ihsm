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
	{ text: '10 · HsmFactory', link: '/reference/10-hsmfactory-configuration' },
	{ text: '11 · Zero dependencies', link: '/reference/11-zero-dependencies' },
	{ text: '12 · Code coverage', link: '/reference/12-code-coverage' },
	{ text: '13 · XState comparison', link: '/reference/13-comparison-with-xstate' },
	{ text: '14 · API quick reference', link: '/reference/14-api-quick-reference' },
];

const tutorialItems = [
	{ text: 'Tutorial index', link: '/reference/tutorials/' },
	{ text: '01 · Hello state machine', link: '/reference/tutorials/01-hello-state-machine' },
	{ text: '02 · Tracing', link: '/reference/tutorials/02-tracing' },
	{ text: '03 · Context', link: '/reference/tutorials/03-context' },
	{ text: '04 · Protocol typing', link: '/reference/tutorials/04-protocol-typing' },
	{ text: '05 · Hierarchy', link: '/reference/tutorials/05-hierarchy' },
	{ text: '06 · Entry & exit', link: '/reference/tutorials/06-transitions-entry-exit' },
	{ text: '07 · Internal transitions', link: '/reference/tutorials/07-internal-transitions' },
	{ text: '08 · Post & sync', link: '/reference/tutorials/08-post-and-sync' },
	{ text: '09 · Deferred post', link: '/reference/tutorials/09-deferred-post' },
	{ text: '10 · Call services', link: '/reference/tutorials/10-call-services' },
	{ text: '11 · Restore', link: '/reference/tutorials/11-restore' },
	{ text: '12 · Error recovery', link: '/reference/tutorials/12-error-recovery' },
	{ text: '13 · Async handlers', link: '/reference/tutorials/13-async-handlers' },
	{ text: '14 · Nested machines', link: '/reference/tutorials/14-nested-machines' },
	{ text: '15 · Complex workflow', link: '/reference/tutorials/15-complex-workflow' },
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
	description: 'Samek/QP-style hierarchical state machine for TypeScript — reference manual, tutorials, API',
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
