import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Worker machine',
	topState: machine.WorkerTop,
	machineExports: machine,
	initialCtx: { failures: 0, recovered: 0 },
	messages: [
		{ id: 'risky', label: 'risky', kind: 'post' },
		{ id: 'unknown', label: 'unknown', kind: 'post' },
	],
	stateSummary: sm => `State: ${sm.currentStateName} · failures: ${sm.ctx.failures} · recovered: ${sm.ctx.recovered}`,
});
