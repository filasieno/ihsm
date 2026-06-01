import { HsmWithTracing, Instance } from './internal/defs.private';
import { HsmObject } from './internal/hsm';
import { hasInitialState, quoteError, defineStateName as defineStateNameInternal, getStateName } from './internal/utils';

/**
 * Default context type when a machine is created without an explicit `Context` generic.
 *
 * Equivalent to `Record<string, any>` — use a dedicated interface in production code so
 * `ctx` fields are checked at compile time.
 *
 * @category Factory
 */
export type Any = Record<string, any>;

/**
 * Rejects an in-flight {@link Hsm.call} service by rejecting the client's `Promise`.
 *
 * The runtime injects this callback as the **second** parameter of service handlers.
 * Call it with any `Error` (or subclass) when the service cannot complete successfully.
 * After `reject` is invoked, the client's `await call(...)` throws; no further handler
 * code should call `resolve`.
 *
 * @param error - Failure reason propagated to the `call()` caller
 *
 * @remarks
 * Pair with {@link ResolveCallback} on the same handler signature. Service methods are
 * recognized by the `(resolve, reject, ...payload)` parameter pattern on `Protocol`.
 *
 * @category Event handler
 */
export type RejectCallback = (error: Error) => void;

/**
 * Resolves an in-flight {@link Hsm.call} service with a typed reply.
 *
 * The runtime injects this callback as the **first** parameter of service handlers.
 * Call it exactly once with the successful result; the client's `Promise` settles with
 * that value. The handler's own return value (including `Promise<void>` from `async`
 * handlers) does **not** substitute for calling `resolve`.
 *
 * @typeParam Reply - Success type inferred from the service method's `resolve` parameter
 * @param result - Value delivered to the `call()` caller
 *
 * @remarks
 * For `async` service handlers, perform awaits first, then call `resolve(result)` before
 * returning. If you forget `resolve`, the client's `Promise` never settles.
 *
 * @category Event handler
 */
export type ResolveCallback<Reply> = (result: Reply) => void;

//
// Configuration
//

/**
 * Application hook invoked when the runtime cannot recover from a dispatch failure.
 *
 * Called **after** {@link StateEvents.onError} and {@link StateEvents.onUnhandled} have
 * been tried and the error is still propagating, or when no recovery hook handled it.
 * The default implementation logs via {@link TraceWriter} and **rethrows** the error.
 *
 * @param hsm - The machine handle (`Hsm` or handler `State` view) at failure time
 * @param err - The error that terminated dispatch (often {@link EventHandlerError},
 *   {@link UnhandledEventError}, {@link TransitionError}, or {@link FatalError})
 *
 * @remarks
 * Override at construction (`makeHsm(..., dispatchErrorCallback)`) or assign
 * `hsm.dispatchErrorCallback` for integration tests that must assert failures.
 * Note: {@link Hsm.sync} still resolves when the default callback throws — failures
 * surface in logs, not as a rejected `sync()` Promise.
 *
 * @category Factory
 */
export interface DispatchErrorCallback<Context, Protocol extends {} | undefined> {
	(hsm: Base<Context, Protocol>, err: Error): void;
}
// export type DispatchErrorCallback<Context, Protocol extends {} | undefined> = (hsm: Hsm<Context, Protocol>, traceWriter: TraceWriter, err: Error) => void;

/**
 * Controls how much diagnostic detail the runtime emits through {@link TraceWriter}.
 *
 * Set at construction via {@link makeHsm} or mutate {@link Properties.traceLevel} on a
 * live instance. Changing the level swaps the internal dispatch tracer implementation.
 *
 * @category Factory
 */
export enum TraceLevel {
	/**
	 * Production mode: minimal tracing overhead, no verbose dispatch steps.
	 * Use in hot paths and shipped bundles when trace output is disabled.
	 */
	PRODUCTION,
	/**
	 * Debug mode: transition boundaries, handler entry/exit, and error summaries.
	 * Default for {@link makeHsm}. Suitable for development and integration tests.
	 */
	DEBUG,
	/**
	 * Verbose debug: includes prototype-chain lookup walks, cache hits/misses, and
	 * nested trace domains. Use when correlating handler code with tutorial trace panels.
	 */
	VERBOSE_DEBUG,
}

/**
 * Sink for structured or human-readable trace output from the runtime and handlers.
 *
 * Inject a custom implementation via {@link makeHsm} to collect traces in tests,
 * forward to OpenTelemetry, or suppress console noise in CI.
 *
 * @category Factory
 */
export interface TraceWriter {
	/**
	 * Record one trace line for a machine instance.
	 *
	 * @typeParam Context - Domain context type of the machine being traced
	 * @typeParam Protocol - Event/service vocabulary of the machine being traced
	 * @param hsm - Read-only machine properties ({@link Properties.currentStateName},
	 *   {@link Properties.traceHeader}, etc.) at the time of the write
	 * @param msg - Payload to record. **Strings** are formatted as
	 *   `` `${traceHeader}${currentStateName}: ${msg}` `` by the default console writer;
	 *   non-strings are passed through unchanged (e.g. `Error` objects on failure paths)
	 *
	 * @remarks
	 * Handlers may call `this.traceWriter.write(this.hsm, 'my message')` for ad-hoc
	 * logging that respects the same header and state prefix as runtime traces.
	 */
	write<Context, Protocol extends {} | undefined>(hsm: Properties<Context, Protocol>, msg: any): void;
}

/**
 * Read-only snapshot of runtime metadata shared by client handles and active handlers.
 *
 * Exposed on {@link State} (inside handlers as `this.hsm` properties and forwarded
 * getters on {@link TopState}) and on {@link Hsm} (external client code). Values
 * reflect the **current dispatch** when read from within an event handler; outside
 * handlers, {@link eventName} and {@link eventPayload} are empty.
 *
 * @category State machine
 */
export interface Properties<Context, Protocol extends {} | undefined> {
	/**
	 * Constructor (`Function`) of the **leaf** state class currently executing.
	 *
	 * Compare with {@link topState}, which is always the root composite passed to
	 * {@link makeHsm}. After a transition, this updates to the new leaf's constructor.
	 */
	readonly currentState: StateClass<Context, Protocol>;

	/**
	 * Human-readable name of {@link currentState}.
	 *
	 * Sourced from {@link defineStateName} / {@link registerStateNames} when registered;
	 * otherwise `Class.name` (unreliable under minification — register names in browser builds).
	 */
	readonly currentStateName: string;

	/**
	 * Constructor of the root state class supplied to {@link makeHsm}.
	 *
	 * Constant for the lifetime of the instance unless you replace the entire machine.
	 */
	readonly topState: StateClass<Context, Protocol>;

	/** Display name of {@link topState} (same naming rules as {@link currentStateName}). */
	readonly topStateName: string;

	/**
	 * Runtime label derived from `ctx` constructor name, used as the first segment of
	 * {@link traceHeader} in verbose traces.
	 */
	readonly ctxTypeName: string;

	/**
	 * Prefix for nested trace domains, built from internal dispatch stack frames.
	 *
	 * Empty at the top level; grows like `domain|subdomain|` during nested operations.
	 * Handlers rarely need to read this directly — it is prepended automatically by
	 * the default {@link TraceWriter}.
	 */
	readonly traceHeader: string;

	/**
	 * Name of the event or service currently being dispatched.
	 *
	 * Matches the string passed to {@link Base.post}, {@link Hsm.call}, or
	 * {@link State.postNow}. Empty string when no handler is running.
	 */
	readonly eventName: string;

	/**
	 * Arguments passed with the current dispatch, excluding injected `resolve` / `reject`
	 * for {@link Hsm.call} services.
	 *
	 * Empty array when idle. Typed as `any[]` at runtime; correlate with
	 * {@link EventPayload} / {@link ServiceRequest} at compile time on the client.
	 */
	readonly eventPayload: any[];

	/**
	 * Active trace verbosity; changing this swaps dispatch tracing behavior immediately.
	 *
	 * @see TraceLevel
	 */
	traceLevel: TraceLevel;

	/**
	 * Destination for runtime and handler-initiated trace lines.
	 *
	 * Replaceable at any time (e.g. swap in a test double before `post`/`call`).
	 */
	traceWriter: TraceWriter;

	/**
	 * Last-resort error hook when {@link StateEvents.onError} / {@link StateEvents.onUnhandled}
	 * do not recover.
	 *
	 * @see DispatchErrorCallback
	 */
	dispatchErrorCallback: DispatchErrorCallback<Context, Protocol>;
}

/**
 * Fire-and-forget event posting API available on both {@link Hsm} (clients) and {@link State} (handlers).
 *
 * Events enqueue on the machine mailbox and run **one at a time** — no re-entrancy while a
 * handler is active.
 *
 * @category State machine
 */
export interface Base<Context, Protocol extends {} | undefined> extends Properties<Context, Protocol> {
	/**
	 * Enqueue a **normal-priority** event for later dispatch on the active state.
	 *
	 * Returns immediately; the handler runs asynchronously when the mailbox reaches this job.
	 * Dispatch walks the **prototype chain** from the current leaf upward until a method named
	 * `eventName` is found.
	 *
	 * @typeParam EventName - Literal key of `Protocol` being posted
	 * @param eventName - Event or service name. Must be `keyof Protocol` and must **not** collide
	 *   with reserved {@link State} method names (`transition`, `post`, `ctx`, …)
	 * @param eventPayload - Arguments tuple inferred from `Protocol[eventName]` handler parameters.
	 *   For **events**, pass every parameter **except** `resolve` / `reject`. For fire-and-forget
	 *   events, the handler return type must be `void` or `Promise<void>`
	 *
	 * @remarks
	 * **Client usage:** `door.post('open')` then `await door.sync()` to wait for completion.
	 *
	 * **Handler usage:** `this.post('tick')` schedules work **after** the current handler returns
	 * and after any {@link State.transition} it requested. Normal-priority posts run **after** all
	 * {@link State.postNow} hi-priority jobs drained for the current turn.
	 *
	 * **Ordering:** FIFO among normal-priority jobs. Multiple posts before one `sync()` are
	 * processed in submission order.
	 *
	 * **Typing:** With `Protocol extends undefined`, accepts any `string` and `any[]` (legacy mode).
	 *
	 * @example Client fire-and-forget
	 * ```ts
	 * door.post('open');
	 * await door.sync(); // handler + transition complete
	 * ```
	 *
	 * @example Handler chains follow-up work
	 * ```ts
	 * approve(): void {
	 *   this.ctx.approved = true;
	 *   this.post('notify'); // runs after this handler finishes
	 * }
	 * ```
	 */
	post<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void;

	/**
	 * Schedule a normal-priority {@link post} after a wall-clock delay.
	 *
	 * Uses `setTimeout` internally; when the timer fires, the event is enqueued like an ordinary
	 * `post`. Timers are **not** cancelled if the machine transitions or the scheduling handler throws.
	 *
	 * @typeParam EventName - Literal key of `Protocol` being scheduled
	 * @param millis - Delay in milliseconds before enqueueing (≥ 0). Subject to event-loop timer granularity
	 * @param eventName - Event name (same constraints as {@link post})
	 * @param eventPayload - Handler arguments tuple (same as {@link post})
	 *
	 * @remarks
	 * Available on {@link State} and {@link Hsm}. Typical pattern: handler schedules reminder,
	 * client waits with `await sleep(millis); await hsm.sync()`.
	 *
	 * Does **not** block the calling handler — returns as soon as the timer is registered.
	 *
	 * @example
	 * ```ts
	 * scheduleReminder(text: string): void {
	 *   this.deferredPost(50, 'deliver', text);
	 * }
	 * deliver(text: string): void {
	 *   this.ctx.message = text;
	 * }
	 * ```
	 */
	deferredPost<EventName extends keyof Protocol>(millis: number, eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void;
}

/**
 * Handler-facing API available inside state class methods (`this` / `this.hsm`).
 *
 * Extends {@link Base} with context access, transitions, async sleep, explicit unhandled
 * signaling, and {@link postNow} hi-priority re-dispatch. Only code running **inside** an
 * active handler should call {@link transition}, {@link unhandled}, or {@link postNow}.
 *
 * @category State machine
 */
export interface State<Context, Protocol extends {} | undefined> extends Base<Context, Protocol> {
	/**
	 * Mutable domain data object shared across all states of this machine instance.
	 *
	 * Passed as the second argument to {@link makeHsm}; survives transitions unless replaced
	 * by {@link Hsm.restore}. Update fields freely for internal transitions (no `transition()`).
	 *
	 * @remarks
	 * Context is **not** the active state name — state is which class prototype is active;
	 * context is arbitrary application data (counters, buffers, IDs, flags).
	 */
	readonly ctx: Context;

	/**
	 * Schedule an **external** transition to `nextState` after the current handler completes.
	 *
	 * Does **not** run exit/entry immediately. When the handler returns successfully (including
	 * after awaiting an `async` handler's Promise), the runtime:
	 *
	 * 1. Computes the **lowest common ancestor (LCA)** on the class prototype chain
	 * 2. Runs `onExit()` from the current leaf up to (but not including) the LCA
	 * 3. Switches the instance prototype to `nextState` (descending `@InitialState` chains for composites)
	 * 4. Runs `onEntry()` down from the LCA to the target leaf
	 *
	 * @param nextState - Destination state **class** constructor (not an instance)
	 *
	 * @throws {@link TransitionError} when `onExit` or `onEntry` throws along the path (may transition to {@link FatalErrorState})
	 * @throws {@link EventHandlerError} when the triggering handler threw before transition phase
	 *
	 * @remarks
	 * - **Self-transition** to the same leaf with unchanged initial descent: optimized to skip exit/entry
	 * - **Internal transition:** omit `transition()` — active class unchanged, no exit/entry
	 * - **`transition()` inside `onEntry`/`onExit`:** scheduled transition is **cleared** when that lifecycle dispatch ends — use {@link post} from `onEntry` for follow-up work
	 * - Transition paths are **cached** per `From=>To` pair for hot loops
	 * - Only the **last** `transition()` call wins if invoked multiple times in one handler
	 *
	 * @example
	 * ```ts
	 * open(): void {
	 *   this.ctx.openCount += 1;
	 *   this.transition(Open);
	 * }
	 * ```
	 */
	transition(nextState: StateClass<Context, Protocol>): void;

	/**
	 * Declare that the current event has **no handler** on this state (explicit super-call pattern).
	 *
	 * Throws {@link UnhandledEventError} unless an ancestor's {@link StateEvents.onUnhandled}
	 * catches it. Prefer **omitting** the method entirely when a state should inherit a parent's
	 * handler — only call `unhandled()` when you intentionally defer to the error model.
	 *
	 * @returns `never` — always throws or redirects via `onUnhandled`
	 *
	 * @throws {@link UnhandledEventError} by default
	 *
	 * @remarks
	 * Runtime dispatch already throws when no method exists on the prototype chain; `unhandled()`
	 * is for handlers that exist but choose not to handle the event.
	 */
	unhandled(): never;

	/**
	 * Pause the **current handler** without blocking the JavaScript event loop.
	 *
	 * Returns a Promise resolved after `millis` milliseconds via `setTimeout`. The mailbox
	 * remains **locked** to this handler until the Promise settles — other `post`/`call` jobs
	 * queue but do not run.
	 *
	 * @param millis - Sleep duration in milliseconds (≥ 0)
	 * @returns Promise that resolves (never rejects) when the delay elapses
	 *
	 * @remarks
	 * Use for simple delays inside handlers. For calendar-time deferral of **new** events,
	 * prefer {@link deferredPost}. Composable with `async` handlers: `await this.sleep(100)`.
	 *
	 * @example
	 * ```ts
	 * async pulse(): Promise<void> {
	 *   await this.sleep(50);
	 *   this.ctx.pulses += 1;
	 * }
	 * ```
	 */
	sleep(millis: number): Promise<void>;

	/**
	 * Enqueue a **hi-priority** event processed before normal {@link post} jobs from the same turn.
	 *
	 * Only valid **inside** a running handler (`this.postNow`). Clients must use {@link post}.
	 * Hi-priority jobs drain immediately after the current handler and its transition complete,
	 * **before** any normal-priority posts the handler enqueued (including chained `this.post`).
	 *
	 * @typeParam EventName - Literal key of `Protocol`
	 * @param eventName - Event name (same typing rules as {@link post})
	 * @param eventPayload - Handler arguments (same tuple as {@link post})
	 *
	 * @remarks
	 * Models **extended transitions**: multiple internal steps (lock, capture, validate) that
	 * must complete before deferred side effects. See tutorial `17-post-now`.
	 *
	 * Multiple `postNow` calls run in FIFO order within the hi-priority queue. You may need
	 * an extra {@link Hsm.sync} after the first to drain postNow follow-ups.
	 *
	 * @example
	 * ```ts
	 * confirm(): void {
	 *   this.post('cancel');           // normal — runs last
	 *   this.postNow('lockInventory'); // hi — runs first among follow-ups
	 *   this.postNow('capturePayment');
	 *   this.transition(Confirmed);
	 * }
	 * ```
	 */
	postNow<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void;
}

/**
 * Client handle returned by {@link makeHsm} — post events, await services, synchronize, restore.
 *
 * The same object is also the runtime actor (`HsmObject`); external code should treat it as
 * an **actor reference**: send messages, never mutate internal queues directly.
 *
 * @category State machine
 */
export interface Hsm<Context = Any, Protocol extends {} | undefined = undefined> extends Base<Context, Protocol> {
	/** @inheritdoc State.ctx */
	readonly ctx: Context;

	/**
	 * Wait until all previously enqueued mailbox work completes through a **sync marker**.
	 *
	 * Returns a Promise resolved when the marker job reaches the front of the queue and runs —
	 * meaning every job enqueued **before** this `sync()` call has finished (handlers, transitions,
	 * hi-priority drains, and previously scheduled timers that have already fired).
	 *
	 * @returns Promise that resolves when the queue drains up to the marker (does not reject on handler errors unless {@link dispatchErrorCallback} rethrows to caller)
	 *
	 * @remarks
	 * - **After `post`:** one `sync()` waits for that handler and its transition
	 * - **Batch posts:** single `sync()` waits for **all** jobs enqueued before it
	 * - **After chained handler `post`s:** call `sync()` again to drain follow-up work
	 * - **After `postNow` chains:** may require **two** `sync()` calls (handler + hi-priority drain)
	 * - **After `call`:** usually unnecessary — `await call(...)` already waits for `resolve`/`reject`
	 * - **Initialization:** `makeHsm(..., initialize: true)` enqueues init work; await `sync()` before asserting initial state
	 *
	 * @example
	 * ```ts
	 * door.post('open');
	 * await door.sync();
	 * expect(door.currentStateName).toBe('Open');
	 * ```
	 */
	sync(): Promise<void>;

	/**
	 * Atomically replace the active leaf state and context **without** running `onExit` / `onEntry`.
	 *
	 * Used for persistence rehydration, snapshot restore, time-travel debugging, and test fixtures.
	 * Does not enqueue mailbox jobs — the next `post`/`call` runs from the restored configuration.
	 *
	 * @param state - Leaf or composite state **class** to activate (prototype switched immediately)
	 * @param ctx - New context object (replaces {@link ctx} reference entirely)
	 *
	 * @remarks
	 * Caller is responsible for consistency: restored `ctx` should match what `state` expects.
	 * Does not walk `@InitialState` — if you restore a composite class, you get that exact class,
	 * not its default child. Queued jobs from before `restore` are **not** cancelled.
	 *
	 * @example
	 * ```ts
	 * checkpoint.restore(SavedState, savedCtx);
	 * await checkpoint.sync(); // drain any pre-restore jobs first if needed
	 * ```
	 */
	restore(state: StateClass<Context, Protocol>, ctx: Context): void;

	/**
	 * Invoke a **service** handler and await its typed result over the mailbox.
	 *
	 * Enqueues a dispatch job like {@link post}, but the runtime prepends `resolve` and `reject`
	 * callbacks to the handler invocation. The returned Promise settles when the handler calls
	 * `resolve(value)` or `reject(error)` — **not** when the handler function returns.
	 *
	 * @typeParam EventName - Literal service name on `Protocol`
	 * @param eventName - Service key whose handler signature starts with
	 *   `(resolve: ResolveCallback<T>, reject: RejectCallback, ...payload)`
	 * @param eventPayload - Request arguments **after** resolve/reject (client never passes callbacks)
	 * @returns Promise resolving to `T` inferred from the handler's `resolve` parameter type
	 *
	 * @throws Propagates any `Error` passed to `reject`, or {@link EventHandlerError} /
	 *   {@link UnhandledEventError} if dispatch fails before the service runs
	 *
	 * @remarks
	 * - Same **serialized** mailbox as `post` — no concurrent handler re-entrancy
	 * - Return type {@link ServiceResponse} is inferred from `Protocol[eventName]`
	 * - Use {@link ResolveCallback} / {@link RejectCallback} in handler signatures for clarity
	 * - `async` handlers should `await` work then call `resolve(result)`
	 *
	 * @example
	 * ```ts
	 * // Protocol: getBalance(resolve: ResolveCallback<number>, reject: RejectCallback): void
	 * const balance = await wallet.call('getBalance');
	 * ```
	 */
	call<EventName extends keyof Protocol>(eventName: ServiceName<Protocol, EventName>, ...eventPayload: ServiceRequest<Protocol, EventName>): Promise<ServiceResponse<Protocol, EventName>>;
}

/**
 * Valid first argument to {@link Base.post} / {@link State.postNow} — a protocol key that names
 * a **void** handler (event), excluding reserved {@link State} method names.
 *
 * @typeParam Protocol - Machine vocabulary interface, or `undefined` for untyped `string` mode
 * @typeParam EventName - Member key being constrained
 *
 * @remarks
 * Collisions with `keyof State` become `never`, preventing `post('transition', …)` at compile time.
 *
 * @category Event handler
 */
export type PostedEvent<Protocol extends {} | undefined, EventName extends keyof Protocol> = Protocol extends undefined ? string : EventName extends keyof State<any, any> ? never : EventName;

/**
 * Tuple of arguments for {@link Base.post} after the event name, inferred from the handler signature.
 *
 * @typeParam Protocol - Machine vocabulary interface
 * @typeParam EventName - Event key whose parameter list is extracted
 *
 * @remarks
 * For `open(): void`, payload is `[]`. For `setTarget(celsius: number): void`, payload is `[number]`.
 * Service-shaped methods (leading resolve/reject) are not valid events — payload becomes `never`.
 *
 * @category Event handler
 */
export type EventPayload<Protocol extends {} | undefined, EventName extends keyof Protocol> = Protocol extends undefined ? any[] : Protocol[EventName] extends (...payload: infer Payload) => Promise<void> | void ? (Payload extends any[] ? Payload : never) : never;

/**
 * Constructor type for a state class participating in the hierarchy.
 *
 * Satisfied by any `Function` whose `prototype` derives from {@link TopState}. Used wherever
 * the runtime expects a state **class**, not an instance:
 * {@link makeHsm}, {@link State.transition}, {@link InitialState}, {@link Hsm.restore}.
 *
 * @typeParam Context - Domain context carried by the machine
 * @typeParam Protocol - Event/service vocabulary
 *
 * @category State machine
 */
export type StateClass<Context = Any, Protocol extends {} | undefined = undefined> = Function & { prototype: TopState<Context, Protocol> };

/**
 * Tuple of client-supplied arguments to {@link Hsm.call}, excluding injected resolve/reject.
 *
 * @typeParam Protocol - Machine vocabulary interface
 * @typeParam EventName - Service key whose request parameters are extracted
 *
 * @remarks
 * Extracted from everything after `(resolve, reject, ...payload)` on the service method.
 *
 * @category Event handler
 */
export type ServiceRequest<Protocol, EventName extends keyof Protocol> = Protocol extends undefined ? any[] : Protocol[EventName] extends (resolve: (result: infer Reply) => void, reject: (error: infer Error) => void, ...payload: infer Payload) => Promise<void> | void ? (Payload extends any[] ? Payload : never) : never;

/**
 * Success type returned by {@link Hsm.call}, inferred from the service handler's `resolve` callback.
 *
 * @typeParam Protocol - Machine vocabulary interface
 * @typeParam EventName - Service key whose reply type is extracted
 *
 * @remarks
 * For `getBalance(resolve: (n: number) => void, …)`, response is `number`.
 *
 * @category Event handler
 */
export type ServiceResponse<Protocol, EventName extends keyof Protocol> = Protocol extends undefined ? any : Protocol[EventName] extends (resolve: infer Reply, reject: infer Error, ...payload: infer Payload) => Promise<void> | void ? Reply : never;

/**
 * Valid first argument to {@link Hsm.call} — protocol keys whose handlers use the service signature
 * `(resolve, reject, ...payload)`.
 *
 * @typeParam Protocol - Machine vocabulary interface
 * @typeParam EventName - Candidate key (unused generic for symmetry with other aliases)
 *
 * @category Event handler
 */
export type ServiceName<Protocol, EventName> = Protocol extends undefined ? string : EventName extends keyof State<any, any> ? never : EventName;

/**
 * Lifecycle hooks optionally overridden on state classes.
 *
 * Default implementations on {@link TopState} are empty for entry/exit and rethrow for errors.
 * Only states that **define their own** `onEntry`/`onExit` participate in verbose trace exit lists.
 *
 * @category State machine
 */
export interface StateEvents<Context, Protocol extends {} | undefined> {
	/**
	 * Invoked when **leaving** this state during an external transition.
	 *
	 * Runs during the exit phase **after** the triggering handler completes and before the
	 * prototype switches away. Async `onExit` is awaited before continuing up the LCA path.
	 *
	 * @throws {@link TransitionError} when this hook throws — may route to {@link FatalErrorState}
	 *
	 * @remarks
	 * Not called for internal transitions (handler returns without {@link State.transition}).
	 * Not called on {@link Hsm.restore}. Self-transitions may skip exit when optimized.
	 */
	onExit(): Promise<void> | void;

	/**
	 * Invoked when **entering** this state during initialization or an external transition.
	 *
	 * Runs during the entry phase after the prototype points at this state. Async `onEntry` is
	 * awaited before entering nested initial substates or running deeper `onEntry` hooks.
	 *
	 * @throws {@link TransitionError} or {@link InitializationError} when this hook throws
	 *
	 * @remarks
	 * During `makeHsm(..., initialize: true)`, `onEntry` runs from root down through each
	 * `@InitialState` chain to the initial leaf. Schedule follow-up transitions via {@link Base.post},
	 * not {@link State.transition}, from within `onEntry`.
	 */
	onEntry(): Promise<void> | void;

	/**
	 * Recovery hook when an event handler throws {@link EventHandlerError}.
	 *
	 * @typeParam EventName - Correlated event key from `Protocol`
	 * @param error - Typed runtime error with {@link RuntimeError.eventName},
	 *   {@link RuntimeError.eventPayload}, {@link HsmError.context}, and {@link HsmError.cause}
	 *
	 * @throws Rethrow to propagate; throwing here becomes {@link FatalError}
	 *
	 * @remarks
	 * Default {@link TopState} implementation rethrows. Override to log, transition to a safe
	 * state, or swallow. Uncaught errors invoke {@link Properties.dispatchErrorCallback}.
	 */
	onError<EventName extends keyof Protocol>(error: RuntimeError<Context, Protocol, EventName>): Promise<void> | void;

	/**
	 * Recovery hook when dispatch would raise {@link UnhandledEventError}.
	 *
	 * @typeParam EventName - Correlated event key from `Protocol`
	 * @param error - Describes the unmatched event and active state
	 *
	 * @throws Default {@link TopState} implementation rethrows → may enter `onError`
	 *
	 * @remarks
	 * Override to implement catch-all handlers, auditing, or transition to an error state
	 * without defining every event on every leaf.
	 */
	onUnhandled<EventName extends keyof Protocol>(error: UnhandledEventError<Context, Protocol, EventName>): Promise<void> | void;
}

/**
 * Abstract root class for every state in the hierarchy.
 *
 * States are **never constructed directly** — the runtime binds one instance object whose
 * prototype moves along the class chain. Subclass `TopState` (or a child state), implement
 * your `Protocol` methods, and pass the root class to {@link makeHsm}.
 *
 * Forwards {@link State} / {@link Properties} APIs and default {@link StateEvents} behavior.
 *
 * @category State machine
 */
export abstract class TopState<Context = Any, Protocol extends {} | undefined = undefined> implements State<Context, Protocol>, StateEvents<Context, Protocol> {
	/** Domain context (injected by runtime — do not assign in constructors). */
	readonly ctx!: Context;
	/** Handler view of the machine (`this` inside methods delegates here for core operations). */
	readonly hsm!: State<Context, Protocol>;
	constructor() {
		throw new Error('Fatal error: States cannot be instantiated');
	}
	/** @inheritdoc Properties.eventName */
	get eventName(): string {
		return this.hsm.eventName;
	}
	/** @inheritdoc Properties.eventPayload */
	get eventPayload(): any[] {
		return this.hsm.eventPayload;
	}
	/** @inheritdoc Properties.traceHeader */
	get traceHeader(): string {
		return this.hsm.traceHeader;
	}
	/** @inheritdoc Properties.topState */
	get topState(): StateClass<Context, Protocol> {
		return this.hsm.topState;
	}
	/** @inheritdoc Properties.currentStateName */
	get currentStateName(): string {
		return this.hsm.currentStateName;
	}
	/** @inheritdoc Properties.currentState */
	get currentState(): StateClass<Context, Protocol> {
		return this.hsm.currentState;
	}
	/** @inheritdoc Properties.ctxTypeName */
	get ctxTypeName(): string {
		return this.hsm.ctxTypeName;
	}
	/** @inheritdoc Properties.traceLevel */
	set traceLevel(value: TraceLevel) {
		this.hsm.traceLevel = value;
	}
	/** @inheritdoc Properties.traceLevel */
	get traceLevel(): TraceLevel {
		return this.hsm.traceLevel;
	}
	/** @inheritdoc Properties.topStateName */
	get topStateName(): string {
		return this.hsm.topStateName;
	}
	/** @inheritdoc Properties.traceWriter */
	get traceWriter(): TraceWriter {
		return this.hsm.traceWriter;
	}
	/** @inheritdoc Properties.traceWriter */
	set traceWriter(value) {
		this.hsm.traceWriter = value;
	}

	/** @inheritdoc Properties.dispatchErrorCallback */
	get dispatchErrorCallback() {
		return this.hsm.dispatchErrorCallback;
	}
	/** @inheritdoc Properties.dispatchErrorCallback */
	set dispatchErrorCallback(value) {
		this.hsm.dispatchErrorCallback = value;
	}
	/** @inheritdoc State.transition */
	transition(nextState: StateClass<Context, Protocol>): void {
		this.hsm.transition(nextState);
	}
	/** @inheritdoc State.unhandled */
	unhandled(): never {
		this.hsm.unhandled();
	}
	/** @inheritdoc State.sleep */
	sleep(millis: number): Promise<void> {
		return this.hsm.sleep(millis);
	}
	/** @inheritdoc Base.post */
	post<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void {
		this.hsm.post(eventName, ...eventPayload);
	}
	/** @inheritdoc Base.deferredPost */
	deferredPost<EventName extends keyof Protocol>(millis: number, eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void {
		this.hsm.deferredPost(millis, eventName, ...eventPayload);
	}
	/** @inheritdoc State.postNow */
	postNow<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void {
		this.hsm.postNow(eventName, ...eventPayload);
	}

	/** @inheritdoc StateEvents.onExit */
	onExit(): Promise<void> | void {}

	/** @inheritdoc StateEvents.onEntry */
	onEntry(): Promise<void> | void {}

	/** @inheritdoc StateEvents.onError */
	onError<EventName extends keyof Protocol>(error: RuntimeError<Context, Protocol, EventName>): Promise<void> | void {
		throw error;
	}

	/** @inheritdoc StateEvents.onUnhandled */
	onUnhandled<EventName extends keyof Protocol>(error: UnhandledEventError<Context, Protocol, EventName>): Promise<void> | void {
		throw error;
	}
}

/**
 * Base class for all ihsm runtime errors carrying machine context.
 *
 * @typeParam Context - Domain context at failure time
 * @typeParam Protocol - Vocabulary type (for typed subclasses)
 *
 * @category Error
 */
export abstract class HsmError<Context, Protocol extends {} | undefined> extends Error {
	/** Discriminator matching the class name (`EventHandlerError`, etc.). */
	name: string;
	/** {@link Properties.topStateName} when the error was constructed. */
	topStateName: string;
	/** {@link Properties.currentStateName} when the error was constructed. */
	stateName: string;
	/** Snapshot of {@link State.ctx} when the error was constructed. */
	context: Context;
	/** Original thrown value when this error wraps a handler or lifecycle failure. */
	cause?: Error;

	protected constructor(name: string, hsm: State<Context, Protocol>, message: string, cause?: Error) {
		super(message);
		this.name = name;
		this.topStateName = hsm.topStateName;
		this.stateName = hsm.currentStateName;
		this.context = hsm.ctx;
		this.cause = cause;
	}
}

/**
 * Error base for failures during **event dispatch**, with correlated event metadata.
 *
 * @typeParam Context - Domain context
 * @typeParam Protocol - Vocabulary interface
 * @typeParam EventName - Event or service key being processed
 *
 * @category Error
 */
export abstract class RuntimeError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends HsmError<Context, Protocol> {
	/** Event or service name that was active when the failure occurred. */
	eventName: PostedEvent<Protocol, EventName>;
	/** Client-supplied arguments (excluding resolve/reject for services). */
	eventPayload: EventPayload<Protocol, EventName>;

	protected constructor(errorName: string, hsm: State<Context, Protocol>, message: string, cause?: Error) {
		super(errorName, hsm, message, cause);
		this.eventName = hsm.eventName as PostedEvent<Protocol, EventName>;
		this.eventPayload = hsm.eventPayload as EventPayload<Protocol, EventName>;
	}
}

/**
 * Thrown when {@link StateEvents.onExit} or {@link StateEvents.onEntry} throws during a transition.
 *
 * @category Error
 */
export class TransitionError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends RuntimeError<Context, Protocol, EventName> {
	/**
	 * @param hsm - Machine view at failure time
	 * @param cause - Error thrown from the lifecycle hook
	 * @param failedStateName - Display name of the state whose hook failed
	 * @param failedCallback - Which hook failed (`onExit` or `onEntry`)
	 * @param fromStateName - Leaf state before the transition
	 * @param toStateName - Requested destination state
	 */
	constructor(
		hsm: State<Context, Protocol>,
		cause: Error,
		public failedStateName: string,
		public failedCallback: 'onExit' | 'onEntry',
		public fromStateName: string,
		public toStateName: string
	) {
		super('TransitionError', hsm, `${failedStateName}.${failedCallback}() has failed while executing a transition from ${fromStateName} to ${toStateName}`, cause);
	}
}

/**
 * Thrown when an event handler body throws and {@link StateEvents.onError} does not recover.
 *
 * @category Error
 */
export class EventHandlerError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends RuntimeError<Context, Protocol, EventName> {
	/**
	 * @param hsm - Machine view with {@link eventName} set to the failing handler
	 * @param cause - Error thrown from handler code
	 */
	constructor(hsm: State<Context, Protocol>, cause: Error) {
		super('EventHandlerError', hsm, `an error was thrown while executing event handler #${hsm.eventName} in state ${hsm.currentStateName}`, cause);
	}
}

/**
 * Thrown when no handler matches the dispatched event and {@link StateEvents.onUnhandled} rethrows.
 *
 * @category Error
 */
export class UnhandledEventError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends RuntimeError<Context, Protocol, EventName> {
	/** @param hsm - Machine view with the unmatched {@link eventName} */
	constructor(hsm: State<Context, Protocol>) {
		super('UnhandledEventError', hsm, `event #${hsm.eventName} was unhandled in state ${hsm.currentStateName}`);
	}
}

/**
 * Thrown at **class definition** time when {@link InitialState} is applied twice to one parent.
 *
 * @category Error
 */
export class InitialStateError<Context, Protocol extends {} | undefined> extends Error {
	/** Display name of the state passed to the duplicate {@link InitialState} call. */
	targetStateName: string;

	/** @param targetState - The state class whose parent already has an initial substate */
	constructor(targetState: StateClass<Context, Protocol>) {
		super(`State '${getStateName(Object.getPrototypeOf(targetState.prototype).constructor as StateClass<Context, Protocol>)}' must not have more than one initial state`);
		this.name = 'InitialStateError';
		this.targetStateName = getStateName(targetState);
	}
}

/**
 * Thrown when {@link StateEvents.onError} itself throws, leaving the machine unrecoverable.
 *
 * @category Error
 */
export class FatalError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends RuntimeError<Context, Protocol, EventName> {
	/**
	 * @param hsm - Machine view at failure time
	 * @param cause - Error thrown from `onError`
	 */
	constructor(hsm: State<Context, Protocol>, cause: Error) {
		super('FatalError', hsm, `onError() has thrown ${quoteError(cause)}`, cause);
	}
}

/**
 * Thrown when {@link StateEvents.onEntry} fails during the initial `@InitialState` walk at startup.
 *
 * @category Error
 */
export class InitializationError<Context, Protocol extends {} | undefined> extends HsmError<Context, Protocol> {
	/**
	 * @param hsm - Partially initialized machine
	 * @param failedState - State class whose `onEntry` threw
	 * @param cause - Original error from `onEntry`
	 */
	constructor(
		hsm: State<Context, Protocol>,
		public failedState: StateClass<Context, Protocol>,
		cause: Error
	) {
		super('InitializationError', hsm, `state ${getStateName(failedState)} has thrown ${quoteError(cause)} during initialization`, cause);
	}
}

/**
 * Terminal sink state class used when the runtime cannot recover from an error.
 *
 * Assign or transition here from custom {@link StateEvents.onError} handlers when you need a
 * well-defined quiescent state. Display name is pre-registered as `'FatalErrorState'`.
 *
 * @category State machine
 */
export class FatalErrorState<Context, Protocol extends {} | undefined> extends TopState<Context, Protocol> {}

defineStateNameInternal(TopState, 'TopState');
defineStateNameInternal(FatalErrorState, 'FatalErrorState');

/**
 * Declares `TargetState` as the **initial substate** of its direct parent composite.
 *
 * Apply as a TypeScript decorator or call as a function at class definition time. Exactly **one**
 * initial child is allowed per parent; a second mark throws {@link InitialStateError}.
 *
 * @typeParam Context - Domain context type
 * @typeParam Protocol - Vocabulary interface
 * @param TargetState - Child state class whose **parent** is `Object.getPrototypeOf(TargetState.prototype).constructor`
 *
 * @throws {@link InitialStateError} when the parent already has an initial substate
 *
 * @remarks
 * During {@link makeHsm} initialization, the runtime descends `@InitialState` chains from the
 * root until the deepest initial leaf is active, running {@link StateEvents.onEntry} along the path.
 *
 * @example
 * ```ts
 * class Composite extends TopState {}
 *
 * @InitialState
 * class Idle extends Composite {}
 * ```
 */
export function InitialState<Context, Protocol extends {} | undefined>(TargetState: StateClass<Context, Protocol>): void {
	const ParentOfTargetState = Object.getPrototypeOf(TargetState.prototype).constructor;
	if (hasInitialState(ParentOfTargetState)) throw new InitialStateError(TargetState);
	Object.defineProperty(TargetState, '_isInitialState', {
		value: true,
		writable: false,
		configurable: false,
		enumerable: false,
	});
	Object.defineProperty(ParentOfTargetState, '_initialState', {
		value: TargetState,
		writable: false,
		configurable: false,
		enumerable: false,
	});
}

/**
 * Assigns a stable **display name** to a single state class.
 *
 * Minifiers rewrite `Class.name` in production browser bundles; explicit registration keeps
 * {@link Properties.currentStateName}, trace output, and error messages readable everywhere.
 *
 * @typeParam Context - Domain context type
 * @typeParam Protocol - Vocabulary interface
 * @param state - State class constructor to tag
 * @param name - Non-empty display string used in traces and errors (not required to match `Class.name`)
 *
 * @remarks
 * Stored as a non-enumerable own property — never inherited by subclasses from the prototype chain.
 * {@link registerStateNames} is preferred when every state is a named export from one module.
 *
 * @example
 * ```ts
 * class Door extends TopState {}
 * defineStateName(Door, 'Door');
 * ```
 *
 * @category State machine
 */
export function defineStateName<Context, Protocol extends {} | undefined>(state: StateClass<Context, Protocol>, name: string): void {
	defineStateNameInternal(state, name);
}

/**
 * Registers display names for **every** state class in an exports object, using each **export key** as the name.
 *
 * @param exports - Module namespace (`import * as machine`) or object literal of state classes.
 *   Non-constructor exports (constants, functions, types) are silently skipped
 *
 * @remarks
 * Export keys survive minification even when class identifiers are mangled — this is the recommended
 * approach for browser bundles without `keep_classnames`. Call once at module load after all state
 * classes are defined.
 *
 * @example Single module
 * ```ts
 * export class DoorTop extends TopState {}
 * export class Open extends DoorTop {}
 * export class Closed extends DoorTop {}
 * registerStateNames({ DoorTop, Open, Closed });
 * ```
 *
 * @example Re-exporting namespace
 * ```ts
 * import * as machine from './machine';
 * registerStateNames(machine);
 * ```
 *
 * @category State machine
 */
export function registerStateNames(exports: Record<string, unknown>): void {
	for (const [exportName, value] of Object.entries(exports)) {
		if (isStateClass(value)) {
			defineStateNameInternal(value, exportName);
		}
	}
}

/** @internal — structural guard: a constructor whose prototype derives from {@link TopState}. */
function isStateClass(value: unknown): value is StateClass {
	if (typeof value !== 'function') return false;
	const prototype = (value as Function).prototype;
	return typeof prototype === 'object' && prototype !== null && TopState.prototype.isPrototypeOf(prototype);
}

/** @internal */
class ConsoleTraceWriter implements TraceWriter {
	write<Context, Protocol extends {} | undefined>(hsm: Properties<Context, Protocol>, Message: any): void {
		if (typeof Message == 'string') {
			console.log(`${hsm.traceHeader}${hsm.currentStateName}: ${Message}`);
		} else {
			console.log(Message);
		}
	}
}

function defaultDispatchErrorCallback<Context, Protocol extends {} | undefined>(hsm: Base<Context, Protocol>, err: Error): void {
	const writer = hsm.traceWriter;
	writer.write(hsm, `An event dispatch has failed; error ${err.name}: ${err.message} has not been managed`);
	writer.write(hsm, err);
	throw err;
}

const defaultTraceWriter = new ConsoleTraceWriter();
const defaultTraceLevel = TraceLevel.DEBUG;
const defaultInitialize = true;

/**
 * Creates and optionally initializes a hierarchical state machine **actor** bound to `ctx`.
 *
 * The returned {@link Hsm} is the single runtime object: external clients call `post` / `call` /
 * `sync`; the active state is the instance prototype chain updated by {@link State.transition}.
 *
 * @typeParam Context - Domain context type (inferred from `ctx` when passed inline)
 * @typeParam Protocol - Event/service vocabulary (inferred from `topState` when it implements `Protocol`)
 * @param topState - Root state **class** constructor (must extend {@link TopState})
 * @param ctx - Mutable domain object shared by all states; stored on the instance as {@link Hsm.ctx}
 * @param initialize - When `true` (default), enqueue the initial walk: descend `@InitialState`
 *   chains from `topState` and run {@link StateEvents.onEntry} on each entered state until the
 *   initial leaf is active. When `false`, prototype starts at `topState` with **no** entry hooks
 * @param traceLevel - Initial {@link TraceLevel} (default {@link TraceLevel.DEBUG})
 * @param traceWriter - {@link TraceWriter} implementation (default: prefixes strings with state name and logs to `console`)
 * @param dispatchErrorCallback - Last-resort error hook (default: trace + rethrow)
 * @returns Client handle implementing {@link Hsm} for the same `Context` and `Protocol`
 *
 * @remarks
 * - Await {@link Hsm.sync} after creation when `initialize: true` before asserting initial state
 * - Zero runtime npm dependencies; safe to embed in browsers when state names are registered
 * - Transition LCA paths are cached per machine instance for the lifetime of the actor
 *
 * @example Minimal door machine
 * ```ts
 * const door = makeHsm(DoorTop, { openCount: 0 });
 * await door.sync();
 * door.post('open');
 * await door.sync();
 * ```
 *
 * @example Custom tracing in tests
 * ```ts
 * const writer = { write: (_hsm, msg) => logs.push(msg) };
 * const sm = makeHsm(Top, ctx, true, TraceLevel.VERBOSE_DEBUG, writer);
 * await sm.sync();
 * ```
 *
 * @category Factory
 */
export function makeHsm<Context, Protocol extends undefined | {}>(topState: StateClass<Context, Protocol>, ctx: Context, initialize: boolean = defaultInitialize, traceLevel: TraceLevel = defaultTraceLevel, traceWriter: TraceWriter = defaultTraceWriter, dispatchErrorCallback: DispatchErrorCallback<Context, Protocol> = defaultDispatchErrorCallback): Hsm<Context, Protocol> {
	const instance: Instance<Context, Protocol> = {
		hsm: undefined as unknown as HsmWithTracing<Context, Protocol>,
		ctx: ctx,
	};
	Object.setPrototypeOf(instance, topState.prototype);
	instance.hsm = new HsmObject(topState, instance, traceWriter, traceLevel, dispatchErrorCallback, initialize);
	return instance.hsm;
}
