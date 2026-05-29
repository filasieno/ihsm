import { HsmFactory, HsmInitialState, HsmTopState } from '../../src';

export interface ReminderCtx {
	message: string;
}

export interface ReminderProtocol {
	scheduleReminder(text: string): void;
	deliver(text: string): void;
}

export class ReminderTop extends HsmTopState<ReminderCtx, ReminderProtocol> implements ReminderProtocol {
	scheduleReminder(text: string): void {
		this.deferredPost(50, 'deliver', text);
	}

	deliver(text: string): void {
		this.ctx.message = text;
	}
}

@HsmInitialState
export class Waiting extends ReminderTop {}

export const reminderFactory = new HsmFactory(ReminderTop);

export function createReminder() {
	return reminderFactory.create({ message: '' });
}
