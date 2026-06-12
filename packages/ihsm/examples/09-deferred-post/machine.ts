/**
 * defer — schedule deliver after 50ms without blocking scheduleReminder.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface ReminderCtx {
	message: string;
}

export interface ReminderConfig extends ihsm.Config {
	context: ReminderCtx;
	notifications: {
		scheduleReminder(text: string): void;
		deliver(text: string): void;
	};
}

const reminderManifest = ihsm.manifestFor<ReminderConfig>({
	services: [],
	notifications: ['scheduleReminder', 'deliver'],
	internalServices: [],
	internalNotifications: [],
});

export class ReminderTop extends PlaygroundTopState<ReminderConfig> {
	static readonly manifest = reminderManifest;
	declare readonly __ihsm: ReminderConfig;

	scheduleReminder(text: string): void {
		// Returns immediately; deliver is enqueued when the timer fires.
		this.hsm.defer(50).deliver(text);
	}

	deliver(text: string): void {
		this.ctx.message = text;
	}
}

@ihsm.InitialState
export class Waiting extends ReminderTop {}

ihsm.registerStateNames(self);

export function createReminder() {
	return ihsm.makeOwnerActor(ReminderTop, { message: '' }, new ihsm.Port());
}
