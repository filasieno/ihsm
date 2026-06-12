import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Counter machine',
	topState: machine.CounterTop,
	machineExports: machine,
	initialCtx: { value: 0, step: 1 },
	messages: [
		{ id: 'increment', label: 'increment', kind: 'notification' },
		{ id: 'decrement', label: 'decrement', kind: 'notification' },
		{ id: 'reset', label: 'reset', kind: 'notification' },
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · value: ${sm.ctx.value} · step: ${sm.ctx.step}`,
});
