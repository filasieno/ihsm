/**
 * Unified documentation topics: reference excerpts + optional interactive example (tutorial).
 * Order matches the learning path on the docs site.
 */

/** @typedef {{
 *   id: string,
 *   title: string,
 *   sidebarPosition: number,
 *   reference: Array<{ section: string, all?: boolean, subsections?: string[] }>,
 *   extraReference?: string,
 *   tutorial?: string,
 * }} TopicDef */

/** @type {TopicDef[]} */
export const topics = [
	{
		id: '01-hello-state-machine',
		title: 'Hello state machine',
		sidebarPosition: 1,
		reference: [
			{
				section: '1',
				subsections: ['State as class', 'Protocol', 'Actor mailbox', 'makeHsm'],
			},
		],
		tutorial: '01-hello-state-machine',
	},
	{
		id: '02-tracing',
		title: 'Tracing',
		sidebarPosition: 2,
		reference: [{ section: '6', all: true }],
		tutorial: '02-tracing',
	},
	{
		id: '03-context',
		title: 'Context',
		sidebarPosition: 3,
		reference: [
			{ section: '1', subsections: ['Context (`ctx`)'] },
			{ section: '2', subsections: ['Context'] },
		],
		tutorial: '03-context',
	},
	{
		id: '04-protocol-typing',
		title: 'Protocol typing',
		sidebarPosition: 4,
		reference: [{ section: '3', all: true }],
		tutorial: '04-protocol-typing',
	},
	{
		id: '05-hierarchy',
		title: 'Hierarchy & transitions',
		sidebarPosition: 5,
		reference: [
			{
				section: '2',
				subsections: [
					'Hierarchical states',
					'`@InitialState`',
					'Transitions and caching',
					'Entry and exit',
				],
			},
			{ section: '4', subsections: ['Reading UML statecharts'] },
			{ section: '5', all: true },
		],
		tutorial: '05-hierarchy',
	},
	{
		id: '07-internal-transitions',
		title: 'Internal transitions',
		sidebarPosition: 6,
		reference: [{ section: '2', subsections: ['Internal transitions', 'Guards'] }],
		tutorial: '07-internal-transitions',
	},
	{
		id: '08-post-and-sync',
		title: 'Post & sync',
		sidebarPosition: 7,
		reference: [{ section: '4', subsections: ['`post(event, ...payload)`', '`sync()`'] }],
		tutorial: '08-post-and-sync',
	},
	{
		id: '09-deferred-post',
		title: 'Deferred post',
		sidebarPosition: 8,
		reference: [{ section: '4', subsections: ['`deferredPost(millis, event, ...payload)`'] }],
		tutorial: '09-deferred-post',
	},
	{
		id: '10-call-services',
		title: 'Call services',
		sidebarPosition: 9,
		reference: [{ section: '4', subsections: ['`call(service, ...payload)` — typed request/response'] }],
		tutorial: '10-call-services',
	},
	{
		id: '11-restore',
		title: 'Restore',
		sidebarPosition: 10,
		reference: [
			{ section: '2', subsections: ['History'] },
			{ section: '7', all: true },
		],
		tutorial: '11-restore',
	},
	{
		id: '12-error-recovery',
		title: 'Error recovery',
		sidebarPosition: 11,
		reference: [{ section: '8', all: true }],
		tutorial: '12-error-recovery',
	},
	{
		id: '13-async-handlers',
		title: 'Async handlers',
		sidebarPosition: 12,
		reference: [{ section: '9', all: true }],
		tutorial: '13-async-handlers',
	},
	{
		id: '14-nested-machines',
		title: 'Nested machines',
		sidebarPosition: 13,
		reference: [{ section: '2', subsections: ['Orthogonal regions'] }],
		tutorial: '14-nested-machines',
	},
	{
		id: '15-complex-workflow',
		title: 'Complex workflow',
		sidebarPosition: 14,
		reference: [
			{
				section: '5',
				subsections: [
					'Transition taxonomy',
					'Sync vs async with transitions',
					'Errors during transitions',
					'Rules of thumb',
				],
			},
		],
		tutorial: '15-complex-workflow',
	},
	{
		id: '17-post-now',
		title: 'postNow',
		sidebarPosition: 15,
		reference: [{ section: '4', subsections: ['`postNow(event, ...payload)`'] }],
		tutorial: '17-post-now',
	},
	{
		id: 'make-hsm',
		title: 'makeHsm',
		sidebarPosition: 16,
		reference: [{ section: '10', all: true }],
	},
	{
		id: 'comparison-xstate',
		title: 'Comparison with XState',
		sidebarPosition: 17,
		reference: [{ section: '13', all: true }],
	},
];

export function topicById(id) {
	const topic = topics.find(t => t.id === id);
	if (!topic) throw new Error(`unknown topic id: ${id}`);
	return topic;
}
