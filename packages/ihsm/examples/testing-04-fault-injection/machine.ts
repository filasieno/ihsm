/**
 * Fault injection & seeded Deterministic Simulation Testing (DST).
 *
 * The point of DST is to make *failure* reproducible. A worker performs an operation that can
 * fail (a flaky RPC, a disk hiccup) and retries up to a budget. The flakiness lives entirely in
 * the {@link ihsm.Port}, driven by a **seeded** pseudo-random generator — never `Math.random()`
 * or the clock. Same seed ⇒ identical fault sequence ⇒ a red test you can replay byte-for-byte.
 *
 * - Public protocol: `run()` — kick off the operation.
 * - Internal protocol: `onResult(ok)` — the outcome of one attempt, pushed by the port.
 * - Port: `attempt(n)` performs attempt `n` and reports back via the inbound poster.
 */
import * as ihsm from '../../src';
import * as self from './machine';

export interface WorkerCtx {
	/** Total attempts allowed before giving up. */
	maxAttempts: number;
	/** Attempts made so far. */
	attempts: number;
	/** Human-readable outcome of each attempt — handy for golden-trace assertions. */
	log: string[];
}

export interface WorkerConfig {
	context: WorkerCtx;
notifications: {
		run(): void;
	};
	internalNotifications: {
		onResult(ok: boolean): void;
	};
	port: {
		attempt(n: number): void;
	};
}

export type WorkerPublic = ihsm.ActorNotificationsOf<WorkerConfig>;

export type WorkerInternal = ihsm.ActorInternalNotificationsOf<WorkerConfig>;

/** Outbound boundary to the impure, occasionally-failing operation. */
export type FaultPort = ihsm.DomainPortOf<WorkerConfig>;


/** Root state. A stray `onResult` outside `Working` is a safe no-op. */
export class WorkerTop extends ihsm.TopState<WorkerConfig> {

	run(): void {} // ignored unless Idle/Succeeded/Failed
	onResult(_ok: boolean): void {} // ignored unless Working
}

@ihsm.InitialState
export class Idle extends WorkerTop {
	run(): void {
		this.ctx.attempts = 1;
		this.ctx.log = [];
		this.hsm.port.attempt(this.ctx.attempts);
		this.hsm.transition(Working);
	}
}

export class Working extends WorkerTop {
	onResult(ok: boolean): void {
		this.ctx.log.push(`attempt ${this.ctx.attempts}: ${ok ? 'ok' : 'fail'}`);
		if (ok) {
			this.hsm.transition(Succeeded);
			return;
		}
		if (this.ctx.attempts < this.ctx.maxAttempts) {
			this.ctx.attempts += 1;
			this.hsm.port.attempt(this.ctx.attempts); // retry — result comes back as another onResult
			return;
		}
		this.hsm.transition(Failed);
	}
}

/** A re-runnable terminal: `run()` (inherited from the top) restarts the operation. */
export class Succeeded extends WorkerTop {
	run(): void {
		Idle.prototype.run.call(this);
	}
}

export class Failed extends WorkerTop {
	run(): void {
		Idle.prototype.run.call(this);
	}
}

ihsm.registerStateNames(self);

export function freshCtx(maxAttempts = 5): WorkerCtx {
	return { maxAttempts, attempts: 0, log: [] };
}
