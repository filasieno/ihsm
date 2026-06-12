import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Lamp machine',
	topState: machine.LampTop,
	machineExports: machine,
	initialCtx: { brightness: 50, entryCount: 0 },
	messages: [
		{
			id: 'dim',
			label: 'dim',
			kind: 'notification',
			fields: [{ name: 'delta', label: 'Delta', type: 'number', default: 10 }],
		},
		{
			id: 'brighten',
			label: 'brighten',
			kind: 'notification',
			fields: [{ name: 'delta', label: 'Delta', type: 'number', default: 10 }],
		},
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · brightness: ${sm.ctx.brightness} · entryCount: ${sm.ctx.entryCount}`,
});
