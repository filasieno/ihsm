import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Thermostat machine',
	topState: machine.ThermostatTop,
	machineExports: machine,
	initialCtx: { celsius: 18 },
	messages: [
		{
			id: 'setTarget',
			label: 'setTarget',
			kind: 'notification',
			fields: [{ name: 'celsius', label: 'Target °C', type: 'number', default: 22 }],
		},
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · target: ${sm.ctx.celsius}°C`,
});
