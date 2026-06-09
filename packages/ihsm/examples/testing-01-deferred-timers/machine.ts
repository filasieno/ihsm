/**
 * Deferred timers & simulated time — the foundational deterministic-testing example.
 *
 * A `Heartbeat` machine emits one tick **every hour**. It does not own a domain port: the hourly
 * follow-up is scheduled with {@link ihsm.State.deferredPost | deferredPost}, which is backed by
 * the machine's **standard port timer service** ({@link ihsm.Port} in production, real
 * `setTimeout`). Because the timer is a port service, a test can substitute a controllable clock
 * ({@link ihsm.TestPort}) and simulate days of ticks in microseconds — no real waiting, no
 * flakiness.
 *
 * - Public protocol: `start`, `stop` — what a client posts.
 * - Internal protocol: `onTick` — raised only by the deferred timer, never by a client.
 *
 * The two protocols are disjoint (enforced at compile time), so `onTick` never appears on the
 * public {@link ihsm.Actor} surface.
 */
import * as ihsm from '../../src';
import * as self from './machine';

/** One hour, in milliseconds — the tick interval. */
export const HOUR_MS = 60 * 60 * 1000;

/** Mutable domain data shared across all states (a class, constructed fresh per actor). */
export class HeartbeatCtx {
	/** Number of hourly ticks observed so far. */
	ticks = 0;
	/** Whether the heartbeat is currently running. */
	running = false;
}

/** Public protocol — the only events clients may post. */
export interface HeartbeatPublic {
	start(): void;
	stop(): void;
}

/** Internal protocol — raised only by the deferred timer (never by a client). */
export interface HeartbeatInternal {
	onTick(): void;
}

/** Root state. Stray events in the "wrong" state are safe no-ops. */
export class HeartbeatTop extends ihsm.TopState<HeartbeatCtx, HeartbeatPublic, HeartbeatInternal, undefined> {
	start(): void {} // ignored unless Stopped
	stop(): void {} // ignored unless Running
	onTick(): void {} // ignored unless Running (e.g. a tick scheduled just before stop)
}

@ihsm.InitialState
export class Stopped extends HeartbeatTop {
	start(): void {
		this.ctx.running = true;
		this.transition(Running);
	}
}

export class Running extends HeartbeatTop {
	/** On entry, arm the first hourly tick through the port timer service. */
	onEntry(): void {
		this.deferredPost(HOUR_MS, 'onTick');
	}

	onTick(): void {
		this.ctx.ticks += 1;
		this.deferredPost(HOUR_MS, 'onTick'); // recur: arm the next hour
	}

	stop(): void {
		this.ctx.running = false;
		this.transition(Stopped);
	}
}

ihsm.registerStateNames(self);
