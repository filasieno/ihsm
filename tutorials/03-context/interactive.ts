import { singleSenderTutorial } from '../_shared/interactive-helpers';
import { CounterTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Counter machine',
	topState: CounterTop,
	initialCtx: { value: 0, step: 1 },
	messages: [
		{ id: 'increment', label: 'increment', kind: 'post' },
		{ id: 'decrement', label: 'decrement', kind: 'post' },
		{ id: 'reset', label: 'reset', kind: 'post' },
	],
	stateSummary: sm => `State: ${sm.currentStateName} · value: ${sm.ctx.value} · step: ${sm.ctx.step}`,
});
