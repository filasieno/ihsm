import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Door machine',
	topState: machine.DoorTop,
	machineExports: machine,
	initialCtx: { openCount: 0 },
	messages: [
		{ id: 'open', label: 'open', kind: 'post' },
		{ id: 'close', label: 'close', kind: 'post' },
	],
	stateSummary: sm => `State: ${sm.currentStateName} · openCount: ${sm.ctx.openCount}`,
});
