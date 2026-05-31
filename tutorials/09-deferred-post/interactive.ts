import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Reminder machine',
	topState: machine.ReminderTop,
	machineExports: machine,
	initialCtx: { message: '' },
	messages: [
		{
			id: 'scheduleReminder',
			label: 'scheduleReminder',
			kind: 'post',
			fields: [{ name: 'text', label: 'Reminder text', type: 'string', default: 'Buy milk' }],
		},
		{
			id: 'deliver',
			label: 'deliver',
			kind: 'post',
			fields: [{ name: 'text', label: 'Deliver text', type: 'string', default: 'Buy milk' }],
		},
	],
	stateSummary: sm => `State: ${sm.currentStateName} · message: "${sm.ctx.message}"`,
});
