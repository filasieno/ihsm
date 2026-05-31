import { singleSenderTutorial } from '../shared/interactive-helpers';
import { PingTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Traced ping machine',
	topState: PingTop,
	initialCtx: { pings: 0 },
	messages: [{ id: 'ping', label: 'ping', kind: 'post' }],
	stateSummary: sm => `State: ${sm.currentStateName} · pings: ${sm.ctx.pings}`,
});
