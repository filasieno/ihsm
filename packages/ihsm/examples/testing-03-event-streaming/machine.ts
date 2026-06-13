/**
 * Event-streaming source behind a Port — "listen" / "stop listening" for mouse moves.
 *
 * The same shape applies to any push source you cannot control the timing of: a file watcher,
 * a network socket, a WebSocket / SSE feed, or OS input. All of it lives behind a {@link ihsm.Port}
 * so the machine stays pure and tests can deliver the stream deterministically.
 *
 * - Public protocol: `listen`, `stopListening` (what a UI button posts).
 * - Internal protocol: `onMouseMove` (what the *source* pushes inward — never posted by clients).
 * - Port: `subscribe()` opens the stream and returns a `ResultWithSubscription` whose `dispose()`
 *   closes it. Disposing is how "stop listening" guarantees the source goes quiet.
 */
import * as ihsm from '../../src';
import * as self from './machine';

export interface Point {
	x: number;
	y: number;
}

export interface MouseCtx {
	moves: Point[];
	listening: boolean;
	streamId: number;
	/** Teardown handle for the active stream; owned by the machine. */
	subscription?: ihsm.Disposable;
}

export interface MouseConfig {
	context: MouseCtx;
notifications: {
		listen(): void;
		stopListening(): void;
	};
	internalNotifications: {
		onMouseMove(x: number, y: number): void;
	};
	port: {
		subscribe(): ihsm.ResultWithSubscription<number>;
	};
}

export type MousePublic = ihsm.ActorNotificationsOf<MouseConfig>;

export type MouseInternal = ihsm.ActorInternalNotificationsOf<MouseConfig>;

/** Outbound boundary to the (impure) event source. */
export type MouseStreamPort = ihsm.DomainPortOf<MouseConfig>;


/**
 * Root state. The "wrong state" cases are safe no-ops so the live demo never crashes:
 * a move that arrives while idle, or a redundant listen/stop, is simply ignored.
 */
export class MouseTop extends ihsm.TopState<MouseConfig> {

	listen(): void {} // ignored unless Idle
	stopListening(): void {} // ignored unless Listening
	onMouseMove(_x: number, _y: number): void {} // ignored unless Listening
}

@ihsm.InitialState
export class Idle extends MouseTop {
	listen(): void {
		const { value, subscription } = this.hsm.port.subscribe();
		this.ctx.streamId = value;
		this.ctx.subscription = subscription;
		this.ctx.listening = true;
		this.hsm.transition(Listening);
	}
}

export class Listening extends MouseTop {
	onMouseMove(x: number, y: number): void {
		this.ctx.moves.push({ x, y });
	}

	stopListening(): void {
		this.ctx.subscription?.dispose();
		this.ctx.subscription = undefined;
		this.ctx.listening = false;
		this.hsm.transition(Idle);
	}
}

ihsm.registerStateNames(self);

export function freshCtx(): MouseCtx {
	return { moves: [], listening: false, streamId: 0 };
}
