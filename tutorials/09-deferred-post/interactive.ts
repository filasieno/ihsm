import { singleSenderTutorial } from '../_shared/interactive-helpers';
import { ReminderTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Reminder machine',
	topState: ReminderTop,
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
