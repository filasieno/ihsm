/**
 * `ihsm/testing` — deterministic-simulation testing utilities for ihsm.
 *
 * This entry point is **separate from the core runtime** (`ihsm`): the mock-port machinery,
 * the manual virtual clock, and the full-access test actor live here so they are never bundled
 * into production code that only imports `ihsm`. Import test helpers from `ihsm/testing`:
 *
 * ```ts
 * import { makeHsm, TopState } from 'ihsm';            // production code
 * import { makeTestActor, mock, TestPort } from 'ihsm/testing'; // tests only
 * ```
 *
 * For convenience this module also re-exports the entire core API, so a test file may import
 * everything it needs from `ihsm/testing` alone.
 *
 * @packageDocumentation
 */
import { Any, ActorOptions, BasePort, Disjoint, Dispatch, Disposable, DispatchErrorCallback, EventObserver, Hsm, MachinePort, PortHandle, RandomService, TimerHandle, TopStateArg, TraceLevel, TracedMessage, defaultDispatchErrorCallback, defaultInitialize, defaultTraceWriter, makeHsm } from './index';

export * from './index';

/**
 * Full-access view returned by {@link makeTestActor} for **deterministic testing**.
 *
 * Exposes the merged {@link Dispatch} protocol — so a test can drive internal events
 * (`onSpawn`, `onExit`, …) directly without a live port — **plus** typed access to the
 * machine's `port` for asserting outbound calls or pushing observations.
 *
 * @typeParam Context - Domain context
 * @typeParam Protocol - Public protocol
 * @typeParam InternalProtocol - Internal (port-driven) protocol
 * @typeParam P - Port type
 *
 * @category State machine
 */
export type TestActor<Context = Any, Protocol extends {} | undefined = undefined, InternalProtocol extends {} = {}, P = undefined> = Hsm<Context, Dispatch<Protocol, InternalProtocol>> & {
	readonly port: P;
	/**
	 * Observe **every** event as it is posted through this machine — a capability unique to the
	 * test surface (it is intentionally absent from {@link Actor} / {@link Hsm}).
	 *
	 * The observer fires synchronously at post time with the event name and payload, capturing
	 * client posts, handler self-posts, and port-driven internal events alike. Wire it to
	 * {@link TestPort.record} when you want a golden trace on the port under test.
	 *
	 * @param observer - Callback receiving each {@link TracedMessage}
	 * @returns A {@link Disposable} that stops the observation
	 */
	subscribe(observer: EventObserver): Disposable;
};

/**
 * Abstract base class for **mock ports** used in deterministic tests.
 *
 * Extends {@link BasePort} (so it inherits the lazily-bound {@link BasePort.actor | actor},
 * {@link BasePort.hsm | hsm}, and {@link BasePort.send | send}) and adds:
 *
 * - **Mocked timer services** — the same {@link TestPort.setTimeout | setTimeout} /
 *   {@link TestPort.setInterval | setInterval} / {@link TestPort.clearTimeout | clearTimeout} /
 *   {@link TestPort.clearInterval | clearInterval} surface as {@link Port}, backed by a virtual
 *   clock the test drives with {@link TestPort.advance | advance}.
 * - **Mocked {@link RandomService}** — {@link TestPort.random | random} /
 *   {@link TestPort.cryptoRandom | cryptoRandom} / {@link TestPort.randomUUID | randomUUID} /
 *   {@link TestPort.getRandomValues | getRandomValues}, scriptable via
 *   {@link TestPort.feedRandom | feedRandom} / {@link TestPort.feedCryptoRandom | feedCryptoRandom} /
 *   {@link TestPort.feedUUID | feedUUID} / {@link TestPort.feedRandomBytes | feedRandomBytes}.
 *   Never touches `Math.random()` or `crypto.*` — defaults to `0` / zero UUID / zero bytes when unscripted.
 * - A recorded message log plus the assertion/utility surface tests need
 *   ({@link TestPort.messages | messages}, {@link TestPort.events | events},
 *   {@link TestPort.trace | trace}, {@link TestPort.clear | clear}, …).
 *
 * Like `BasePort`, it takes the root {@link TopState} as its single type argument. Subclass it
 * (with `@`{@link mock}) to stub domain port methods; instantiate it directly when you only need
 * deterministic timers and randomness.
 *
 * @typeParam T - The machine's root {@link TopState} subclass (e.g. `ConnTop`)
 *
 * @example A minimal mock port (records outbound calls; the test drives internal events)
 * ```ts
 * class MockConnPort extends ihsmTest.TestPort<ConnTop> implements ConnPort {
 *   private nextId = 1;
 *   connect(host: string): ihsm.ResultWithSubscription<number> {
 *     const id = this.nextId++;
 *     this.record('connect', host);   // log the outbound call — but do NOT emit here
 *     return { value: id, subscription: { dispose: () => this.record('dispose') } };
 *   }
 *   disconnect(id: number): void { this.record('disconnect', id); }
 * }
 * const port = new MockConnPort();
 * const conn = ihsm.makeActor(ConnTop, ctx, port);
 * conn.post('open', 'host'); await conn.sync();
 * port.send('onConnected', 1);   // the test decides when the server "replies"
 * ```
 *
 * @category Testing
 */
type VirtualTimer = { id: TimerHandle; at: number; callback: () => void; repeat?: number };

export class TestPort<T = Any> extends BasePort<T> implements RandomService {
	private readonly _messages: TracedMessage[] = [];
	private readonly _preloads = new Map<string, { queue: Array<(...args: unknown[]) => unknown>; fallback?: (...args: unknown[]) => unknown; calls: unknown[][] }>();
	private _now = 0;
	private _timerSeq = 0;
	private readonly _timers: VirtualTimer[] = [];
	private readonly _cancelled = new Set<TimerHandle>();
	private readonly _randomQueue: number[] = [];
	private readonly _cryptoRandomQueue: number[] = [];
	private readonly _uuidQueue: string[] = [];
	private readonly _byteQueue: number[] = [];

	/**
	 * Append an entry to the recorded message log (for assertions / golden traces).
	 *
	 * Callable both from inside the mock (e.g. a port method logging its outbound call) and from a
	 * test (e.g. a `Disposable.dispose` closure recording its own teardown into the trace).
	 *
	 * @param event - Event name or free-form label (e.g. `'connect'`, `'attempt 1: ok'`)
	 * @param payload - Optional values associated with the entry
	 */
	record(event: string, ...payload: unknown[]): void {
		this._messages.push({ event, payload: [...payload] });
	}

	private _slot(name: string): { queue: Array<(...args: unknown[]) => unknown>; fallback?: (...args: unknown[]) => unknown; calls: unknown[][] } {
		let slot = this._preloads.get(name);
		if (slot === undefined) {
			slot = { queue: [], calls: [] };
			this._preloads.set(name, slot);
		}
		return slot;
	}

	/** @internal Set the persistent implementation for a stubbed method (used by `method.default`). */
	_stubDefault(name: string, impl: (...args: unknown[]) => unknown): void {
		this._slot(name).fallback = impl;
	}

	/** @internal Queue a one-shot implementation for a stubbed method (used by `method.once`). */
	_stubOnce(name: string, impl: (...args: unknown[]) => unknown): void {
		this._slot(name).queue.push(impl);
	}

	/** @internal Clear a stubbed method's queued/persistent implementations and recorded calls (`method.reset`). */
	_stubReset(name: string): void {
		const slot = this._slot(name);
		slot.queue.length = 0;
		slot.fallback = undefined;
		slot.calls.length = 0;
	}

	/** @internal The live, typed list of argument tuples a stubbed method was called with (`method.calls`). */
	_stubCalls(name: string): unknown[][] {
		return this._slot(name).calls;
	}

	/**
	 * @internal Consume the next implementation for a stubbed method. Installed as the body of every
	 * `@`{@link mock}-stubbed method by {@link makeTestPort}; not called directly.
	 *
	 * The call is recorded first (globally in {@link trace} and in the method's {@link Stubbed.calls}),
	 * then one-shot stubs (queued via `method.once`) are consumed in order; otherwise the persistent
	 * `method.default` implementation runs. With neither set, a {@link PreloadError} naming the method
	 * is thrown.
	 *
	 * @param name - Port method name
	 * @param args - Arguments the machine passed to the method
	 * @throws {@link PreloadError} if nothing was stubbed for `name`
	 */
	_consumePreload(name: string, args: unknown[]): unknown {
		const slot = this._slot(name);
		slot.calls.push(args); // typed per-method record
		this.record(name, ...args); // global golden-trace record, even if unstubbed
		const impl = slot.queue.shift() ?? slot.fallback;
		if (impl === undefined) {
			throw new PreloadError(name);
		}
		return impl(...args);
	}

	/** Every recorded message, in order. */
	get messages(): readonly TracedMessage[] {
		return this._messages;
	}

	/** Just the recorded event names, in order. */
	get events(): readonly string[] {
		return this._messages.map(m => m.event);
	}

	/** Rendered `event` / `event:arg,arg` strings — convenient for `deep.equal` / `include`. */
	get trace(): readonly string[] {
		return this._messages.map(m => (m.payload.length > 0 ? `${m.event}:${m.payload.join(',')}` : m.event));
	}

	/** The most recently recorded message, or `undefined`. */
	get last(): TracedMessage | undefined {
		return this._messages[this._messages.length - 1];
	}

	/** Number of recorded messages. */
	get count(): number {
		return this._messages.length;
	}

	/** Clear the recorded message log. */
	clear(): void {
		this._messages.length = 0;
	}

	private _sortTimers(): void {
		this._timers.sort((a, b) => a.at - b.at || a.id - b.id);
	}

	/** @inheritdoc Port.setTimeout — backed by the virtual clock; fire with {@link TestPort.advance | advance}. */
	setTimeout(callback: () => void, millis?: number): TimerHandle {
		const id = ++this._timerSeq;
		this._timers.push({ id, at: this._now + Math.max(0, millis ?? 0), callback });
		this._sortTimers();
		return id;
	}

	/** @inheritdoc Port.clearTimeout */
	clearTimeout(id: TimerHandle | undefined): void {
		if (id === undefined) {
			return;
		}
		this._cancelled.add(id);
		const index = this._timers.findIndex(timer => timer.id === id);
		if (index >= 0) {
			this._timers.splice(index, 1);
		}
	}

	/** @inheritdoc Port.setInterval — backed by the virtual clock; fire with {@link TestPort.advance | advance}. */
	setInterval(callback: () => void, millis?: number): TimerHandle {
		const id = ++this._timerSeq;
		const repeat = Math.max(0, millis ?? 0);
		this._timers.push({ id, at: this._now + repeat, callback, repeat });
		this._sortTimers();
		return id;
	}

	/** @inheritdoc Port.clearInterval */
	clearInterval(id: TimerHandle | undefined): void {
		this.clearTimeout(id);
	}

	/**
	 * Advance the virtual clock by `millis`, firing every timer whose deadline is reached, in
	 * deadline order. Timers scheduled by a fired callback within the same window are **not** run
	 * until a later `advance` — mirroring how a deferred re-schedule lands on the next run-to-completion turn.
	 *
	 * @param millis - Virtual milliseconds to advance (negative values are clamped to `0`)
	 */
	advance(millis: number): void {
		const target = this._now + Math.max(0, millis);
		const due = this._timers.filter(timer => timer.at <= target && !this._cancelled.has(timer.id));
		this._timers.splice(0, due.length);
		for (const timer of due) {
			this._now = timer.at;
			timer.callback();
			if (timer.repeat !== undefined && !this._cancelled.has(timer.id)) {
				this._timers.push({ id: timer.id, at: this._now + timer.repeat, callback: timer.callback, repeat: timer.repeat });
			}
		}
		this._sortTimers();
		this._now = target;
	}

	/** Current virtual time, in milliseconds since construction. */
	get now(): number {
		return this._now;
	}

	/** Number of timers still pending (not yet fired or disposed). */
	get pending(): number {
		return this._timers.length;
	}

	/** Queue values returned by successive {@link TestPort.random | random} calls (FIFO). */
	feedRandom(...values: number[]): void {
		this._randomQueue.push(...values);
	}

	/** Queue values returned by successive {@link TestPort.cryptoRandom | cryptoRandom} calls (FIFO). */
	feedCryptoRandom(...values: number[]): void {
		this._cryptoRandomQueue.push(...values);
	}

	/** Queue values returned by successive {@link TestPort.randomUUID | randomUUID} calls (FIFO). */
	feedUUID(...values: string[]): void {
		this._uuidQueue.push(...values);
	}

	/** Queue bytes used to fill arrays in successive {@link TestPort.getRandomValues | getRandomValues} calls (FIFO). */
	feedRandomBytes(...bytes: number[]): void {
		this._byteQueue.push(...bytes);
	}

	/** Clear all scripted random queues ({@link TestPort.feedRandom | feedRandom} / {@link TestPort.feedCryptoRandom | feedCryptoRandom} / …). */
	resetRandom(): void {
		this._randomQueue.length = 0;
		this._cryptoRandomQueue.length = 0;
		this._uuidQueue.length = 0;
		this._byteQueue.length = 0;
	}

	/** @inheritdoc RandomService.random — queued values only; returns `0` when empty (never calls `Math.random`). */
	random(): number {
		const next = this._randomQueue.shift();
		return next ?? 0;
	}

	/** @inheritdoc RandomService.cryptoRandom — queued values only; returns `0` when empty (never calls `crypto.random`). */
	cryptoRandom(): number {
		const next = this._cryptoRandomQueue.shift();
		return next ?? 0;
	}

	/** @inheritdoc RandomService.randomUUID — queued values only; never calls `crypto.randomUUID`. */
	randomUUID(): string {
		return this._uuidQueue.shift() ?? '00000000-0000-0000-0000-000000000000';
	}

	/** @inheritdoc RandomService.getRandomValues — queued bytes only; never calls `crypto.getRandomValues`. */
	getRandomValues<T extends ArrayBufferView>(array: T): T {
		const view = new Uint8Array(array.buffer, array.byteOffset, array.byteLength);
		for (let index = 0; index < view.length; index++) {
			view[index] = this._byteQueue.shift() ?? 0;
		}
		return array;
	}
}

/**
 * Thrown when an abstract `@`{@link mock} port method is called but the test scripted no
 * implementation for it. The message names the method so the fix is obvious.
 *
 * @category Testing
 */
export class PreloadError extends Error {
	constructor(method: string) {
		super(`ihsm: '${method}()' was called but not stubbed — script it first with port.${method}.default(...) or port.${method}.once(...)`);
		this.name = 'PreloadError';
	}
}

/**
 * A scriptable abstract port method on a {@link makeTestPort} mock — the per-method analogue of
 * `jest.fn()` / Sinon stubs, fully typed from the machine's {@link TopState}.
 *
 * It stays **callable with the port method's exact signature** (so the machine invokes it normally),
 * and carries the scripting + introspection surface a test drives:
 *
 * - `default(impl)` — set the **persistent** implementation (every call runs it until replaced).
 * - `once(impl)` — queue a **one-shot** implementation, consumed by the next call; queue several to
 *   script a sequence. One-shots are consumed before the persistent `default`.
 * - `reset()` — clear queued/persistent implementations **and** the recorded {@link calls}.
 * - `calls` — the live, typed list of argument tuples this method was called with (`Parameters<F>[]`).
 *
 * Both `default` and `once` take a closure with the **same parameters and return type** as the port
 * method, so scripts stay type-safe. Pushing internal events *inward* remains the separate
 * {@link BasePort.send | send} channel.
 *
 * @typeParam A - The method's argument tuple (`Parameters<F>`)
 * @typeParam R - The method's return type (`ReturnType<F>`)
 *
 * @category Testing
 */
export interface Stubbed<A extends unknown[], R> {
	(...args: A): R;
	/** Set the persistent implementation run for every call (until replaced). Returns `this` for chaining. */
	default(impl: (...args: A) => R): this;
	/** Queue a one-shot implementation, consumed by the next call (FIFO). Returns `this` for chaining. */
	once(impl: (...args: A) => R): this;
	/** Clear all queued/persistent implementations and the recorded {@link calls}. Returns `this` for chaining. */
	reset(): this;
	/** Argument tuples this method was called with, in order — typed exactly as the port method's parameters. */
	readonly calls: readonly A[];
}

/**
 * The fully-wired mock type returned by {@link makeTestPort}: the mock class `P` itself, with each
 * **port method** (inferred from the machine's {@link TopState} via {@link MachinePort}) upgraded to
 * a scriptable, introspectable {@link Stubbed} method.
 *
 * @typeParam P - The mock port class instance type
 * @typeParam T - The machine's root {@link TopState} subclass
 *
 * @category Testing
 */
export type Mock<P, T> = P & {
	[K in keyof MachinePort<T>]: MachinePort<T>[K] extends (...args: infer A) => infer R ? Stubbed<A, R> : MachinePort<T>[K];
};

/** Property names the auto-stub must never synthesize — JS/test-framework probes and built-in port services. */
const NON_STUB_PROPS: ReadonlySet<string> = new Set(['then', 'catch', 'finally', 'toJSON', 'inspect', 'asymmetricMatch', '$$typeof', 'nodeType', 'setTimeout', 'setInterval', 'clearTimeout', 'clearInterval', 'random', 'cryptoRandom', 'randomUUID', 'getRandomValues', 'advance', 'now', 'pending', 'feedRandom', 'feedCryptoRandom', 'feedUUID', 'feedRandomBytes', 'resetRandom']);

interface StubTarget {
	_consumePreload(name: string, args: unknown[]): unknown;
	_stubDefault(name: string, impl: (...args: unknown[]) => unknown): void;
	_stubOnce(name: string, impl: (...args: unknown[]) => unknown): void;
	_stubReset(name: string): void;
	_stubCalls(name: string): unknown[][];
}

function buildMethodStub(target: StubTarget, name: string): unknown {
	const stub = (...args: unknown[]): unknown => target._consumePreload(name, args);
	stub.default = (impl: (...args: unknown[]) => unknown): unknown => {
		target._stubDefault(name, impl);
		return stub;
	};
	stub.once = (impl: (...args: unknown[]) => unknown): unknown => {
		target._stubOnce(name, impl);
		return stub;
	};
	stub.reset = (): unknown => {
		target._stubReset(name);
		return stub;
	};
	Object.defineProperty(stub, 'calls', { get: () => target._stubCalls(name), enumerable: false });
	return stub;
}

/** Marker set by {@link mock} so {@link makeTestPort} can verify the class was decorated. */
const MOCK_MARKER = Symbol('ihsm.mock');

/**
 * Class decorator that turns an **abstract** {@link TestPort} subclass into a preloadable mock.
 *
 * Declare each port method as an `abstract` member whose **signature matches the real port**, and
 * decorate the class with `@`{@link mock}. Instances (built with {@link makeTestPort}) then expose
 * every abstract method as a scriptable {@link Stubbed} method: it records each call and returns
 * whatever the test scripted with `method.default(...)` / `method.once(...)`. You never write a
 * method body — the behavior lives in the test, so one mock serves many scenarios.
 *
 * Concrete members (public fields holding device state, helper methods) are left untouched; only the
 * abstract port methods are auto-stubbed.
 *
 * @example
 * ```ts
 * @ihsmTest.mock
 * abstract class WatcherMock extends ihsmTest.TestPort<WatcherTop> {
 *   abstract watch(path: string): ihsm.ResultWithSubscription<number>; // signature matches the port
 * }
 *
 * const port = ihsmTest.makeTestPort(WatcherMock);
 * port.watch.default(path => ({ value: 1, subscription: { dispose: () => port.record('dispose') } }));
 * ```
 *
 * @category Testing
 */
export function mock<C extends abstract new (...args: Any[]) => TestPort<Any>>(Ctor: C): C {
	const Decorated = class extends (Ctor as unknown as new (...args: Any[]) => TestPort<Any>) {
		constructor(...args: Any[]) {
			super(...args);
			const stubs = new Map<string, unknown>();
			const proxy = new Proxy(this, {
				get(t, prop, receiver): unknown {
					if (typeof prop === 'string' && !(prop in t) && !NON_STUB_PROPS.has(prop)) {
						let stub = stubs.get(prop);
						if (stub === undefined) {
							stub = buildMethodStub(t as unknown as StubTarget, prop);
							stubs.set(prop, stub);
						}
						return stub;
					}
					return Reflect.get(t, prop, receiver);
				},
			});
			return proxy as unknown as TestPort<Any>;
		}
	};
	(Decorated as { [MOCK_MARKER]?: boolean })[MOCK_MARKER] = true;
	return Decorated as unknown as C;
}

/**
 * Instantiate an `@`{@link mock}-decorated mock class — the canonical way to build a test port.
 *
 * Pass the mock **class**; you get back a typed instance whose abstract port methods (inferred from
 * the machine's {@link TopState}) are scriptable {@link Stubbed} methods, ready for
 * `port.method.default(...)`. The port's `actor` is still bound lazily when you hand the instance to
 * {@link makeActor} / {@link makeTestActor}.
 *
 * @typeParam P - The mock class instance type (a {@link TestPort} subclass)
 * @param PortClass - The `@mock`-decorated mock class
 * @returns A scriptable {@link Mock} instance
 * @throws If `PortClass` was not decorated with `@`{@link mock}
 *
 * @example
 * ```ts
 * const port = ihsmTest.makeTestPort(WatcherMock);
 * port.watch.default(() => ({ value: 1, subscription: { dispose: () => port.send('onClosed') } }));
 * const sm = ihsmTest.makeTestActor(WatcherTop, new WatcherCtx(), port);
 * ```
 *
 * @category Testing
 */
export function makeTestPort<P extends TestPort<Any>>(PortClass: abstract new () => P): Mock<P, P extends { readonly __topState: infer T } ? T : never> {
	if ((PortClass as { [MOCK_MARKER]?: boolean })[MOCK_MARKER] !== true) {
		throw new Error('ihsm: makeTestPort requires a class decorated with @ihsm.mock');
	}
	return new (PortClass as unknown as new () => P)() as Mock<P, P extends { readonly __topState: infer T } ? T : never>;
}

/**
 * Creates a **full-access** actor for deterministic tests: merged protocol + typed `port`.
 *
 * Identical construction to {@link makeActor} (same three mandatory arguments + {@link ActorOptions}),
 * but the returned {@link TestActor} exposes the merged {@link Dispatch} protocol — so tests can
 * drive internal events directly (no live port required) — and grants typed access to `port` for
 * asserting outbound interactions or pushing observations.
 *
 * Unlike {@link makeActor}, `traceLevel` defaults to {@link TraceLevel.VERBOSE_DEBUG} so a failing
 * test is fully readable; opt down explicitly via `options.traceLevel` only when you need a quiet run.
 *
 * @typeParam Context - Domain context type
 * @typeParam Public - Public protocol
 * @typeParam Internal - Internal protocol
 * @typeParam P - Port type
 * @param topState - Root state class; `Context` / `Public` / `Internal` are inferred from it (see {@link TopStateArg})
 * @param ctx - Mutable domain object shared by all states
 * @param port - Outbound {@link Port} instance (its `actor` is bound by the factory)
 * @param options - Optional tuning: `initialize` / `traceLevel` / `traceWriter` / … (see {@link ActorOptions})
 * @returns A {@link TestActor} handle with full event + port access
 *
 * @example
 * ```ts
 * const sm = makeTestActor(ConnTop, new ConnCtx(), ihsmTest.makeTestPort(ConnMock));
 * ```
 *
 * @category Factory
 */
export function makeTestActor<Context, Public extends undefined | {}, Internal extends {} = {}, P extends PortHandle<Context, Internal> = TestPort>(topState: TopStateArg<Context, Public, Internal>, ctx: Context, port: P, options: ActorOptions<Context, Public, Internal> = {}, ..._disjointGuard: Disjoint<Public, Internal> extends true ? [] : [error: Disjoint<Public, Internal>]): TestActor<Context, Public, Internal, P> {
	// Tests default to the most verbose trace (so a failing run is fully readable). Never silence to
	// a production level here — the user opts down explicitly via `options.traceLevel`.
	const { initialize = defaultInitialize, traceLevel = TraceLevel.VERBOSE_DEBUG, traceWriter = defaultTraceWriter, dispatchErrorCallback = defaultDispatchErrorCallback } = options;
	const hsm = makeHsm<Context, Dispatch<Public, Internal>>(topState, ctx, initialize, traceLevel, traceWriter, dispatchErrorCallback as DispatchErrorCallback<Context, Dispatch<Public, Internal>>, port as unknown as PortHandle<Context, Dispatch<Public, Internal>>);
	return hsm as unknown as TestActor<Context, Public, Internal, P>;
}
