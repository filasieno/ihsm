import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { themes as prismThemes } from 'prism-react-renderer';
import type { Config, LoadContext, Plugin } from '@docusaurus/types';

const require = createRequire(import.meta.url);
const siteDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(siteDir, '..');
const tutorialsDir = path.join(repoRoot, 'tutorials');

function ihsmSourcesPlugin(_context: LoadContext): Plugin {
	return {
		name: 'ihsm-sources',
		configureWebpack() {
			return {
				resolve: {
					alias: {
						'@ihsm': path.join(repoRoot, 'src'),
						'@tutorials': tutorialsDir,
					},
				},
				module: {
					rules: [
						{
							test: /\.tsx?$/,
							include: [path.join(repoRoot, 'src'), tutorialsDir],
							use: {
								loader: require.resolve('swc-loader'),
								options: {
									// Chained after Docusaurus babel-loader in dev; emit maps babel accepts.
									parseMap: true,
									sourceMaps: true,
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

function copyrightYear(): number {
	const epoch = process.env.SOURCE_DATE_EPOCH;
	if (epoch) {
		return new Date(Number(epoch) * 1000).getUTCFullYear();
	}
	return new Date().getFullYear();
}

const config: Config = {
	title: 'ihsm',
	tagline: 'An idiomatic hierarchical state machine package for TypeScript',
	url: 'https://filasieno.github.io',
	baseUrl: '/ihsm/',
	organizationName: 'filasieno',
	projectName: 'ihsm',
	onBrokenLinks: 'throw',
	onBrokenAnchors: 'throw',
	markdown: {
		hooks: {
			onBrokenMarkdownLinks: 'throw',
		},
	},
	i18n: { defaultLocale: 'en', locales: ['en'] },
	presets: [
		[
			'classic',
			{
				docs: {
					path: 'docs',
					routeBasePath: '/',
					sidebarPath: './sidebars.ts',
					editUrl: 'https://github.com/filasieno/ihsm/tree/master/website/',
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
				{
					type: 'docSidebar',
					sidebarId: 'docs',
					position: 'left',
					label: 'Documentation',
				},
				{
					href: 'https://github.com/filasieno/ihsm',
					label: 'GitHub',
					position: 'right',
				},
			],
		},
		footer: {
			style: 'dark',
			copyright: `Copyright © ${copyrightYear()} ihsm contributors · MIT License`,
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.dracula,
			additionalLanguages: ['typescript'],
		},
	},
};

export default config;
