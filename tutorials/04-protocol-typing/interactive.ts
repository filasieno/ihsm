import { singleSenderTutorial } from '../_shared/interactive-helpers';
import { ThermostatTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Thermostat machine',
	topState: ThermostatTop,
	initialCtx: { celsius: 18 },
	messages: [
		{
			id: 'setTarget',
			label: 'setTarget',
			kind: 'post',
			fields: [{ name: 'celsius', label: 'Target °C', type: 'number', default: 22 }],
		},
	],
	stateSummary: sm => `State: ${sm.currentStateName} · target: ${sm.ctx.celsius}°C`,
});
