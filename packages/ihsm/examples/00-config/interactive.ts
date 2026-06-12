import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Config & handles',
	topState: machine.ConnTop,
	machineExports: machine,
	initialCtx: { host: '', frameCount: 0 },
	messages: [
		{ id: 'open', label: 'open(host)', kind: 'notification', fields: [{ name: 'host', label: 'host', type: 'string', default: 'dev.local' }] },
		{ id: 'close', label: 'close', kind: 'notification' },
		{ id: 'fetchFrames', label: 'fetchFrames(limit)', kind: 'service', fields: [{ name: 'limit', label: 'limit', type: 'number', default: 8 }] },
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · host: ${sm.ctx.host} · frames: ${sm.ctx.frameCount}`,
});
