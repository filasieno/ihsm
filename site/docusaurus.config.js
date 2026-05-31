// @ts-check
const path = require('node:path');
const { themes: prismThemes } = require('prism-react-renderer');

const siteDir = __dirname;
const repoRoot = path.join(siteDir, '..');

/** @param {import('@docusaurus/types').LoadContext} _context */
function ihsmSourcesPlugin(_context) {
	return {
		name: 'ihsm-sources',
		configureWebpack(_config, _isServer) {
			return {
				resolve: {
					alias: {
						'@ihsm': path.join(repoRoot, 'src'),
						'@tutorials': path.join(repoRoot, 'tutorials'),
					},
				},
				module: {
					rules: [
						{
							test: /\.tsx?$/,
							include: [path.join(repoRoot, 'src'), path.join(repoRoot, 'tutorials')],
							use: {
								loader: require.resolve('swc-loader'),
								options: {
									jsc: {
										parser: {
											syntax: 'typescript',
											tsx: true,
											decorators: true,
										},
										transform: {
											react: { runtime: 'automatic' },
											legacyDecorator: true,
											decoratorMetadata: false,
										},
										target: 'es2020',
									},
								},
							},
						},
					],
				},
			};
		},
	};
}

/** @type {import('@docusaurus/types').Config} */
const config = {
	title: 'ihsm',
	tagline: 'An idiomatic hierarchical state machine package for TypeScript',
	url: 'https://filasieno.github.io',
	baseUrl: '/ihsm/',
	organizationName: 'filasieno',
	projectName: 'ihsm',
	onBrokenLinks: 'throw',
	onBrokenMarkdownLinks: 'warn',
	i18n: { defaultLocale: 'en', locales: ['en'] },
	presets: [
		[
			'classic',
			{
				docs: {
					path: path.join(siteDir, 'docs'),
					routeBasePath: '/',
					sidebarPath: path.join(siteDir, 'sidebars.js'),
					editUrl: 'https://github.com/filasieno/ihsm/tree/master/site/',
				},
				blog: false,
				theme: {
					customCss: path.join(siteDir, 'src/css/custom.css'),
				},
			},
		],
	],
	plugins: [ihsmSourcesPlugin],
	themeConfig: {
		navbar: {
			title: 'ihsm',
			items: [
				{ to: '/', label: 'Home', position: 'left' },
				{ to: '/reference', label: 'Reference', position: 'left' },
				{ to: '/tutorials', label: 'Tutorials', position: 'left' },
				{
					href: 'https://github.com/filasieno/ihsm',
					label: 'GitHub',
					position: 'right',
				},
			],
		},
		footer: {
			style: 'dark',
			copyright: `Copyright © ${new Date().getFullYear()} ihsm contributors · MIT License`,
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.dracula,
			additionalLanguages: ['typescript'],
		},
	},
};

module.exports = config;
