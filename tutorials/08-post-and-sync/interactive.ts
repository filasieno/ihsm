import { singleSenderTutorial } from '../shared/interactive-helpers';
import { QueueTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Queue machine',
	topState: QueueTop,
	initialCtx: { events: [] },
	messages: [
		{ id: 'start', label: 'start', kind: 'post' },
		{ id: 'tick', label: 'tick', kind: 'post' },
		{ id: 'done', label: 'done', kind: 'post' },
	],
	stateSummary: sm => `State: ${sm.currentStateName} · events: [${sm.ctx.events.join(', ')}]`,
});
