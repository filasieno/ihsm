/** @type {import('@docusaurus/plugin-content-docs').SidebarsConfig} */
const sidebars = {
	docs: [
		'intro',
		{
			type: 'category',
			label: 'Reference',
			items: ['reference'],
		},
		{
			type: 'category',
			label: 'Interactive tutorials',
			link: { type: 'doc', id: 'tutorials/index' },
			items: ['tutorials/01-hello-state-machine', 'tutorials/02-tracing', 'tutorials/03-context', 'tutorials/04-protocol-typing', 'tutorials/05-hierarchy', 'tutorials/07-internal-transitions', 'tutorials/08-post-and-sync', 'tutorials/09-deferred-post', 'tutorials/10-call-services', 'tutorials/11-restore', 'tutorials/12-error-recovery', 'tutorials/13-async-handlers', 'tutorials/14-nested-machines', 'tutorials/15-complex-workflow', 'tutorials/16-then', 'tutorials/17-post-now'],
		},
	],
};

module.exports = sidebars;
