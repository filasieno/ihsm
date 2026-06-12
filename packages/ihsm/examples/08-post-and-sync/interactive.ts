import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Queue machine',
	topState: machine.QueueTop,
	machineExports: machine,
	initialCtx: { events: [] },
	messages: [
		{ id: 'start', label: 'start', kind: 'notification' },
		{ id: 'tick', label: 'tick', kind: 'notification' },
		{ id: 'done', label: 'done', kind: 'notification' },
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · events: [${sm.ctx.events.join(', ')}]`,
});
