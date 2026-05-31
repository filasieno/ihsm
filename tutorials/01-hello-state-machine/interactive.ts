import { singleSenderTutorial } from '../_shared/interactive-helpers';
import { DoorTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Door machine',
	topState: DoorTop,
	initialCtx: { openCount: 0 },
	messages: [
		{ id: 'open', label: 'open', kind: 'post' },
		{ id: 'close', label: 'close', kind: 'post' },
	],
	stateSummary: sm => `State: ${sm.currentStateName} · openCount: ${sm.ctx.openCount}`,
});
