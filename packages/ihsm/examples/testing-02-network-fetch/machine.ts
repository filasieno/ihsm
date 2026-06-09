/**
 * Network fetch behind a Port — the canonical "I/O you don't control the timing of" case.
 *
 * A machine issues an HTTP request and reacts to the response *whenever it arrives*. The real
 * world here is `fetch()` against, say, `https://google.com`; in tests we never touch the
 * network. All of it lives behind a {@link ihsm.Port}:
 *
 * - Public protocol: `fetch(url)`, `cancel()`, and a `body` service clients may call.
 * - Internal protocol: `onResponse` / `onFailure` — pushed by the port when the request settles.
 *   (Note: `onFailure`, not `onError` — `onError` is a reserved ihsm lifecycle hook.)
 * - Port: `request(url)` returns a `ResultWithSubscription` whose `dispose()` aborts the request.
 *
 * The decisive trick for determinism: the mock lets the test choose *when* the response lands
 * (`flush()`), so "in flight" and "settled" are both reachable without a single timer.
 */
import * as ihsm from '../../src';
import * as self from './machine';

export interface FetchCtx {
	url: string;
	requestId: number;
	status: number;
	body: string;
	error: string;
	/** Abort handle for the in-flight request; owned by the machine. */
	subscription?: ihsm.Disposable;
}

/** Public protocol — what UI / clients may post or call. */
export interface FetchPublic {
	fetch(url: string): void;
	cancel(): void;
	body(resolve: ihsm.ResolveCallback<string>, reject: ihsm.RejectCallback): void;
}

/** Internal protocol — settled-request events, pushed by the port only. */
export interface FetchInternal {
	onResponse(status: number, body: string): void;
	onFailure(message: string): void;
}

/** Outbound boundary to the (impure) network. */
export interface FetchPort extends ihsm.PortHandle<FetchCtx, FetchInternal> {
	/** Start a request; `dispose()` on the result aborts it. Returns a request id. */
	request(url: string): ihsm.ResultWithSubscription<number>;
}

/**
 * Root state. `fetch` (start a request) is the shared behaviour of every *resting* state —
 * `Idle`, `Done`, `Failed` all inherit it — so a re-fetch from any settled state just works.
 * `Fetching` overrides `fetch` to a no-op to reject a second request while one is in flight.
 * Late settled-events (`onResponse` / `onFailure` after a `cancel`) are safe no-ops here.
 */
export class FetchTop extends ihsm.TopState<FetchCtx, FetchPublic, FetchInternal, FetchPort> {
	fetch(url: string): void {
		this.ctx.url = url;
		this.ctx.error = '';
		// All network I/O flows through the port — never `fetch()` directly in a handler.
		const { value, subscription } = this.port.request(url);
		this.ctx.requestId = value;
		this.ctx.subscription = subscription;
		this.transition(Fetching);
	}

	cancel(): void {} // ignored unless Fetching
	onResponse(_status: number, _body: string): void {} // ignored unless Fetching
	onFailure(_message: string): void {} // ignored unless Fetching

	/** Reading the last body is always allowed. */
	body(resolve: ihsm.ResolveCallback<string>): void {
		resolve(this.ctx.body);
	}
}

@ihsm.InitialState
export class Idle extends FetchTop {}

export class Done extends FetchTop {}

export class Failed extends FetchTop {}

export class Fetching extends FetchTop {
	fetch(_url: string): void {} // ignored: a request is already in flight

	onResponse(status: number, body: string): void {
		this.clearSubscription();
		this.ctx.status = status;
		this.ctx.body = body;
		this.transition(status >= 200 && status < 300 ? Done : Failed);
	}

	onFailure(message: string): void {
		this.clearSubscription();
		this.ctx.error = message;
		this.transition(Failed);
	}

	cancel(): void {
		this.clearSubscription();
		this.transition(Idle);
	}

	private clearSubscription(): void {
		this.ctx.subscription?.dispose();
		this.ctx.subscription = undefined;
	}
}

ihsm.registerStateNames(self);

export function freshCtx(): FetchCtx {
	return { url: '', requestId: 0, status: 0, body: '', error: '' };
}
