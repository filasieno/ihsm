import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Worker machine',
	topState: machine.WorkerTop,
	machineExports: machine,
	initialCtx: { failures: 0, recovered: 0 },
	messages: [
		{ id: 'risky', label: 'risky', kind: 'notification' },
		{ id: 'unknown', label: 'unknown', kind: 'notification' },
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · failures: ${sm.ctx.failures} · recovered: ${sm.ctx.recovered}`,
});
