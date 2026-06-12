import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Traced ping machine',
	topState: machine.PingTop,
	machineExports: machine,
	initialCtx: { pings: 0 },
	messages: [{ id: 'ping', label: 'ping', kind: 'notification' }],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · pings: ${sm.ctx.pings}`,
});
