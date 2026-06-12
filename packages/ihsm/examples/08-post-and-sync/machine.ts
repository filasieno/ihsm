/**
 * post + sync — chained hsm.actor notifications from a handler; client waits with one sync().
 *
 * Teaches: deferred posts until handler completes; sync marker drains the queue.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface QueueCtx {
	/** Append-only log of handler names — order proves run-to-completion serialization. */
	events: string[];
}

export interface QueueConfig extends ihsm.Config {
	context: QueueCtx;
	notifications: {
		start(): void;
		tick(): void;
		done(): void;
	};
}

const queueManifest = ihsm.manifestFor<QueueConfig>({
	services: [],
	notifications: ['start', 'tick', 'done'],
	internalServices: [],
	internalNotifications: [],
});

export class QueueTop extends PlaygroundTopState<QueueConfig> {
	static readonly manifest = queueManifest;
	declare readonly __ihsm: QueueConfig;

	start(): void {
		this.ctx.events.push('start');
		// These run after start() returns — not inline during start.
		this.hsm.actor.tick();
		this.hsm.actor.tick();
		this.hsm.actor.done();
	}

	tick(): void {
		this.ctx.events.push('tick');
	}

	done(): void {
		this.ctx.events.push('done');
	}
}

@ihsm.InitialState
export class Idle extends QueueTop {}

ihsm.registerStateNames(self);

export function createQueueMachine() {
	return ihsm.makeOwnerActor(QueueTop, { events: [] }, new ihsm.Port());
}
