/**
 * defer — schedule deliver after 50ms without blocking scheduleReminder.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface ReminderCtx {
	message: string;
}

export interface ReminderConfig {
	context: ReminderCtx;
	notifications: {
		scheduleReminder(text: string): void;
		deliver(text: string): void;
	};
}

export class ReminderTop extends PlaygroundTopState<ReminderConfig> {
	scheduleReminder(text: string): void {
		// Returns immediately; deliver is enqueued when the timer fires.
		this.hsm.port.defer(50).deliver(text);
	}

	deliver(text: string): void {
		this.ctx.message = text;
	}
}

@ihsm.InitialState
export class Waiting extends ReminderTop {}

ihsm.registerStateNames(self);

export function createReminder() {
	return makeTestActor(ReminderTop, { message: '' }, new ihsm.Port());
}
