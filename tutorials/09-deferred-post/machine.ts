import * as ihsm from '../../src';
import * as self from './machine';

export interface ReminderCtx {
	message: string;
}

export interface ReminderProtocol {
	scheduleReminder(text: string): void;
	deliver(text: string): void;
}

export class ReminderTop extends ihsm.TopState<ReminderCtx, ReminderProtocol> implements ReminderProtocol {
	scheduleReminder(text: string): void {
		this.deferredPost(50, 'deliver', text);
	}

	deliver(text: string): void {
		this.ctx.message = text;
	}
}

@ihsm.InitialState
export class Waiting extends ReminderTop {}

ihsm.registerStateNames(self); // grabs every exported state automatically

export function createReminder() {
	return ihsm.makeHsm(ReminderTop, { message: '' });
}
