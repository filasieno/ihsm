import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { themes as prismThemes } from 'prism-react-renderer';
import type { Config } from '@docusaurus/types';

const siteDir = path.dirname(fileURLToPath(import.meta.url));

function copyrightYear(): number {
	const epoch = process.env.SOURCE_DATE_EPOCH;
	return epoch ? new Date(Number(epoch) * 1000).getUTCFullYear() : new Date().getFullYear();
}

const config: Config = {
	title: '@ihsm/otel',
	tagline: 'OpenTelemetry traces and logs for ihsm actors',
	url: 'https://filasieno.github.io',
	baseUrl: '/ihsm-otel/',
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
					editUrl:
						'https://github.com/filasieno/ihsm/tree/master/packages/otel/website/docs-src/',
				},
				blog: false,
				theme: {
					customCss: path.join(siteDir, 'src/css/custom.css'),
				},
			},
		],
	],
	themeConfig: {
		colorMode: {
			defaultMode: 'dark',
			disableSwitch: false,
			respectPrefersColorScheme: true,
		},
		navbar: {
			title: '@ihsm/otel',
			items: [
				{ to: '/', label: 'Home', position: 'left' },
				{ to: '/guide/overview', label: 'Guide', position: 'left' },
				{ to: '/reference/model', label: 'Reference', position: 'left' },
				{ href: 'https://github.com/filasieno/ihsm', label: 'GitHub', position: 'right' },
			],
		},
		footer: {
			style: 'dark',
			copyright: `Copyright © ${copyrightYear()} ihsm contributors · MIT License`,
		},
		prism: {
			theme: prismThemes.github,
			darkTheme: prismThemes.oneDark,
			additionalLanguages: ['typescript', 'bash', 'json'],
		},
	},
};

export default config;
