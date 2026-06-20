import type { SidebarsConfig } from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
	docs: [
		'intro',
		{
			type: 'category',
			label: 'Guide',
			collapsed: false,
			items: ['guide/overview', 'guide/quickstart', 'guide/quickstart-browser', 'guide/installation', 'guide/instrumentation', 'guide/testing', 'guide/console'],
		},
		{
			type: 'category',
			label: 'Reference',
			collapsed: false,
			items: ['reference/model', 'reference/signals', 'reference/attributes', 'reference/status'],
		},
	],
};

export default sidebars;
