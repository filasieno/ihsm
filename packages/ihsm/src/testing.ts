/**
 * `ihsm/testing` — deterministic-simulation testing utilities for ihsm.
 *
 * This entry point is **separate from the core runtime** (`ihsm`): the mock-port machinery,
 * the manual virtual clock, and the full-access test actor live here so they are never bundled
 * into production code that only imports `ihsm`. Import test helpers from `ihsm/testing`:
 *
 * ```ts
 * import { makeActor, TopState } from 'ihsm';            // production code
 * import { makeTestActor, mock, TestPort } from 'ihsm/testing'; // tests only
 * ```
 *
 * For convenience this module also re-exports the entire core API, so a test file may import
 * everything it needs from `ihsm/testing` alone.
 *
 * @packageDocumentation
 */
import { Port, TraceLevel, spawnActor, kMachine, Machine, defaultDispatchErrorCallback, defaultInitialize, defaultTraceWriter } from './internal/runtime';
import type { Any, Disposable, EventObserver, MachinePortInput, TracedMessage, ActorOptions, ActorConfig, ActorContextOf, ActorConfigOf, DomainPortOf, ChildActor, TestHsm, TopStateArg, ValidatedTopStateArg } from './internal/types';

interface HandleOwn extends Record<symbol | string, unknown> {
	[kMachine]: unknown;
	ctx: unknown;
	hsm: unknown;
}

export * from './index';

/**
 * Full-access test actor returned by {@link makeTestActor} for **deterministic testing**.
 *
 * Same faceted surface as {@link ChildActor} (`notify`, `notifyNow`, `call`, `hsm`), with
 * `hsm.port` and `hsm.subscribe` for test instrumentation.
 *
 * @typeParam C - Machine config bag (plain interface satisfying {@link ActorConfig})
 *
 * @category State machine
 */
export type TestActor<C extends ActorConfig = ActorConfig> = ChildActor<C> & {
	ctx: ActorContextOf<C>;
	hsm: TestHsm<C>;
};

/**
 * An actor-like handle that can be drained by {@link settleAll}.
 *
 * Any actor exposing `hsm.sync()` is compatible. When `hsm.subscribe()` is also available
 * (e.g. {@link TestActor}), {@link settleAll} can detect quiescence and return `settled: true`.
 *
 * @category Testing
 */
export type SettlingActor = {
	hsm: {
		sync(): Promise<void>;
		subscribe?: (observer: EventObserver) => Disposable;
	};
};

/**
 * Options for {@link settleAll}.
 *
 * @category Testing
 */
export interface SettleAllOptions {
	/**
	 * Hard cap on drain rounds.
	 *
	 * Each round calls `sync()` on all actors once.
	 * @defaultValue `8`
	 */
	readonly maxRounds?: number;
	/**
	 * Number of consecutive no-event rounds required to declare quiescence.
	 *
	 * Applies only when all actors expose `hsm.subscribe()`.
	 * @defaultValue `1`
	 */
	readonly idleRounds?: number;
	/**
	 * Microtask turns awaited after each round.
	 *
	 * Helps flush promise chains that enqueue follow-up work.
	 * @defaultValue `1`
	 */
	readonly microtaskTurns?: number;
}

/**
 * Result returned by {@link settleAll}.
 *
 * @category Testing
 */
export interface SettleAllResult {
	/** Number of rounds that were executed. */
	readonly rounds: number;
	/**
	 * True when observed quiescence was reached.
	 *
	 * False means either:
	 * - at least one actor lacked `hsm.subscribe()` (settlement is unobservable), or
	 * - `maxRounds` was hit before enough idle rounds were observed.
	 */
	readonly settled: boolean;
}

function isSettlingActor(value: unknown): value is SettlingActor {
	return typeof value === 'object' && value !== null && 'hsm' in value && typeof (value as { hsm?: { sync?: unknown } }).hsm?.sync === 'function';
}

/**
 * Drain a set of actors until quiescence is observed, or until `maxRounds` is reached.
 *
 * This is a **testing** helper: it coordinates repeated `sync()` calls across a small actor system
 * and reports whether a stable idle round was observed.
 *
 * - If every actor exposes `hsm.subscribe()` (e.g. via {@link makeTestActor}), quiescence is
 *   detected by observing no emitted events for `idleRounds` consecutive rounds.
 * - If any actor lacks `hsm.subscribe()`, settlement cannot be observed reliably; the helper still
 *   runs `maxRounds` drain rounds and returns `{ settled: false }`.
 *
 * `options` is the last argument when provided.
 *
 * @example
 * ```ts
 * const a = makeTestActor(A, ctxA, new TestPort());
 * const b = makeTestActor(B, ctxB, new TestPort());
 * a.notify.go();
 * const { settled } = await settleAll(a, b);
 * expect(settled).equals(true);
 * ```
 *
 * @category Testing
 */
export async function settleAll(...actors: SettlingActor[]): Promise<SettleAllResult>;
export async function settleAll(...args: [...SettlingActor[], SettleAllOptions]): Promise<SettleAllResult>;
export async function settleAll(...args: Array<SettlingActor | SettleAllOptions>): Promise<SettleAllResult> {
	if (args.length === 0) {
		return { rounds: 0, settled: true };
	}
	const last = args[args.length - 1];
	const hasOptions = !isSettlingActor(last);
	const options = (hasOptions ? (last as SettleAllOptions) : {}) as SettleAllOptions;
	const actorArgs = (hasOptions ? args.slice(0, -1) : args) as SettlingActor[];
	const actors = actorArgs.filter(isSettlingActor);
	const maxRounds = Math.max(1, options.maxRounds ?? 8);
	const idleRoundsTarget = Math.max(1, options.idleRounds ?? 1);
	const microtaskTurns = Math.max(0, options.microtaskTurns ?? 1);
	if (actors.length === 0) return { rounds: 0, settled: true };
	const observable = actors.every(actor => typeof actor.hsm.subscribe === 'function');
	const subscriptions: Disposable[] = [];
	let rounds: number;
	let idleRounds = 0;
	let observedEvents = 0;
	try {
		if (observable) {
			for (const actor of actors) {
				const sub = actor.hsm.subscribe!((): void => {
					observedEvents += 1;
				});
				subscriptions.push(sub);
			}
		}
		for (rounds = 1; rounds <= maxRounds; rounds += 1) {
			const before = observedEvents;
			await Promise.all(actors.map(actor => actor.hsm.sync()));
			for (let turn = 0; turn < microtaskTurns; turn += 1) {
				await Promise.resolve();
			}
			if (!observable) continue;
			const emitted = observedEvents > before;
			idleRounds = emitted ? 0 : idleRounds + 1;
			if (idleRounds >= idleRoundsTarget) {
				return { rounds, settled: true };
			}
		}
		return { rounds: maxRounds, settled: false };
	} finally {
		for (const sub of subscriptions) {
			sub.dispose();
		}
	}
}

/**
 * Abstract base class for **mock ports** used in deterministic tests.
 *
 * Extends {@link Port} (so it inherits the lazily-bound {@link Port.actor | actor} and
 * {@link Port.defer | defer}) and adds:
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
 * Like `Port`, it takes the root {@link TopState} as its single type argument. Subclass it
 * (with `@`{@link mock}) to stub domain port methods; instantiate it directly when you only need
 * deterministic timers and randomness.
 *
 * @typeParam T - The machine's root {@link TopState} subclass (e.g. `ConnTop`)
 *
 * @example A minimal mock port (records outbound calls; the test drives internal events)
 * ```ts
 * class MockConnPort extends ihsmTest.TestPort<typeof ConnTop> implements ConnPort {
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
 * await conn.notify.open('host');
 * await conn.hsm.sync();
 * port.send('onConnected', 1);   // the test decides when the server "replies"
 * ```
 *
 * @category Testing
 */
type VirtualTimer = { id: number; at: number; callback: () => void; repeat?: number };

export class TestPort<T extends TopStateArg = TopStateArg> extends Port<T> {
	private readonly _messages: TracedMessage[] = [];
	private readonly _preloads = new Map<string, { queue: Array<(...args: unknown[]) => unknown>; fallback?: (...args: unknown[]) => unknown; calls: unknown[][] }>();
	private _now = 0;
	private _virtualTimerId = 0;
	private readonly _timers: VirtualTimer[] = [];
	private readonly _cancelled = new Set<number>();
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

	/**
	 * Push an **inbound** internal notification into the bound actor (`port.actor.onData(…)`).
	 *
	 * Convenience for deterministic tests — equivalent to calling the generated method on
	 * {@link Port.actor} after the factory has wired it.
	 */
	send(event: string, ...payload: unknown[]): void {
		const actor = this.actor as { notify?: Record<string, ((...args: unknown[]) => void) | undefined> } | undefined;
		const facet = actor?.notify;
		const inbound = facet?.[event];
		if (inbound === undefined) {
			throw new Error(`ihsm: TestPort.send — actor has no notification "${event}" (bind the port with makeActor/makeTestActor first)`);
		}
		inbound.call(facet, ...payload);
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
	setTimeout(callback: () => void, millis?: number): number {
		const id = ++this._virtualTimerId;
		this._timers.push({ id, at: this._now + Math.max(0, millis ?? 0), callback });
		this._sortTimers();
		return id;
	}

	/** @inheritdoc Port.clearTimeout */
	clearTimeout(id: number | undefined): void {
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
	setInterval(callback: () => void, millis?: number): number {
		const id = ++this._virtualTimerId;
		const repeat = Math.max(0, millis ?? 0);
		this._timers.push({ id, at: this._now + repeat, callback, repeat });
		this._sortTimers();
		return id;
	}

	/** @inheritdoc Port.clearInterval */
	clearInterval(id: number | undefined): void {
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
 * method, so scripts stay type-safe. Pushing inbound observations uses
 * {@link TestPort.send | send} on the port.
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
 * **port method** (inferred from the machine's {@link TopState} via {@link DomainPortOf}) upgraded to
 * a scriptable, introspectable {@link Stubbed} method.
 *
 * @typeParam P - The mock port class instance type
 * @typeParam C - The machine {@link ActorConfig} bag (inferred from the port's {@link TestPort} type param)
 *
 * @category Testing
 */
export type Mock<P, C extends ActorConfig = ActorConfig> = P & {
	[K in keyof DomainPortOf<C>]: DomainPortOf<C>[K] extends (...args: infer A) => infer R ? Stubbed<A, R> : DomainPortOf<C>[K];
};

/** Inferred {@link ActorConfig} from a {@link TestPort}'s root state type parameter. */
export type ActorConfigFromPortClass<P> = P extends TestPort<infer M> ? ActorConfigOf<M> : ActorConfig;

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

/** Port method names registered by {@link mock} (abstract members have no runtime prototype entries). */
const MOCK_METHODS = Symbol('ihsm.mockMethods');

type MockMarkedCtor = abstract new (...args: Any[]) => TestPort<TopStateArg> & {
	[MOCK_MARKER]?: boolean;
	[MOCK_METHODS]?: readonly string[];
};

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
 * abstract class WatcherMock extends ihsmTest.TestPort<typeof WatcherTop> {
 *   abstract watch(path: string): ihsm.ResultWithSubscription<number>; // signature matches the port
 * }
 *
 * const port = ihsmTest.makeTestPort(WatcherMock);
 * port.watch.default(path => ({ value: 1, subscription: { dispose: () => port.record('dispose') } }));
 * ```
 *
 * @category Testing
 */
function markMockPort(Ctor: MockMarkedCtor, methodNames: readonly string[]): void {
	(Ctor as { [MOCK_MARKER]?: boolean })[MOCK_MARKER] = true;
	(Ctor as { [MOCK_METHODS]?: readonly string[] })[MOCK_METHODS] = [...methodNames];
}

/** Decorate an abstract {@link TestPort} subclass; pass port method names (abstract members are type-only at runtime). */
export function mock<C extends abstract new (...args: Any[]) => TestPort<TopStateArg>>(Ctor: C): C;
export function mock(...methodNames: string[]): <C extends abstract new (...args: Any[]) => TestPort<TopStateArg>>(Ctor: C) => C;
export function mock<C extends abstract new (...args: Any[]) => TestPort<TopStateArg>>(first: C | string, ...rest: string[]): C | ((Ctor: C) => C) {
	if (typeof first === 'function') {
		markMockPort(first as MockMarkedCtor, []);
		return first;
	}
	const methodNames = [first, ...rest];
	return (Ctor: C): C => {
		markMockPort(Ctor as MockMarkedCtor, methodNames);
		return Ctor;
	};
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
function installPortStubs(port: TestPort<TopStateArg>, PortClass: MockMarkedCtor): void {
	const stubTarget = port as unknown as StubTarget;
	const names = (PortClass as { [MOCK_METHODS]?: readonly string[] })[MOCK_METHODS] ?? [];
	for (const name of names) {
		if (NON_STUB_PROPS.has(name)) continue;
		(port as unknown as Record<string, unknown>)[name] = buildMethodStub(stubTarget, name);
	}
}

export function makeTestPort<P extends TestPort<TopStateArg>, C extends ActorConfig = ActorConfigFromPortClass<P>>(PortClass: abstract new () => P, _topState?: TopStateArg<C>): Mock<P, C> {
	if ((PortClass as { [MOCK_MARKER]?: boolean })[MOCK_MARKER] !== true) {
		throw new Error('ihsm: makeTestPort requires a class decorated with @ihsm.mock');
	}
	const port = new (PortClass as unknown as new () => P)();
	installPortStubs(port, PortClass);
	return port as Mock<P, C>;
}

/**
 * Creates a **full-access** actor for deterministic tests: merged protocol + typed `port`.
 *
 * Identical construction to {@link makeActor} (same three mandatory arguments + {@link ActorOptions}),
 * but the returned {@link TestActor} exposes the full child protocol (including internal buckets) and
 * grants typed access to `port` for asserting outbound interactions or pushing observations.
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
export function makeTestActor<T extends TopStateArg<ActorConfig>>(topState: ValidatedTopStateArg<T>, ctx: ActorContextOf<ActorConfigOf<T>>, port?: MachinePortInput<ActorConfigOf<T>>, options: ActorOptions<ActorConfigOf<T>> = {}): TestActor<ActorConfigOf<T>> {
	type C = ActorConfigOf<T>;
	const boundPort = (port ?? new TestPort<T>()) as MachinePortInput<ActorConfigOf<T>>;
	// Tests default to the most verbose trace (so a failing run is fully readable). Never silence to
	// a production level here — the user opts down explicitly via `options.traceLevel`.
	const { initialize = defaultInitialize, traceLevel = TraceLevel.VERBOSE_DEBUG, traceWriter = defaultTraceWriter, dispatchErrorCallback = defaultDispatchErrorCallback, ...rest } = options;
	const actor = spawnActor('test', topState as TopStateArg<C>, ctx, boundPort, {
		initialize,
		traceLevel,
		traceWriter,
		dispatchErrorCallback,
		...rest,
	});
	const machine = (actor as unknown as HandleOwn)[kMachine] as Machine<C>;
	const testHsm = actor.hsm as TestHsm<C>;
	Object.defineProperties(testHsm, {
		port: { enumerable: true, get: () => boundPort },
		subscribe: {
			enumerable: true,
			value: (observer: EventObserver) => machine.subscribe(observer),
		},
	});
	return actor as TestActor<C>;
}
