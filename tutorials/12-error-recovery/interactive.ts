import { singleSenderTutorial } from '../_shared/interactive-helpers';
import { WorkerTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Worker machine',
	topState: WorkerTop,
	initialCtx: { failures: 0, recovered: 0 },
	messages: [
		{ id: 'risky', label: 'risky', kind: 'post' },
		{ id: 'unknown', label: 'unknown', kind: 'post' },
	],
	stateSummary: sm => `State: ${sm.currentStateName} · failures: ${sm.ctx.failures} · recovered: ${sm.ctx.recovered}`,
});
