import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Door machine',
	topState: machine.DoorTop,
	machineExports: machine,
	initialCtx: { openCount: 0 },
	messages: [
		{ id: 'open', label: 'open', kind: 'notification' },
		{ id: 'close', label: 'close', kind: 'notification' },
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · openCount: ${sm.ctx.openCount}`,
});
