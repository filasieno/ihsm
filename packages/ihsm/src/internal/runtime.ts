/** @internal Consolidated ihsm runtime (no pure types — see ./types.ts). */
/// <reference types="node" />
import { nowMs, YIELD_TASK_BUDGET, YIELD_TIME_BUDGET_MS, yieldToMacrotask } from './scheduler';
import type {
	ActorConfig,
	ActorContextOf,
	ActorConfigOf,
	ActorPortOf,
	ActorOptions,
	ChildActor,
	ChildHsm,
	DispatchableMachine,
	DoneCallback,
	EmbodimentKind,
	ErrorHost,
	ExternalActor,
	ExternalHsm,
	HandlerHsm,
	HsmWithTracing,
	InboundActor,
	InboundHsm,
	Instance,
	NotificationQueue,
	ParentActor,
	PlannedTransition,
	IPort,
	MachinePortInput,
	Properties,
	ProtocolBucket,
	ProtocolIndex,
	ProtocolSlot,
	RandomService,
	ReservedName,
	SelfNotifications,
	ServiceCallOptions,
	StateClass,
	StateEvents,
	Task,
	TimerService,
	TopStateArg,
	TraceWriter,
	DispatchErrorCallback,
	Transition,
	TransitionResolver,
	TransitionHost,
	TransitionRoutineExecuteOptions,
	TransitionRoutinePlan,
	TransitionRoutineStyle,
	TransitionTracer,
	Disposable,
	EventObserver,
	TransitionTraceHost,
	ActorIdentity,
	ActorLogger,
	CauseRef,
	DispatchPhase,
	Instrumentation,
	LogAttributes,
	LogRecord,
	OutboundCallBegin,
	OutboundCallEnd,
	PortCallBegin,
	PortCallEnd,
	SpawnInfo,
	TraceFrame,
	TriggerKind,
} from './types';
import { kHandlerMachine, kParentLink } from './types';
import { actorNameFromTopState, childActorPath, mintActorIdentity, rootActorPath } from './identity';
import { getActiveInstrumentation, getTaskMeta, notifyActorCreated, notifyActorSpawned, notifyEnqueue, notifyError, notifyLog, notifyMacrostepBegin, notifyMacrostepEnd, notifyMicrostepBegin, notifyMicrostepEnd, notifyOutboundCallBegin, notifyOutboundCallEnd, notifyPortCallBegin, notifyPortCallEnd, setTaskMeta } from './instrumentation';

//#region TraceLevel

export enum TraceLevel {
	PRODUCTION,
	DEBUG,
	VERBOSE_DEBUG,
}

//#endregion

//#region utils

/** @internal */
export function asError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

/** @internal */
export function quoteUnknown(err: unknown): string {
	return quoteError(asError(err));
}

/** @internal */
export function quoteError(err: Error): string {
	return `${err.name}${err.message ? `: ${err.message}` : ' with no error message'}`;
}

/** @internal */
export function getInitialState<C extends ActorConfig>(State: StateClass<C>): StateClass<C> {
	return (State as { [key: string]: any })._initialState as StateClass<C>;
}

/** @internal */
export function hasInitialState<C extends ActorConfig>(State: StateClass<C>): boolean {
	return Object.prototype.hasOwnProperty.call(State, '_initialState');
}

/** @internal */
export function getTransitionKey<C extends ActorConfig>(FromState: StateClass<C>, ToState: StateClass<C>): string {
	return `${getStateName(FromState)}=>${getStateName(ToState)}`;
}

export function defineStateName<C extends ActorConfig>(state: StateClass<C>, displayName: string): void {
	Object.defineProperty(state, '_stateName', {
		value: displayName,
		writable: false,
		configurable: false,
		enumerable: false,
	});
}

/** @internal — prefers an own explicit name registered for minified browser bundles. */
export function getStateName<C extends ActorConfig>(state: StateClass<C>): string {
	if (Object.prototype.hasOwnProperty.call(state, '_stateName')) {
		return (state as unknown as { _stateName: string })._stateName;
	}
	return state.name;
}

//#endregion

//#region ports

/** Production port: timers, randomness, and deferred self-notifications for one machine.
 * @typeParam T - Root state **constructor** (`typeof DoorTop`), not the instance type. */
export class Port<T extends TopStateArg = TopStateArg> implements IPort<ActorConfigOf<T>>, RandomService {
	declare readonly __topState: T;
	actor!: InboundActor<ActorConfigOf<T>> | ChildActor<ActorConfigOf<T>>;
	private _deferFactory?: (ms: number) => SelfNotifications<ActorConfigOf<T>>;
	protected _timerSeq = 0;
	protected readonly _timeoutHandles = new Map<number, ReturnType<typeof setTimeout>>();
	protected readonly _intervalHandles = new Map<number, ReturnType<typeof setInterval>>();

	/** Schedule a one-shot callback after `millis` milliseconds (platform timer). */
	setTimeout(callback: () => void, millis?: number): number {
		const id = ++this._timerSeq;
		const handle = globalThis.setTimeout(
			() => {
				this._timeoutHandles.delete(id);
				callback();
			},
			Math.max(0, millis ?? 0)
		);
		this._timeoutHandles.set(id, handle);
		return id;
	}

	/** Cancel a timer previously returned by {@link Port.setTimeout}. */
	clearTimeout(id: number | undefined): void {
		if (id === undefined) {
			return;
		}
		const handle = this._timeoutHandles.get(id);
		if (handle !== undefined) {
			globalThis.clearTimeout(handle);
			this._timeoutHandles.delete(id);
		}
	}

	/** Schedule a repeating callback every `millis` milliseconds. */
	setInterval(callback: () => void, millis?: number): number {
		const id = ++this._timerSeq;
		const handle = globalThis.setInterval(callback, Math.max(0, millis ?? 0));
		this._intervalHandles.set(id, handle);
		return id;
	}

	/** Cancel an interval previously returned by {@link Port.setInterval}. */
	clearInterval(id: number | undefined): void {
		if (id === undefined) {
			return;
		}
		const handle = this._intervalHandles.get(id);
		if (handle !== undefined) {
			globalThis.clearInterval(handle);
			this._intervalHandles.delete(id);
		}
	}

	/** Pseudorandom number in `[0, 1)` — delegates to `Math.random()`. */
	random(): number {
		return Math.random();
	}

	/** Cryptographic-quality random in `[0, 1)` when the platform provides it. */
	cryptoRandom(): number {
		const crypto = globalThis.crypto as Crypto & { random?: () => number };
		return crypto.random?.() ?? Math.random();
	}

	/** Generate a UUID v4 string via `crypto.randomUUID()`. */
	randomUUID(): string {
		return globalThis.crypto.randomUUID();
	}

	/** Fill `array` with cryptographically strong random bytes. */
	getRandomValues<T extends ArrayBufferView>(array: T): T {
		globalThis.crypto.getRandomValues(array as never);
		return array;
	}

	/** @internal Wired by {@link Machine.bindPort} — do not call from application code. */
	bindDeferredNotifications(factory: (ms: number) => SelfNotifications<ActorConfigOf<T>>): void {
		this._deferFactory = factory;
	}

	defer(ms: number): SelfNotifications<ActorConfigOf<T>> {
		if (this._deferFactory === undefined) {
			throw new Error('ihsm: port.defer requires actor binding — pass the port to makeActor / makeTestActor');
		}
		return this._deferFactory(ms);
	}
}

const kRequestingPort = Symbol('ihsm.requestingPort');
type RequestingPortCtor = Function & Record<typeof kRequestingPort, boolean | undefined>;

export abstract class RequestingPort<T extends TopStateArg = TopStateArg> extends Port<T> {
	declare actor: ChildActor<ActorConfigOf<T>>;
}

(RequestingPort as unknown as RequestingPortCtor)[kRequestingPort] = true;

//#endregion

//#region Errors

export abstract class TopState<C extends ActorConfig = ActorConfig> implements StateEvents<C> {
	readonly ctx!: ActorContextOf<C>;
	readonly hsm!: HandlerHsm<C>;
	readonly notify!: SelfNotifications<C>;
	readonly notifyNow!: SelfNotifications<C>;

	constructor() {
		throw new Error('Fatal error: States cannot be instantiated');
	}

	onExit(): Promise<void> | void {}

	onEntry(): Promise<void> | void {}

	onError(error: RuntimeError<C>): Promise<void> | void {
		throw error;
	}

	onUnhandled(error: UnhandledEventError<C>): Promise<void> | void {
		throw error;
	}
}

export abstract class HsmError<C extends ActorConfig = ActorConfig> extends Error {
	name: string;
	topStateName: string;
	stateName: string;
	context: ActorContextOf<C>;
	cause?: Error;

	protected constructor(name: string, hsm: ErrorHost<C>, message: string, cause?: Error) {
		super(message);
		this.name = name;
		this.topStateName = hsm.topStateName;
		this.stateName = hsm.currentStateName;
		this.context = hsm.ctx;
		this.cause = cause;
	}
}

export abstract class RuntimeError<C extends ActorConfig = ActorConfig, EventName extends string = string> extends HsmError<C> {
	eventName: EventName;
	eventPayload: unknown[];

	protected constructor(errorName: string, hsm: ErrorHost<C>, message: string, cause?: Error) {
		super(errorName, hsm, message, cause);
		this.eventName = hsm.eventName as EventName;
		this.eventPayload = hsm.eventPayload;
	}
}

export class TransitionError<C extends ActorConfig = ActorConfig, EventName extends string = string> extends RuntimeError<C, EventName> {
	constructor(
		hsm: ErrorHost<C>,
		cause: Error,
		public failedStateName: string,
		public failedCallback: 'onExit' | 'onEntry',
		public fromStateName: string,
		public toStateName: string
	) {
		super('TransitionError', hsm, `${failedStateName}.${failedCallback}() has failed while executing a transition from ${fromStateName} to ${toStateName}`, cause);
	}
}

export class EventHandlerError<C extends ActorConfig = ActorConfig, EventName extends string = string> extends RuntimeError<C, EventName> {
	constructor(hsm: ErrorHost<C>, cause: Error) {
		super('EventHandlerError', hsm, `an error was thrown while executing event handler #${hsm.eventName} in state ${hsm.currentStateName}`, cause);
	}
}

export class UnhandledEventError<C extends ActorConfig = ActorConfig, EventName extends string = string> extends RuntimeError<C, EventName> {
	constructor(hsm: ErrorHost<C>) {
		super('UnhandledEventError', hsm, `event #${hsm.eventName} was unhandled in state ${hsm.currentStateName}`);
	}
}

export class InitialStateError<C extends ActorConfig = ActorConfig> extends Error {
	targetStateName: string;

	constructor(targetState: StateClass<C>) {
		super(`State '${getStateName(Object.getPrototypeOf(targetState.prototype).constructor as StateClass<C>)}' must not have more than one initial state`);
		this.name = 'InitialStateError';
		this.targetStateName = getStateName(targetState);
	}
}

export class FatalError<C extends ActorConfig = ActorConfig, EventName extends string = string> extends RuntimeError<C, EventName> {
	constructor(hsm: ErrorHost<C>, cause: Error) {
		super('FatalError', hsm, `onError() has thrown ${quoteError(cause)}`, cause);
	}
}

export class InitializationError<C extends ActorConfig = ActorConfig> extends HsmError<C> {
	constructor(
		hsm: ErrorHost<C>,
		public failedState: StateClass<C>,
		cause: Error
	) {
		super('InitializationError', hsm, `state ${getStateName(failedState)} has thrown ${quoteError(cause)} during initialization`, cause);
	}
}

export class FatalErrorState extends TopState {}

defineStateName(TopState as StateClass, 'TopState');
defineStateName(FatalErrorState as StateClass, 'FatalErrorState');

/** @internal */
export function lookupHandlerState<C extends ActorConfig>(hsm: HsmWithTracing<C>, eventName: PropertyKey): string | undefined {
	let state: StateClass<C> = hsm.currentState as StateClass<C>;
	while (true) {
		const prototype = state.prototype as unknown as Record<PropertyKey, unknown>;
		if (Object.prototype.hasOwnProperty.call(prototype, eventName)) {
			return getStateName(state);
		}
		if ((state as unknown) === TopState) {
			return undefined;
		}
		state = Object.getPrototypeOf(state) as StateClass<C>;
	}
}

/** @internal */
export function lookupEventHandler<C extends ActorConfig>(hsm: HsmWithTracing<C>, eventName: PropertyKey): ((...args: any[]) => unknown) | undefined {
	let state: StateClass<C> = hsm.currentState as StateClass<C>;
	while (true) {
		const prototype = state.prototype as unknown as Record<PropertyKey, unknown>;
		if (Object.prototype.hasOwnProperty.call(prototype, eventName)) {
			return prototype[eventName] as (...args: any[]) => unknown;
		}
		if ((state as unknown) === TopState) {
			return undefined;
		}
		state = Object.getPrototypeOf(state) as StateClass<C>;
	}
}

export function InitialState<C extends ActorConfig>(TargetState: StateClass<C>): void {
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

export function registerStateNames(exports: Record<string, unknown>): void {
	for (const [exportName, value] of Object.entries(exports)) {
		if (typeof value !== 'function') continue;
		const prototype = (value as Function).prototype;
		if (typeof prototype !== 'object' || prototype === null || !TopState.prototype.isPrototypeOf(prototype)) continue;
		defineStateName(value as StateClass, exportName);
		StateGraph.forRoot(findRootState(value as StateClass)).register(value as StateClass);
	}
}

//#endregion

//#region protocol-index

//#region Protocol collision errors

/** Thrown at construction when `Config`, state handlers, and the protocol index disagree. */
export class ProtocolCollisionError extends Error {
	// prettier-ignore
	private constructor(message: string, readonly stateClass?: string, readonly symbol?: string) {
		super(message);
		this.name = 'ProtocolCollisionError';
	}

	static reservedOnState(stateClass: string, symbol: ReservedName): ProtocolCollisionError {
		return new ProtocolCollisionError(`ihsm: state class "${stateClass}" defines reserved symbol "${symbol}" — rename the protocol method; reserved symbols are: ${ReservedNames.join(', ')}`, stateClass, symbol);
	}
}

//#endregion

//#region State graph

const stateGraphKey = Symbol('ihsm.stateGraph');

type StateClassWithGraph = StateClass & { [stateGraphKey]?: StateGraph };

function findRootState(state: StateClass): StateClass {
	let current: StateClass = state;
	while (true) {
		const parent = Object.getPrototypeOf(current) as StateClass;
		if (parent === TopState) {
			return current;
		}
		const grandparent = Object.getPrototypeOf(parent) as StateClass;
		if (grandparent === TopState) {
			return current;
		}
		current = parent;
	}
}

function handlerBucket(handler: Function): ProtocolBucket {
	const source = Function.prototype.toString.call(handler);
	if (handler.constructor.name === 'AsyncFunction' || /\basync\b/.test(source)) {
		return 'services';
	}
	if (/\breturn\s+[^(;]/.test(source)) {
		return 'services';
	}
	return 'notifications';
}

/** Per–root-state registry of state classes for protocol scanning. */
export class StateGraph {
	private readonly states = new Set<StateClass>();

	register(state: StateClass): void {
		this.states.add(state);
	}

	collect(topState: StateClass): StateClass[] {
		if (this.states.size > 0) {
			return [...this.states];
		}
		return StateGraph.collectAlongPrototypeChain(topState);
	}

	static forRoot(root: StateClass): StateGraph {
		const host = root as StateClassWithGraph;
		let graph = host[stateGraphKey];
		if (graph === undefined) {
			graph = new StateGraph();
			host[stateGraphKey] = graph;
		}
		return graph;
	}

	private static collectAlongPrototypeChain(topState: StateClass): StateClass[] {
		const collected = new Set<StateClass>();
		let current: StateClass | undefined = topState;
		while (current !== undefined && current !== TopState) {
			collected.add(current);
			current = Object.getPrototypeOf(current) as StateClass;
			if (current === TopState) break;
		}
		return [...collected];
	}
}

//#endregion

//#region Protocol index cache

const indexByRoot = new WeakMap<object, ProtocolIndex>();

export function cacheProtocolIndex(topState: object, index: ProtocolIndex): ProtocolIndex {
	indexByRoot.set(topState, index);
	return index;
}

export function protocolIndexFor(topState: object): ProtocolIndex | undefined {
	return indexByRoot.get(topState);
}

//#endregion

//#region Protocol index

const reservedSet = new Set<string>(['ctx', 'hsm', 'notify', 'notifyNow', 'onEntry', 'onExit', 'onError', 'onUnhandled']);
export const ReservedNames = ['ctx', 'hsm', 'notify', 'notifyNow', 'onEntry', 'onExit', 'onError', 'onUnhandled'] as const satisfies readonly ReservedName[];
const lifecycleHooks = new Set<string>(['onEntry', 'onExit', 'onError', 'onUnhandled']);

class ProtocolIndexImpl implements ProtocolIndex {
	readonly slots: ReadonlyMap<string, ProtocolSlot>;

	constructor(slots: ReadonlyMap<string, ProtocolSlot>) {
		this.slots = slots;
	}

	get(name: string): ProtocolSlot | undefined {
		return this.slots.get(name);
	}

	*entries(kind: EmbodimentKind): Iterable<[string, ProtocolSlot]> {
		for (const [name, slot] of this.slots) {
			if (kind === 'root' && (slot.bucket === 'services' || slot.bucket === 'notifications')) {
				yield [name, slot];
			} else if (kind === 'inbound' && slot.bucket !== 'internalServices') {
				yield [name, slot];
			} else if (kind === 'child' || kind === 'test') {
				yield [name, slot];
			}
		}
	}
}

/** Build a protocol index by scanning handler methods on the state graph (`async` → services, otherwise notifications). */
export function buildProtocolIndex(topState: StateClass): ProtocolIndex {
	const states = StateGraph.forRoot(findRootState(topState)).collect(topState);

	for (const state of states) {
		const prototype = state.prototype as Record<string, unknown>;
		for (const name of Object.getOwnPropertyNames(prototype)) {
			if (!reservedSet.has(name) || lifecycleHooks.has(name) || name === 'constructor') continue;
			if (typeof prototype[name] === 'function') {
				throw ProtocolCollisionError.reservedOnState(getStateName(state), name as ReservedName);
			}
		}
	}

	const slots = new Map<string, ProtocolSlot>();
	const seen = new Set<string>();
	for (const state of states) {
		const prototype = state.prototype as Record<string, unknown>;
		for (const name of Object.getOwnPropertyNames(prototype)) {
			if (reservedSet.has(name) || lifecycleHooks.has(name) || name === 'constructor') continue;
			const handler = prototype[name];
			if (typeof handler !== 'function' || seen.has(name)) continue;
			seen.add(name);
			const bucket = handlerBucket(handler);
			slots.set(name, { bucket, name });
		}
	}

	return new ProtocolIndexImpl(slots);
}

//#endregion

//#region handles

/** Thrown when a service client call exceeds `{ timeoutMs }`. */
export class CallTimeoutError extends Error {
	// prettier-ignore
	constructor(readonly method: string) {
		super(`ihsm: service "${method}" timed out`);
		this.name = 'CallTimeoutError';
	}
}

export const kMachine = Symbol('ihsm.machine');

/** @internal Actor handle prototype bag used when wiring generated facets. */
export interface HandleOwn extends Record<symbol | string, unknown> {
	[kMachine]: DispatchableMachine;
	ctx?: unknown;
	hsm: unknown;
	parent?: ParentActor;
}

export function isServiceCallOptions(value: unknown): value is ServiceCallOptions {
	if (value === null || typeof value !== 'object') {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (!('timeoutMs' in record)) {
		return false;
	}
	const timeoutMs = record.timeoutMs;
	return timeoutMs === undefined || (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs >= 0);
}

export function splitServiceArgs(args: readonly unknown[]): { callArgs: unknown[]; timeoutMs: number | undefined } {
	if (args.length === 0) {
		return { callArgs: [], timeoutMs: undefined };
	}
	const last = args[args.length - 1];
	if (!isServiceCallOptions(last)) {
		return { callArgs: [...args], timeoutMs: undefined };
	}
	const timeoutMs = last.timeoutMs;
	if (timeoutMs === undefined) {
		return { callArgs: [...args], timeoutMs: undefined };
	}
	return { callArgs: args.slice(0, -1), timeoutMs };
}

/**
 * Race a service-call promise against a `timeoutMs` deadline.
 *
 * The deadline is armed through `timer` — the actor's port timer service — so that under a
 * {@link TestPort} virtual clock a call timeout is driven by `port.advance(...)` and stays
 * fully deterministic. When no port timer is available the host timer is used (production
 * `Port` already delegates to the host timer, so behaviour there is unchanged).
 */
export function serviceCallWithTimeout<T>(promise: Promise<T>, method: string, timeoutMs: number, timer?: TimerService): Promise<T> {
	if (timeoutMs === 0) {
		return Promise.reject(new CallTimeoutError(method));
	}
	const arm = (callback: () => void): number => (timer !== undefined ? timer.setTimeout(callback, timeoutMs) : (globalThis.setTimeout(callback, timeoutMs) as unknown as number));
	const disarm = (handle: number): void => (timer !== undefined ? timer.clearTimeout(handle) : globalThis.clearTimeout(handle as unknown as ReturnType<typeof setTimeout>));
	return new Promise<T>((resolve, reject) => {
		const handle = arm(() => {
			reject(new CallTimeoutError(method));
		});
		promise.then(
			value => {
				disarm(handle);
				resolve(value);
			},
			err => {
				disarm(handle);
				reject(err);
			}
		);
	});
}

type FacetKind = 'notify' | 'notifyNow' | 'call';

const facetProtoCache = new WeakMap<object, Map<string, object>>();

/**
 * Build (and cache) the frozen prototype for one facet of one embodiment.
 * Delivery mode is fixed by the facet — `call` dispatches services, `notify`
 * the default queue, `notifyNow` the priority queue — so the runtime no longer
 * needs to infer it per handler at the call site.
 */
function getFacetProto(topState: object, index: ProtocolIndex, kind: EmbodimentKind, facet: FacetKind): object {
	let map = facetProtoCache.get(topState);
	if (map === undefined) {
		map = new Map();
		facetProtoCache.set(topState, map);
	}
	const cacheKey = `${kind}:${facet}`;
	let proto = map.get(cacheKey);
	if (proto === undefined) {
		const built: Record<string, Function> = Object.create(null);
		// Dispatch mode is fixed by the facet, not by the handler's signature, so
		// every member visible to this embodiment kind is exposed on every facet.
		// The static types (`NotifyFacet` / `CallFacet`) are the gate that decides
		// which members are legal to reach through which facet; the runtime never
		// needs to guess service-vs-notification from the handler's return type.
		const queue: NotificationQueue = facet === 'notifyNow' ? 'priority' : 'default';
		for (const [name] of index.entries(kind)) {
			if (facet === 'call') {
				built[name] = function (this: HandleOwn, ...args: unknown[]): Promise<unknown> {
					const { callArgs, timeoutMs } = splitServiceArgs(args);
					const machine = this[kMachine];
					const begin = (machine as { beginOutboundCall?: (service: string, targetUuid?: string) => OutboundCallBegin | undefined }).beginOutboundCall?.(name, (machine as { actorUuid?: string }).actorUuid);
					const promise = machine.dispatchService(name, callArgs).then(
						value => {
							(machine as { endOutboundCall?: (info: OutboundCallBegin | undefined, outcome: 'ok' | 'error', error?: Error) => void }).endOutboundCall?.(begin, 'ok');
							return value;
						},
						cause => {
							const err = asError(cause);
							(machine as { endOutboundCall?: (info: OutboundCallBegin | undefined, outcome: 'ok' | 'error', error?: Error) => void }).endOutboundCall?.(begin, 'error', err);
							throw err;
						}
					);
					return timeoutMs === undefined ? promise : serviceCallWithTimeout(promise, name, timeoutMs, machine.callTimer);
				};
			} else {
				built[name] = function (this: HandleOwn, ...args: unknown[]): void {
					this[kMachine].dispatchNotification(name, args, queue);
				};
			}
		}
		proto = Object.freeze(built);
		map.set(cacheKey, proto);
	}
	return proto;
}

function createFacet(machine: DispatchableMachine, topState: object, index: ProtocolIndex, kind: EmbodimentKind, facet: FacetKind): object {
	const facetHandle = Object.create(getFacetProto(topState, index, kind, facet));
	Object.defineProperty(facetHandle, kMachine, { value: machine, enumerable: false });
	return facetHandle;
}

/** @internal */
export function createActorHandle(machine: DispatchableMachine, topState: object, index: ProtocolIndex, kind: EmbodimentKind): HandleOwn {
	// Faceted surface only — protocol members live under `notify` / `notifyNow`
	// / `call`. There are no flat methods on the handle, so `actor.theEvent()`
	// is a compile-time and runtime error; callers must go through a facet.
	const handle = {} as HandleOwn;
	Object.defineProperty(handle, kMachine, { value: machine, enumerable: false });
	if (kind === 'test') {
		Object.defineProperty(handle, 'ctx', {
			enumerable: true,
			get(): unknown {
				return machine.ctx;
			},
		});
	}
	Object.defineProperty(handle, 'notify', { value: createFacet(machine, topState, index, kind, 'notify'), enumerable: true });
	Object.defineProperty(handle, 'notifyNow', { value: createFacet(machine, topState, index, kind, 'notifyNow'), enumerable: true });
	Object.defineProperty(handle, 'call', { value: createFacet(machine, topState, index, kind, 'call'), enumerable: true });
	Object.defineProperty(handle, 'id', {
		enumerable: true,
		get(): string {
			return machine.actorUuid;
		},
	});
	handle.hsm = machine.actorHsmFor(kind);
	return handle;
}

const selfProtoCache = new WeakMap<object, Map<NotificationQueue, object>>();

/** @internal */
export function getSelfNotificationsProto(topState: object, index: ProtocolIndex, queue: NotificationQueue): object {
	let map = selfProtoCache.get(topState);
	if (map === undefined) {
		map = new Map();
		selfProtoCache.set(topState, map);
	}
	let proto = map.get(queue);
	if (proto === undefined) {
		const built: Record<string, Function> = Object.create(null);
		// Self-send always uses notification dispatch (you cannot await a service
		// on yourself); `SelfNotifications<C>` is the static gate for which members
		// are reachable, so expose every member visible to the handler embodiment.
		for (const [name] of index.entries('inbound')) {
			built[name] = function (this: HandleOwn, ...args: unknown[]): void {
				this[kMachine].dispatchNotification(name, args, queue);
			};
		}
		proto = Object.freeze(built);
		map.set(queue, proto);
	}
	return proto;
}

export function createSelfNotifications(machine: DispatchableMachine, topState: object, index: ProtocolIndex, queue: NotificationQueue): HandleOwn {
	const handle = Object.create(getSelfNotificationsProto(topState, index, queue)) as HandleOwn;
	Object.defineProperty(handle, kMachine, { value: machine, enumerable: false });
	return handle;
}

//#region dispatch-guard

/// <reference types="node" />

/** Thrown in debug builds when a service targets the machine currently dispatching. */
export class SelfCallDeadlockError extends Error {
	constructor() {
		super('ihsm: awaiting a service on your own machine from inside your own dispatch deadlocks');
		this.name = 'SelfCallDeadlockError';
	}
}

type DispatchToken = { machine: DispatchableMachine; actorUuid?: string; macrostepId?: string; stepSeq?: number };
type PortCallToken = {
	machine: DispatchableMachine;
	callId: number;
	method: string;
	cause?: CauseRef;
};

interface InstrumentationHost {
	onTaskBegin(task: Task): void;
	onTaskEnd(task: Task, outcome: 'ok' | 'error'): void;
	onQueuesDrained(): void;
	onDispatchError(err: Error): void;
}

function errorPhaseFromError(err: Error): DispatchPhase {
	if (err instanceof TransitionError) {
		return err.failedCallback === 'onEntry' ? 'onEntry' : 'onExit';
	}
	if (err instanceof UnhandledEventError) return 'unhandled';
	if (err instanceof InitializationError) return 'initialize';
	if (err instanceof EventHandlerError) return 'handler';
	return 'handler';
}

type AsyncLocalStorageCtor = new <T>() => {
	run<R>(store: T, fn: () => R): R;
	getStore(): T | undefined;
};

type DispatchAsyncLocalStorage = InstanceType<AsyncLocalStorageCtor>;

/**
 * Lazy Node AsyncLocalStorage for non-production deadlock detection.
 * State lives in a closure — no exported mutable slot.
 */
export const dispatchContext = (() => {
	let storage: DispatchAsyncLocalStorage | null | undefined = undefined;

	function get(): DispatchAsyncLocalStorage | undefined {
		if (storage !== undefined) {
			return storage ?? undefined;
		}
		if (typeof process === 'undefined' || process.versions?.node === undefined) {
			storage = null;
			return undefined;
		}
		try {
			// Dynamic require — no unconditional `node:async_hooks` import (browser-safe bundle).
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const hooks = require('node:async_hooks') as { AsyncLocalStorage: AsyncLocalStorageCtor };
			storage = new hooks.AsyncLocalStorage<DispatchToken>();
			return storage;
		} catch {
			storage = null;
			return undefined;
		}
	}

	function resetInit(): void {
		storage = undefined;
	}

	function markUnavailable(): void {
		storage = null;
	}

	return { get, resetInit, markUnavailable };
})();

/**
 * Best-effort current runtime trace anchor (`actorUuid`, `macrostepId`, `stepSeq`) for user code.
 * Returns `undefined` when called outside an active handler dispatch turn.
 */
export function currentTraceAnchor(): { readonly actorUuid: string; readonly macrostepId?: string; readonly stepSeq?: number } | undefined {
	const token = dispatchContext.get()?.getStore() as DispatchToken | undefined;
	if (token?.actorUuid === undefined) return undefined;
	return {
		actorUuid: token.actorUuid,
		macrostepId: token.macrostepId,
		stepSeq: token.stepSeq,
	};
}

/** Lazy ALS carrying the currently-executing proxied port call (when instrumentation is active). */
const portCallContext = (() => {
	let storage: DispatchAsyncLocalStorage | null | undefined = undefined;

	function get(): DispatchAsyncLocalStorage | undefined {
		if (storage !== undefined) {
			return storage ?? undefined;
		}
		if (typeof process === 'undefined' || process.versions?.node === undefined) {
			storage = null;
			return undefined;
		}
		try {
			// Dynamic require — keeps browser bundles free of `node:async_hooks`.
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const hooks = require('node:async_hooks') as { AsyncLocalStorage: AsyncLocalStorageCtor };
			storage = new hooks.AsyncLocalStorage<PortCallToken>();
			return storage;
		} catch {
			storage = null;
			return undefined;
		}
	}

	return { get };
})();

//#region transition-routines

/** Thrown when a generated transition table's graph hash does not match the scanned hierarchy. */
export class TransitionTableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TransitionTableError';
	}
}

/** Compute the LCA transition path (same algorithm as `dispatch.production.ts`). */
export function planTransitionClasses<C extends ActorConfig>(srcState: StateClass<C>, destState: StateClass<C>): PlannedTransition<C> {
	const src: StateClass<C> = srcState;
	let dst: StateClass<C> = destState;
	let srcPath: StateClass<C>[] = [];
	const end = TopState as StateClass<C>;
	const srcIndex = new Map<StateClass<C>, number>();
	const dstPath: StateClass<C>[] = [];
	let cur: StateClass<C> = src;
	let i = 0;

	while (cur !== end) {
		srcPath.push(cur);
		srcIndex.set(cur, i);
		cur = Object.getPrototypeOf(cur);
		++i;
	}
	cur = dst;

	while (cur !== end) {
		const index = srcIndex.get(cur);
		if (index !== undefined) {
			srcPath = srcPath.slice(0, index);
			break;
		}
		dstPath.unshift(cur);
		cur = Object.getPrototypeOf(cur);
	}

	while (hasInitialState(dst)) {
		dst = getInitialState(dst);
		dstPath.push(dst);
	}

	let finalState: StateClass<C> | undefined;
	if (dstPath.length !== 0) {
		finalState = dstPath[dstPath.length - 1];
	} else if (srcPath.length !== 0) {
		finalState = Object.getPrototypeOf(srcPath[srcPath.length - 1]);
	} else {
		finalState = undefined;
	}

	return { exit: srcPath, entry: dstPath, finalState };
}

async function invokeLifecycleHook<C extends ActorConfig>(hsm: TransitionHost<C>, instance: object, state: StateClass<C>, hook: 'onExit' | 'onEntry', fromStateName: string, toStateName: string, style: TransitionRoutineStyle, tracer: TransitionTracer | undefined, hookEvents: boolean): Promise<void> {
	const statePrototype = state.prototype;
	const stateName = getStateName(state);
	const hasHook = Object.prototype.hasOwnProperty.call(statePrototype, hook);
	// Emit hook tracer callbacks for real (own) hooks at verbose, or always for a structural seam
	// (instrumentation) whose entry/exit spans are not TraceLevel-gated (spec §4.8). Skipped default
	// hooks are never eventized.
	const emitHookEvents: boolean = (style === 'verbose' || hookEvents) && hasHook;

	if ((style === 'verbose' || style === 'debug') && !hasHook) {
		if (style === 'verbose') {
			tracer?.traceHookSkipped(stateName, hook);
		}
		return;
	}

	try {
		if (emitHookEvents) {
			tracer?.traceHookStart?.(stateName, hook);
		}
		const res = statePrototype[hook].call(instance);
		if (res) {
			await res;
		}
		if (emitHookEvents) {
			tracer?.traceHookDone(stateName, hook);
		}
	} catch (cause) {
		if (emitHookEvents) {
			tracer?.traceHookError(stateName, hook, cause);
		}
		throw new TransitionError(hsm, asError(cause), stateName, hook, fromStateName, toStateName);
	}
}

/**
 * Execute a planned transition path with production or verbose semantics.
 *
 * Used by the runtime dispatch layer, generated transition tables (`@ihsm/tools`), and oracle tests.
 */
export async function executeTransitionRoutine<C extends ActorConfig>(hsm: TransitionHost<C>, instance: object, plan: TransitionRoutinePlan<C> | PlannedTransition<C>, srcState: StateClass<C>, dstState: StateClass<C>, options: TransitionRoutineExecuteOptions<C> = {}): Promise<void> {
	const style = options.style ?? 'production';
	const tracer = options.tracer;
	const hookEvents = options.hookEvents ?? false;
	const fromStateName = getStateName(srcState);
	const toStateName = getStateName(dstState);

	// The structural transition span fires whenever a tracer is attached (the instrumentation seam is
	// not TraceLevel-gated); the console tracer is only ever supplied off-PRODUCTION, so this is a
	// no-op there unless an explicit instrumentation tracer is present.
	tracer?.traceTransitionStart(fromStateName, toStateName);

	for (const state of plan.exit) {
		await invokeLifecycleHook(hsm, instance, state, 'onExit', fromStateName, toStateName, style, tracer, hookEvents);
	}

	let initializeOpened = false;
	for (const state of plan.entry) {
		if (!initializeOpened && state !== dstState) {
			tracer?.traceInitializeStart?.(toStateName);
			initializeOpened = true;
		}
		await invokeLifecycleHook(hsm, instance, state, 'onEntry', fromStateName, toStateName, style, tracer, hookEvents);
	}
	if (initializeOpened) {
		const finalName = plan.finalState !== undefined ? getStateName(plan.finalState) : toStateName;
		tracer?.traceInitializeDone?.(finalName);
	}

	const applyState = (next: StateClass<C>): void => {
		if (options.setCurrentState) {
			options.setCurrentState(next);
		} else if ('currentState' in hsm) {
			(hsm as TransitionHost<C> & { currentState: StateClass<C> }).currentState = next;
		}
	};

	if (style === 'verbose') {
		const finalState = plan.entry.length !== 0 ? plan.entry[plan.entry.length - 1] : plan.exit.length !== 0 ? (Object.getPrototypeOf(plan.exit[plan.exit.length - 1]) as StateClass<C>) : srcState;
		tracer?.traceTransitionDone(getStateName(finalState));
		applyState(finalState);
		return;
	}

	if (style === 'debug' && plan.finalState) {
		tracer?.traceTransitionDone(getStateName(plan.finalState));
		applyState(plan.finalState);
		return;
	}

	if (plan.finalState) {
		applyState(plan.finalState);
		// Close the structural transition span on the PRODUCTION path (verbose/debug returned above).
		tracer?.traceTransitionDone(getStateName(plan.finalState));
	}
}

export function createTransitionTracer(hsm: TransitionTraceHost): TransitionTracer {
	return {
		traceTransitionStart(fromStateName, toStateName) {
			hsm._tracePush(`transition from ${fromStateName} to ${toStateName}`, `started transition from ${fromStateName} to ${toStateName} `);
		},
		traceInitializeStart(stateName) {
			hsm._tracePush(`initialize ${stateName}`, `started initialize drill-down from ${stateName}`);
		},
		traceInitializeDone(finalStateName) {
			hsm._tracePopDone(`done initialize drill-down at ${finalStateName}`);
		},
		traceHookDone(stateName, hook) {
			hsm._traceWrite(`${stateName}.${hook}() done`);
		},
		traceHookSkipped(stateName, hook) {
			hsm._traceWrite(`${stateName}.${hook}() skipped: default empty implementation`);
		},
		traceHookError(stateName, hook, cause) {
			hsm._tracePopError(`${stateName}.${hook}() has thrown ${quoteUnknown(cause)}`);
		},
		traceTransitionDone(finalStateName) {
			hsm._tracePopDone(`final state is ${finalStateName}`);
		},
	};
}

/** Collect canonical transition trace lines (for oracle comparison). */
export function transitionTraceLines(lines: readonly string[]): string[] {
	return lines
		.map(line => {
			const idx = line.indexOf(': ');
			return idx >= 0 ? line.slice(idx + 2) : line;
		})
		.filter(line => line.startsWith('started transition from ') || line.endsWith('.onExit() done') || line.endsWith('.onEntry() done') || line.includes('.onExit() skipped:') || line.includes('.onEntry() skipped:') || line.includes('.onExit() has thrown') || line.includes('.onEntry() has thrown') || line.startsWith('done: final state is ') || (line.startsWith('failure: ') && line.includes('.onExit() has thrown')) || (line.startsWith('failure: ') && line.includes('.onEntry() has thrown')));
}

//#region actor-dispatch

class RuntimeTransitionRoutine<C extends ActorConfig> implements Transition<C> {
	constructor(private readonly plan: ReturnType<typeof planTransitionClasses<C>>) {}

	async execute(hsm: HsmWithTracing<C>, srcState: StateClass<C>, dstState: StateClass<C>): Promise<void> {
		const style: TransitionRoutineStyle = hsm.traceLevel === TraceLevel.PRODUCTION ? 'production' : hsm.traceLevel === TraceLevel.DEBUG ? 'debug' : 'verbose';
		const machine = hsm as Machine<C>;
		const instTracer = machine.instrumentation?.transition;
		const tracer: TransitionTracer | undefined = instTracer ?? (style !== 'production' ? createTransitionTracer(hsm) : undefined);
		await executeTransitionRoutine(hsm, hsm._instance, this.plan, srcState, dstState, {
			style,
			...(tracer !== undefined ? { tracer } : {}),
			// The instrumentation seam's entry/exit spans are structural (not TraceLevel-gated); the
			// console tracer keeps its verbose-only gating.
			hookEvents: instTracer !== undefined,
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	}
}

export class RuntimeTransitionResolver<C extends ActorConfig = ActorConfig> implements TransitionResolver<C> {
	private readonly cache = new Map<string, Transition<C>>();

	hasCached(src: StateClass<C>, dest: StateClass<C>): boolean {
		return this.cache.has(getTransitionKey(src, dest));
	}

	resolve(src: StateClass<C>, dest: StateClass<C>): Transition<C> {
		const key = getTransitionKey(src, dest);
		let routine = this.cache.get(key);
		if (routine === undefined) {
			routine = new RuntimeTransitionRoutine(planTransitionClasses(src, dest));
			this.cache.set(key, routine);
		}
		return routine;
	}
}

/** @internal */
export async function executePendingTransition<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>): Promise<void> {
	if (host._transitionState === undefined) {
		if (host.traceLevel === TraceLevel.VERBOSE_DEBUG) {
			host._traceWrite('no transition requested');
		}
		return;
	}
	try {
		const srcState = host.currentState;
		const destState = host._transitionState;
		if (host.traceLevel === TraceLevel.VERBOSE_DEBUG) {
			host._traceWrite(`requested transition from ${getStateName(srcState)} to ${getStateName(destState)} `);
			const runtimeResolver = resolver as RuntimeTransitionResolver<C>;
			if (runtimeResolver.hasCached(srcState, destState)) {
				host._traceWrite(`transition cache hit for ${getStateName(srcState)} to ${getStateName(destState)} `);
			} else {
				host._traceWrite(`transition cache miss for ${getStateName(srcState)} to ${getStateName(destState)} `);
			}
		}
		try {
			await resolver.resolve(srcState, destState).execute(host, srcState, destState);
		} catch (transitionError) {
			host.currentState = FatalErrorState as unknown as StateClass<C>;
			throw transitionError;
		}
	} finally {
		host._transitionState = undefined;
	}
}

//#region Service / notification dispatch tasks

async function completePendingTransitions<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>, onComplete: () => void): Promise<void> {
	await executePendingTransition(host, resolver);
	onComplete();
}

async function doError<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>, err: Error, onComplete: () => void): Promise<void> {
	host._transitionState = undefined;
	const messageHandler = host.currentState.prototype.onError;
	try {
		const result = messageHandler.call(host._instance, new EventHandlerError(host, err));
		if (result) {
			await result;
		}
		await completePendingTransitions(host, resolver, onComplete);
	} catch (recoveryErr) {
		if (recoveryErr instanceof TransitionError) {
			throw new FatalError(host, recoveryErr);
		}
		const recoveryError = asError(recoveryErr);
		host.transition(FatalErrorState as unknown as StateClass<C>);
		await completePendingTransitions(host, resolver, onComplete);
		throw new FatalError(host, recoveryError);
	}
}

async function doUnhandledEvent<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>, error: UnhandledEventError<C>, onComplete: () => void): Promise<void> {
	try {
		const result = host.currentState.prototype.onUnhandled.call(host._instance, error);
		if (result) {
			await result;
		}
		await completePendingTransitions(host, resolver, onComplete);
	} catch (recoveryErr) {
		if (recoveryErr instanceof TransitionError) {
			host.currentState = FatalErrorState as unknown as StateClass<C>;
			throw recoveryErr;
		}
		await doError(host, resolver, asError(recoveryErr), onComplete);
	}
}

async function invokeHandler<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>, name: string, args: readonly unknown[], options: { recover?: boolean } = {}): Promise<unknown> {
	const recover = options.recover ?? false;
	const finishEvent = (): void => {
		host._currentEventName = undefined;
		host._currentEventPayload = undefined;
	};
	host._currentEventName = name;
	host._currentEventPayload = [...args];
	try {
		const eventHandler = lookupEventHandler(host, name);
		if (!eventHandler) {
			await doUnhandledEvent(host, resolver, new UnhandledEventError(host), finishEvent);
			return undefined;
		}
		try {
			const result = eventHandler.call(host._instance, ...args);
			const settled = result instanceof Promise ? await result : result;
			await completePendingTransitions(host, resolver, finishEvent);
			return settled;
		} catch (recoveryErr) {
			if (recoveryErr instanceof UnhandledEventError) {
				await doUnhandledEvent(host, resolver, recoveryErr, finishEvent);
				return undefined;
			}
			if (recoveryErr instanceof TransitionError) {
				finishEvent();
				throw recoveryErr;
			}
			if (recover) {
				await doError(host, resolver, asError(recoveryErr), finishEvent);
				return undefined;
			}
			finishEvent();
			throw asError(recoveryErr);
		}
	} catch (err) {
		finishEvent();
		throw err;
	}
}

//#region DispatchStrategy

type DispatchStrategy<C extends ActorConfig> = {
	executeInit(hsm: HsmWithTracing<C>): Promise<void>;
	dispatchEvent(hsm: HsmWithTracing<C>, resolver: TransitionResolver<C>, eventName: string, ...eventPayload: unknown[]): Promise<void>;
};

async function executeInitProduction<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
	let currState: StateClass<C> = hsm.topState;
	try {
		while (true) {
			const proto = currState.prototype;
			if (proto.hasOwnProperty('onEntry')) {
				proto.onEntry.call(hsm._instance);
			}
			if (hasInitialState(currState)) {
				currState = getInitialState(currState);
			} else break;
		}
		hsm.currentState = currState;
	} catch (cause) {
		if (cause instanceof TransitionError) {
			throw cause;
		}
		hsm.currentState = FatalErrorState as unknown as StateClass<C>;
		throw new InitializationError(hsm, currState, asError(cause));
	}
}

async function executeInitDebug<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
	hsm._traceWrite('begin initialization');
	try {
		let currState: StateClass<C> = hsm.topState;
		hsm._tracePush(`initialize`, `started initialization from ${getStateName(hsm.topState)}`);
		try {
			while (true) {
				if (Object.prototype.hasOwnProperty.call(currState.prototype, 'onEntry')) {
					currState.prototype['onEntry'].call(hsm._instance);
				}
				if (hasInitialState(currState)) {
					currState = getInitialState(currState);
				} else {
					break;
				}
			}
			hsm._tracePopDone(`final state is ${getStateName(currState)}`);
			hsm.currentState = currState;
		} catch (cause) {
			if (cause instanceof TransitionError) {
				throw cause;
			}
			hsm._tracePopError(`initialization failed from top state '${getStateName(hsm.topState)}' as ${getStateName(currState)}.onEntry() handler has raised ${quoteUnknown(cause)}; final state is ${getStateName(FatalErrorState)}`);
			hsm.currentState = FatalErrorState as unknown as StateClass<C>;
			throw new InitializationError(hsm, currState, asError(cause));
		}
	} finally {
		hsm._traceWrite('end initialization');
	}
}

async function executeInitVerbose<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
	hsm._traceWrite('begin initialization');
	try {
		let currState: StateClass<C> = hsm.topState;
		hsm._tracePush(`initialize`, `started initialization from ${getStateName(hsm.topState)}`);
		try {
			while (true) {
				if (Object.prototype.hasOwnProperty.call(currState.prototype, 'onEntry')) {
					currState.prototype['onEntry'].call(hsm._instance);
					hsm._traceWrite(`${getStateName(currState)}.onEntry() done`);
				} else {
					hsm._traceWrite(`skip ${getStateName(currState)}.onEntry(): default empty implementation`);
				}

				if (hasInitialState(currState)) {
					const newInitialState = getInitialState(currState);
					hsm._traceWrite(`${getStateName(currState)} initial state is ${getStateName(newInitialState)}`);
					currState = newInitialState;
				} else {
					hsm._traceWrite(`${getStateName(currState)} has no initial state; final state is ${getStateName(currState)}`);
					break;
				}
			}
			hsm._tracePopDone(`final state is ${getStateName(currState)}`);
			hsm.currentState = currState;
		} catch (cause) {
			if (cause instanceof TransitionError) {
				throw cause;
			}
			hsm._tracePopError(`initialization failed from top state '${getStateName(hsm.topState)}' as ${getStateName(currState)}.onEntry() handler has raised ${quoteUnknown(cause)}; final state is ${getStateName(FatalErrorState)}`);
			hsm.currentState = FatalErrorState as unknown as StateClass<C>;
			throw new InitializationError(hsm, currState, asError(cause));
		}
	} finally {
		hsm._traceWrite('end initialization');
	}
}

async function dispatchEventProduction<C extends ActorConfig>(hsm: HsmWithTracing<C>, resolver: TransitionResolver<C>, eventName: string, ...eventPayload: unknown[]): Promise<void> {
	await invokeHandler(hsm, resolver, eventName, eventPayload, { recover: true });
}

function debugFinishEventDispatch<C extends ActorConfig>(hsm: HsmWithTracing<C>): void {
	hsm._traceWrite(`end event dispatch`);
	hsm._currentEventName = undefined;
	hsm._currentEventPayload = undefined;
}

async function debugDoError<C extends ActorConfig>(hsm: HsmWithTracing<C>, resolver: TransitionResolver<C>, err: Error, onComplete: () => void): Promise<void> {
	hsm._transitionState = undefined;
	hsm._tracePush(`error recovery`, `started error recovery`);
	try {
		hsm._tracePush('execute', 'started #onError handler execution');
		const result = hsm.currentState.prototype.onError.call(hsm._instance, new EventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		hsm._tracePopDone('error handler execution successful');
		await completePendingTransitions(hsm, resolver, () => {
			hsm._tracePopDone('error recovery successful');
			onComplete();
		});
	} catch (recoveryErr) {
		hsm._tracePopError(`error handler execution failure: ${quoteUnknown(recoveryErr)}`);
		if (recoveryErr instanceof TransitionError) {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(recoveryErr)}`);
			throw new FatalError(hsm, recoveryErr);
		}
		const recoveryError = asError(recoveryErr);
		hsm.transition(FatalErrorState as unknown as StateClass<C>);
		await completePendingTransitions(hsm, resolver, () => {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(recoveryError)}`);
			onComplete();
		});
		throw new FatalError(hsm, recoveryError);
	}
}

async function debugDoUnhandledEvent<C extends ActorConfig>(hsm: HsmWithTracing<C>, resolver: TransitionResolver<C>, error: UnhandledEventError<C>, onComplete: () => void): Promise<void> {
	hsm._tracePush('unhandled recovery', `started unhandled event recovery`);
	try {
		hsm._tracePush('execute', 'started #onUnhandled handler execution');
		const result = hsm.currentState.prototype.onUnhandled.call(hsm._instance, error);
		if (result) {
			await result;
		}
		hsm._tracePopDone('unhandled handler execution successful');
		await completePendingTransitions(hsm, resolver, () => {
			hsm._tracePopDone('unhandled event recovery successful');
			onComplete();
		});
	} catch (recoveryErr) {
		hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(recoveryErr)}`);

		if (recoveryErr instanceof TransitionError) {
			hsm.currentState = FatalErrorState as unknown as StateClass<C>;
			hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(recoveryErr)}`);
			throw recoveryErr;
		}

		try {
			await debugDoError(hsm, resolver, asError(recoveryErr), () => {
				hsm._tracePopDone('unhandled event recovery successful');
				onComplete();
			});
		} catch (nestedErr) {
			hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(nestedErr)}`);
			throw nestedErr;
		}
	}
}

async function dispatchEventDebug<C extends ActorConfig>(hsm: HsmWithTracing<C>, resolver: TransitionResolver<C>, eventName: string, ...eventPayload: unknown[]): Promise<void> {
	const eventLabel = String(eventName);
	hsm._traceWrite(`begin event dispatch of #${eventLabel}`);
	hsm._tracePush(`#${eventLabel}`, `started event dispatch`);
	hsm._currentEventName = eventLabel;
	hsm._currentEventPayload = eventPayload;
	try {
		const eventHandler = lookupEventHandler(hsm, eventName);

		if (!eventHandler) {
			try {
				await debugDoUnhandledEvent(hsm, resolver, new UnhandledEventError(hsm), () => {
					hsm._tracePopDone('event dispatch successful');
					debugFinishEventDispatch(hsm);
				});
				return;
			} catch (recoveryErr) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				debugFinishEventDispatch(hsm);
				throw recoveryErr;
			}
		}

		try {
			hsm._tracePush('execute', 'started event handler execution');
			const result = eventHandler.call(hsm._instance, ...eventPayload);
			if (result) {
				await result;
			}
			hsm._tracePopDone('event handler execution successful');
			await completePendingTransitions(hsm, resolver, () => {
				hsm._tracePopDone(`event dispatch successful`);
				debugFinishEventDispatch(hsm);
			});
		} catch (recoveryErr) {
			hsm._tracePopError(quoteUnknown(recoveryErr));
			if (recoveryErr instanceof UnhandledEventError) {
				try {
					await debugDoUnhandledEvent(hsm, resolver, recoveryErr, () => {
						hsm._tracePopDone('event dispatch successful');
						debugFinishEventDispatch(hsm);
					});
					return;
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					debugFinishEventDispatch(hsm);
					throw nestedErr;
				}
			} else if (recoveryErr instanceof TransitionError) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				debugFinishEventDispatch(hsm);
				throw recoveryErr;
			} else {
				try {
					await debugDoError(hsm, resolver, asError(recoveryErr), () => {
						hsm._tracePopDone('event dispatch successful');
						debugFinishEventDispatch(hsm);
					});
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					debugFinishEventDispatch(hsm);
					throw nestedErr;
				}
			}
		}
	} catch (err) {
		debugFinishEventDispatch(hsm);
		throw err;
	}
}

function verboseFinishEventDispatch<C extends ActorConfig>(hsm: HsmWithTracing<C>): void {
	hsm._traceWrite(`end event dispatch`);
	hsm._currentEventName = undefined;
	hsm._currentEventPayload = undefined;
}

async function verboseDoError<C extends ActorConfig>(hsm: HsmWithTracing<C>, resolver: TransitionResolver<C>, err: Error, onComplete: () => void): Promise<void> {
	hsm._transitionState = undefined;
	hsm._tracePush(`error recovery`, `started error recovery`);
	hsm._tracePush(`lookup`, `started lookup of #onError event handler`);
	let errorLookupState = hsm.currentState;
	let messageHandler: ((error: RuntimeError<C>) => Promise<void> | void) | undefined;
	while (errorLookupState != TopState) {
		const errorPrototype = errorLookupState.prototype;
		if (Object.prototype.hasOwnProperty.call(errorPrototype, 'onError')) {
			hsm._tracePopDone(`found in state ${getStateName(errorLookupState)}`);
			messageHandler = errorPrototype['onError'];
			break;
		}
		hsm._traceWrite(`not found in state ${getStateName(errorLookupState)}`);
		errorLookupState = Object.getPrototypeOf(errorLookupState);
	}
	if (messageHandler === undefined) {
		hsm._tracePopDone(`found in state ${getStateName(TopState as StateClass)}`);
		messageHandler = TopState.prototype.onError as (error: RuntimeError<C>) => void | Promise<void>;
	}
	try {
		hsm._tracePush('execute', 'started #onError handler execution');
		const result = messageHandler.call(hsm._instance, new EventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		hsm._tracePopDone('error handler execution successful');
		await completePendingTransitions(hsm, resolver, () => {
			hsm._tracePopDone('error recovery successful');
			onComplete();
		});
	} catch (recoveryErr) {
		hsm._tracePopError(`error handler execution failure: ${quoteUnknown(recoveryErr)}`);
		if (recoveryErr instanceof TransitionError) {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(recoveryErr)}`);
			throw recoveryErr;
		}
		const recoveryError = asError(recoveryErr);
		hsm.transition(FatalErrorState as unknown as StateClass<C>);
		await completePendingTransitions(hsm, resolver, () => {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(recoveryError)}`);
			onComplete();
		});
		throw new FatalError(hsm, recoveryError);
	}
}

async function verboseDoUnhandledEvent<C extends ActorConfig>(hsm: HsmWithTracing<C>, resolver: TransitionResolver<C>, error: UnhandledEventError<C>, onComplete: () => void): Promise<void> {
	hsm._tracePush('unhandled recovery', `started unhandled event recovery`);
	let unhandledLookupState = hsm.currentState;
	hsm._tracePush(`lookup`, `started lookup of #onUnhandled event handler`);
	let messageHandler: (error: UnhandledEventError<C>) => Promise<void> | void;
	while (true) {
		const unhandledPrototype = unhandledLookupState.prototype;
		if (Object.prototype.hasOwnProperty.call(unhandledPrototype, 'onUnhandled')) {
			hsm._tracePopDone(`found in state ${getStateName(unhandledLookupState)}`);
			messageHandler = unhandledPrototype.onUnhandled;
			break;
		}
		hsm._traceWrite(`not found in state ${getStateName(unhandledLookupState)}`);
		unhandledLookupState = Object.getPrototypeOf(unhandledLookupState);
		if (unhandledLookupState == TopState) {
			hsm._tracePopDone(`found in state ${getStateName(unhandledLookupState)}`);
			messageHandler = unhandledPrototype.onUnhandled;
			break;
		}
	}
	try {
		hsm._tracePush('execute', 'started #onUnhandled handler execution');
		const result = messageHandler.call(hsm._instance, error);
		if (result) {
			await result;
		}
		hsm._tracePopDone('unhandled handler execution successful');
		await completePendingTransitions(hsm, resolver, () => {
			hsm._tracePopDone('unhandled event recovery successful');
			onComplete();
		});
	} catch (recoveryErr) {
		hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(recoveryErr)}`);

		if (recoveryErr instanceof TransitionError) {
			hsm.currentState = FatalErrorState as unknown as StateClass<C>;
			hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(recoveryErr)}`);
			throw recoveryErr;
		}

		try {
			await verboseDoError(hsm, resolver, asError(recoveryErr), () => {
				hsm._tracePopDone('unhandled event recovery successful');
				onComplete();
			});
		} catch (nestedErr) {
			hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(nestedErr)}`);
			throw nestedErr;
		}
	}
}

async function dispatchEventVerbose<C extends ActorConfig>(hsm: HsmWithTracing<C>, resolver: TransitionResolver<C>, eventName: string, ...eventPayload: unknown[]): Promise<void> {
	const eventLabel = String(eventName);
	hsm._traceWrite(`begin event dispatch of #${eventLabel}`);
	hsm._tracePush(`#${eventLabel}`, `started event dispatch`);
	hsm._currentEventName = eventLabel;
	hsm._currentEventPayload = eventPayload;
	try {
		const eventHandler = lookupEventHandler(hsm, eventName);

		if (!eventHandler) {
			hsm._traceWrite(`event #${eventLabel} is unhandled in state ${hsm.currentStateName}`);
			try {
				await verboseDoUnhandledEvent(hsm, resolver, new UnhandledEventError(hsm), () => {
					hsm._tracePopDone('event dispatch successful');
					verboseFinishEventDispatch(hsm);
				});
				return;
			} catch (recoveryErr) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				verboseFinishEventDispatch(hsm);
				throw recoveryErr;
			}
		}

		try {
			hsm._tracePush('execute', 'started event handler execution');
			const result = eventHandler.call(hsm._instance, ...eventPayload);
			if (result) {
				await result;
			}
			hsm._tracePopDone('event handler execution successful');
			await completePendingTransitions(hsm, resolver, () => {
				hsm._tracePopDone(`event dispatch successful`);
				verboseFinishEventDispatch(hsm);
			});
		} catch (recoveryErr) {
			hsm._tracePopError(quoteUnknown(recoveryErr));
			if (recoveryErr instanceof UnhandledEventError) {
				hsm._traceWrite(`event #${eventLabel} is unhandled in state ${hsm.currentStateName}`);
				try {
					await verboseDoUnhandledEvent(hsm, resolver, recoveryErr, () => {
						hsm._tracePopDone('event dispatch successful');
						verboseFinishEventDispatch(hsm);
					});
					return;
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					verboseFinishEventDispatch(hsm);
					throw nestedErr;
				}
			} else if (recoveryErr instanceof TransitionError) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				verboseFinishEventDispatch(hsm);
				throw recoveryErr;
			} else {
				try {
					await verboseDoError(hsm, resolver, asError(recoveryErr), () => {
						hsm._tracePopDone('event dispatch successful');
						verboseFinishEventDispatch(hsm);
					});
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					verboseFinishEventDispatch(hsm);
					throw nestedErr;
				}
			}
		}
	} catch (err) {
		verboseFinishEventDispatch(hsm);
		throw err;
	}
}

const productionDispatchStrategy: DispatchStrategy<ActorConfig> = {
	executeInit: executeInitProduction,
	dispatchEvent: dispatchEventProduction,
};

const debugDispatchStrategy: DispatchStrategy<ActorConfig> = {
	executeInit: executeInitDebug,
	dispatchEvent: dispatchEventDebug,
};

const verboseDispatchStrategy: DispatchStrategy<ActorConfig> = {
	executeInit: executeInitVerbose,
	dispatchEvent: dispatchEventVerbose,
};

function dispatchStrategyFor<C extends ActorConfig>(traceLevel: TraceLevel): DispatchStrategy<C> {
	switch (traceLevel) {
		case TraceLevel.PRODUCTION:
			return productionDispatchStrategy as DispatchStrategy<C>;
		case TraceLevel.DEBUG:
			return debugDispatchStrategy as DispatchStrategy<C>;
		case TraceLevel.VERBOSE_DEBUG:
			return verboseDispatchStrategy as DispatchStrategy<C>;
	}
}

//#endregion

/** @internal */
export function createInitTask<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>): Task {
	const strategy = dispatchStrategyFor(host.traceLevel);
	return (done: DoneCallback): void => {
		strategy
			.executeInit(host)
			.then(() => executePendingTransition(host, resolver))
			.then(() => done())
			.catch((err: unknown) => {
				host.reportDispatchError(asError(err));
				done();
			});
	};
}

/**
 * Run a dispatch body inside the ambient `dispatchContext` token so that any `notify`/`call`/timer
 * the handler issues can be attributed to the running `(macrostepId, stepSeq)` (CORE-B, §5.6.3).
 * Falls back to a plain run when no ALS is available (browser) or the host predates the seam.
 */
function runWithinDispatch<C extends ActorConfig>(host: HsmWithTracing<C>, run: () => void): void {
	const machine = host as unknown as { buildDispatchToken?: () => DispatchToken; needsDispatchContext?: () => boolean };
	const wants: boolean = machine.needsDispatchContext?.() ?? host.traceLevel !== TraceLevel.PRODUCTION;
	if (!wants) {
		run();
		return;
	}
	const storage = dispatchContext.get();
	if (storage === undefined) {
		run();
		return;
	}
	const token: DispatchToken = machine.buildDispatchToken?.() ?? { machine: host as unknown as DispatchableMachine };
	storage.run(token, run);
}

function currentPortCallToken(): PortCallToken | undefined {
	const storage = portCallContext.get();
	return storage?.getStore() as PortCallToken | undefined;
}

/** @internal */
export function createNotificationTask<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>, name: string, args: readonly unknown[]): Task {
	const strategy = dispatchStrategyFor(host.traceLevel);
	return (done: DoneCallback): void => {
		runWithinDispatch(host, () => {
			void strategy
				.dispatchEvent(host, resolver, name, ...args)
				.catch((err: unknown) => host.reportDispatchError(asError(err)))
				.finally(() => done());
		});
	};
}

/** @internal */
export function createServiceTask<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>, name: string, args: readonly unknown[], resolve: (value: unknown) => void, reject: (error: Error) => void): Task {
	return (done: DoneCallback): void => {
		const run = (): Promise<void> =>
			invokeHandler(host, resolver, name, args)
				.then(resolve)
				.catch((err: unknown) => {
					reject(asError(err));
				})
				.catch((err: unknown) => host.reportDispatchError(asError(err)))
				.finally(() => done());
		runWithinDispatch(host, () => {
			void run();
		});
	};
}

//#endregion

//#region hsm

/** @internal */
export class HsmObject<C extends ActorConfig> implements HsmWithTracing<C> {
	public topState: StateClass<C>;
	public topStateName: string;
	public readonly ctxTypeName: string;
	public traceWriter: TraceWriter;
	public readonly actorUuid: string;
	public readonly actorName: string;
	public readonly actorPath: string;

	/** @internal */
	public _instance: Instance<C>;
	/** @internal */
	public _jobs: Task[];
	/** @internal */
	public _hiPriorityJobs: Task[];
	private _isRunning = false;
	public _transitionState?: StateClass<C>;

	public _currentEventName?: string;
	public _currentEventPayload?: unknown[];
	private _observers?: Set<EventObserver>;
	public dispatchErrorCallback: DispatchErrorCallback<C>;
	private _traceLevel: TraceLevel;
	private _traceDomainStack: string[];
	protected _instrumentationHost?: InstrumentationHost;
	private _drainWaiters: Array<() => void> = [];
	private _tasksSinceYield = 0;
	private _sliceStart = 0;
	/** @internal Pending actor initialization — always runs before hi-priority work. */
	public _initTask?: Task;

	constructor(TopState: StateClass<C>, instance: Instance<C>, traceWriter: TraceWriter, traceLevel: TraceLevel, dispatchErrorCallback: DispatchErrorCallback<C>, identity: ActorIdentity) {
		this._instance = instance;
		this._transitionState = undefined;
		this._traceLevel = traceLevel;
		this._currentEventName = undefined;
		this._currentEventPayload = undefined;
		this._traceDomainStack = [];
		this._jobs = [];
		this._hiPriorityJobs = [];
		this._isRunning = false;
		this.actorUuid = identity.uuid;
		this.actorName = identity.name;
		this.actorPath = identity.path;

		this.topState = TopState;
		this.topStateName = getStateName(TopState);
		this.ctxTypeName = Object.getPrototypeOf(instance.ctx).constructor.name;
		this.currentState = TopState;
		this.traceWriter = traceWriter;
		this.dispatchErrorCallback = dispatchErrorCallback;
	}

	get ctx(): ActorContextOf<C> {
		return this._instance.ctx;
	}
	set ctx(ctx: ActorContextOf<C>) {
		this._instance.ctx = ctx;
	}

	get port(): unknown {
		return this._instance.portRef;
	}

	/** The bound port when it provides a timer service, so service-call timeouts honour a virtual clock. */
	get callTimer(): TimerService | undefined {
		const port = this._instance.portRef as Partial<TimerService> | undefined;
		if (port !== undefined && typeof port.setTimeout === 'function' && typeof port.clearTimeout === 'function') {
			return port as TimerService;
		}
		return undefined;
	}

	get eventName(): string {
		return this._currentEventName ?? '';
	}

	get eventPayload(): unknown[] {
		return this._currentEventPayload ?? [];
	}
	get currentStateName(): string {
		return getStateName(Object.getPrototypeOf(this._instance).constructor);
	}
	get currentState(): StateClass<C> {
		return Object.getPrototypeOf(this._instance).constructor;
	}
	set currentState(newState: StateClass<C>) {
		Object.setPrototypeOf(this._instance, newState.prototype);
	}

	subscribe(observer: EventObserver): Disposable {
		if (this._observers === undefined) this._observers = new Set();
		this._observers.add(observer);
		return {
			dispose: (): void => {
				this._observers?.delete(observer);
			},
		};
	}

	private _notifyObservers(eventName: string | number | symbol, eventPayload: unknown[]): void {
		if (this._observers === undefined || this._observers.size === 0) return;
		const message = { event: String(eventName), payload: [...eventPayload] };
		for (const observer of this._observers) observer(message);
	}

	protected recordObserverEvent(eventName: string | number | symbol, eventPayload: unknown[]): void {
		this._notifyObservers(eventName, eventPayload);
	}

	transition(nextState: StateClass<C>): void {
		this._transitionState = nextState;
	}
	unhandled(): never {
		throw new UnhandledEventError(this as never);
	}

	get traceLevel(): TraceLevel {
		return this._traceLevel;
	}

	set traceLevel(traceLevel: TraceLevel) {
		this._traceLevel = traceLevel;
	}

	/**
	 * Resolve when the actor next reaches stability (mailbox fully drained).
	 *
	 * The resolver fires at the queue-drain point — *after* {@link InstrumentationHost.onQueuesDrained}
	 * — so the closing `macrostep.end` and the macrostep-boundary reset are observable before `sync()`
	 * resolves, and a subsequent external stimulus deterministically starts its own macrostep. The
	 * pushed task is a no-op (internal) whose only purpose is to guarantee a drain cycle occurs.
	 */
	sync(): Promise<void> {
		return new Promise(resolve => {
			this._drainWaiters.push(resolve);
			const task: Task = (doneCallback: DoneCallback): void => {
				doneCallback();
			};
			setTaskMeta(task, { internal: true });
			this.pushTask(task);
		});
	}

	/** Invoke the user dispatch-error callback, first notifying instrumentation (pure observer). */
	public reportDispatchError(err: Error): void {
		this._instrumentationHost?.onDispatchError(err);
		this.dispatchErrorCallback(this as never, err);
	}

	private flushDrainWaiters(): void {
		if (this._drainWaiters.length === 0) return;
		const waiters: Array<() => void> = this._drainWaiters;
		this._drainWaiters = [];
		for (const resolve of waiters) resolve();
	}

	protected enqueueInitTask(task: Task): void {
		this._initTask = task;
		if (this._isRunning) return;
		this._isRunning = true;
		this.scheduleKickoff();
	}

	public pushTask(t: Task): void {
		this.enqueueTask(t, this._jobs);
	}

	public pushHiPriorityTask(t: Task): void {
		this.enqueueTask(t, this._hiPriorityJobs);
	}

	public unshiftHiPriorityTask(t: Task): void {
		this._hiPriorityJobs.unshift(t);
		if (this._isRunning) return;
		this._isRunning = true;
		this.scheduleKickoff();
	}

	private enqueueTask(t: Task, queue: Task[]): void {
		queue.push(t);
		if (this._isRunning) return;
		this._isRunning = true;
		this.scheduleKickoff();
	}

	private scheduleKickoff(): void {
		queueMicrotask(() => this.dequeue());
	}

	public restore(state: StateClass<C>, ctx: ActorContextOf<C>): void {
		this.currentState = state;
		this.ctx = ctx;
	}

	private dequeue(): void {
		if (this._initTask === undefined && this._hiPriorityJobs.length == 0 && this._jobs.length == 0) {
			this._isRunning = false;
			this._instrumentationHost?.onQueuesDrained();
			this.flushDrainWaiters();
			return;
		}
		if (this._initTask !== undefined) {
			const task = this._initTask;
			this._initTask = undefined;
			this.exec(task);
			return;
		}
		const task = this._hiPriorityJobs.length > 0 ? this._hiPriorityJobs.shift()! : this._jobs.shift()!;
		this.exec(task);
	}

	private exec(task: Task): void {
		if (this._tasksSinceYield === 0) {
			this._sliceStart = nowMs();
		}
		void this.runTask(task).then(() => {
			this._tasksSinceYield++;
			const overBudget = this._tasksSinceYield >= YIELD_TASK_BUDGET || nowMs() - this._sliceStart >= YIELD_TIME_BUDGET_MS;
			if (overBudget) {
				this._tasksSinceYield = 0;
				yieldToMacrotask(() => this.dequeue());
			} else {
				this.dequeue();
			}
		});
	}

	private runTask(task: Task): Promise<void> {
		this._instrumentationHost?.onTaskBegin(task);
		let outcome: 'ok' | 'error' = 'ok';
		return new Promise<void>(resolve => {
			const runBody = (): void => {
				task(() => {
					this.drainHiPriority()
						.then(() => {
							this._instrumentationHost?.onTaskEnd(task, outcome);
							resolve();
						})
						.catch((_err: unknown) => {
							outcome = 'error';
							this._instrumentationHost?.onTaskEnd(task, outcome);
							resolve();
						});
				});
			};
			try {
				runBody();
			} catch (err: unknown) {
				outcome = 'error';
				this._instrumentationHost?.onTaskEnd(task, outcome);
				resolve();
				throw asError(err);
			}
		});
	}

	private drainHiPriority(): Promise<void> {
		if (this._hiPriorityJobs.length === 0) {
			return Promise.resolve();
		}
		const task = this._hiPriorityJobs.shift()!;
		return this.runTask(task).then(() => this.drainHiPriority());
	}

	public _tracePush(d: string, msg: string): void {
		this._traceDomainStack.push(d);
		this.traceWriter.write(this, msg);
	}

	public _tracePopDone(msg: string): void {
		this.traceWriter.write(this, `done: ${msg}`);
		this._traceDomainStack.pop();
	}

	public _tracePopError(msg: string): void {
		this.traceWriter.write(this, `failure: ${msg}`);
		this._traceDomainStack.pop();
	}

	public _traceWrite(msg: any): void {
		this.traceWriter.write(this, msg);
	}

	get traceHeader(): string {
		return `${this._traceDomainStack.length === 0 ? '' : this._traceDomainStack.join('|') + '|'}`;
	}

	get traceFrames(): readonly TraceFrame[] {
		return this._traceDomainStack.map(name => ({ name, kind: classifyFrameKind(name) }));
	}
}

/** Best-effort classification of a live trace-domain name into a structured {@link TraceFrame.kind}. */
function classifyFrameKind(name: string): TraceFrame['kind'] {
	if (name.startsWith('#')) return 'event';
	if (name === 'execute') return 'handler';
	if (name === 'initialize' || name.startsWith('initialize')) return 'initialize';
	if (name.startsWith('transition')) return 'transition';
	if (name.includes('onEntry')) return 'onEntry';
	if (name.includes('onExit')) return 'onExit';
	return 'handler';
}

//#region machine

export class Machine<C extends ActorConfig> extends HsmObject<C> implements InstrumentationHost {
	readonly transitionResolver: TransitionResolver<C>;
	readonly identity: ActorIdentity;
	readonly instrumentation?: Instrumentation<C>;
	private _dispatchStrategy: DispatchStrategy<C>;
	private readonly protocolIndex: ProtocolIndex;
	private readonly handlerFacade: HandlerHsm<C>;
	private readonly selfActor: SelfNotifications<C>;
	private readonly selfImmediate: SelfNotifications<C>;
	private readonly actorFacades = new Map<EmbodimentKind, ExternalHsm<C> | InboundHsm<C> | ChildHsm<C>>();
	private _macrostepCounter = 0;
	private _currentMacrostep?: {
		id: string;
		trigger: string;
		triggerKind: TriggerKind;
		startState: string;
		stepSeq: number;
		transitioned: boolean;
		outcome: 'ok' | 'error';
		cause?: CauseRef;
	};
	private _microstepFromState?: string;
	private readonly _childSpawnCounters = new Map<string, number>();
	private _nextTraceCallId = 0;
	private _proxiedPort?: ActorPortOf<C>;

	constructor(topState: StateClass<C>, instance: { ctx: ActorContextOf<C>; hsm: HandlerHsm<C>; portRef?: unknown }, protocolIndex: ProtocolIndex, traceWriter: TraceWriter, traceLevel: TraceLevel, dispatchErrorCallback: DispatchErrorCallback<C>, initialize: boolean, identity: ActorIdentity, instrumentation: Instrumentation<C> | undefined, transitionResolver?: TransitionResolver<C>) {
		super(topState, instance as never, traceWriter, traceLevel, dispatchErrorCallback, identity);
		this.identity = identity;
		this.instrumentation = instrumentation;
		if (instrumentation !== undefined) {
			this._instrumentationHost = this;
			notifyActorCreated(instrumentation, identity);
		}
		Object.defineProperty(instance, kHandlerMachine, { value: this, enumerable: false, writable: false, configurable: false });
		this.protocolIndex = protocolIndex;
		cacheProtocolIndex(topState, protocolIndex);
		this.transitionResolver = transitionResolver ?? new RuntimeTransitionResolver();
		this._dispatchStrategy = dispatchStrategyFor(traceLevel);
		this.selfActor = createSelfNotifications(this, topState, protocolIndex, 'default') as SelfNotifications<C>;
		this.selfImmediate = createSelfNotifications(this, topState, protocolIndex, 'priority') as SelfNotifications<C>;
		this.handlerFacade = this.buildHandlerFacade(instance);
		instance.hsm = this.handlerFacade;
		Object.defineProperty(instance, 'notify', { value: this.selfActor, enumerable: true, configurable: true });
		Object.defineProperty(instance, 'notifyNow', { value: this.selfImmediate, enumerable: true, configurable: true });
		this.bindPort(instance.portRef);
		if (initialize) {
			const initTask: Task = createInitTask(this, this.transitionResolver);
			setTaskMeta(initTask, { event: 'initialize', queue: 'default', triggerKind: 'init', internal: false });
			this.enqueueInitTask(initTask);
		}
	}

	allocateChildSpawnIndex(childTopName: string): number {
		const childName: string = actorNameFromTopState(childTopName);
		const index: number = this._childSpawnCounters.get(childName) ?? 0;
		this._childSpawnCounters.set(childName, index + 1);
		return index;
	}

	needsDispatchContext(): boolean {
		return this.instrumentation !== undefined || this.traceLevel !== TraceLevel.PRODUCTION;
	}

	buildDispatchToken(): DispatchToken {
		return {
			machine: this,
			actorUuid: this.actorUuid,
			macrostepId: this._currentMacrostep?.id,
			stepSeq: this._currentMacrostep?.stepSeq,
		};
	}

	private readDispatchCause(kind: CauseRef['kind']): CauseRef | undefined {
		const storage = dispatchContext.get();
		const token: DispatchToken | undefined = storage?.getStore() as DispatchToken | undefined;
		if (token?.actorUuid === undefined) return undefined;
		return {
			actorUuid: token.actorUuid,
			macrostepId: token.macrostepId,
			stepSeq: token.stepSeq,
			kind,
		};
	}

	private nextTraceCallId(): number {
		this._nextTraceCallId += 1;
		return this._nextTraceCallId;
	}

	private beginPortCall(method: string): PortCallBegin | undefined {
		if (this.instrumentation === undefined) return undefined;
		const cause: CauseRef | undefined = this.readDispatchCause('wire');
		const info: PortCallBegin = {
			callId: this.nextTraceCallId(),
			method,
			cause,
		};
		notifyPortCallBegin(this.instrumentation, info);
		return info;
	}

	private endPortCall(begin: PortCallBegin | undefined, outcome: 'ok' | 'error', error?: Error): void {
		if (this.instrumentation === undefined || begin === undefined) return;
		const info: PortCallEnd = {
			callId: begin.callId,
			method: begin.method,
			outcome,
			error,
		};
		notifyPortCallEnd(this.instrumentation, info);
	}

	beginOutboundCall(service: string, targetUuid?: string): OutboundCallBegin | undefined {
		if (this.instrumentation === undefined) return undefined;
		const portToken = currentPortCallToken();
		const cause: CauseRef | undefined = this.readDispatchCause('wire') ?? portToken?.cause;
		const info: OutboundCallBegin = {
			callId: this.nextTraceCallId(),
			service,
			targetUuid,
			cause,
		};
		notifyOutboundCallBegin(this.instrumentation, info);
		return info;
	}

	endOutboundCall(begin: OutboundCallBegin | undefined, outcome: 'ok' | 'error', error?: Error): void {
		if (this.instrumentation === undefined || begin === undefined) return;
		const info: OutboundCallEnd = {
			callId: begin.callId,
			service: begin.service,
			outcome,
			error,
		};
		notifyOutboundCallEnd(this.instrumentation, info);
	}

	private slotBucket(eventName: string): ProtocolBucket {
		return this.protocolIndex.get(eventName)?.bucket ?? 'notifications';
	}

	onTaskBegin(task: Task): void {
		const meta = getTaskMeta(task);
		if (meta?.internal === true || this.instrumentation === undefined) return;
		if (this._currentMacrostep === undefined) {
			const id: string = `${this.actorUuid}:${++this._macrostepCounter}`;
			const trigger: string = meta?.event ?? 'unknown';
			const triggerKind: TriggerKind = meta?.triggerKind ?? (this._jobs.length + this._hiPriorityJobs.length > 0 ? 'self' : 'external');
			this._currentMacrostep = {
				id,
				trigger,
				triggerKind,
				startState: this.currentStateName,
				stepSeq: -1,
				transitioned: false,
				outcome: 'ok',
				cause: meta?.cause,
			};
			notifyMacrostepBegin(this.instrumentation, {
				id,
				actor: this.identity,
				trigger,
				triggerKind,
				startState: this.currentStateName,
				cause: meta?.cause,
				delayMs: meta?.delayMs,
			});
		}
		const macrostep = this._currentMacrostep!;
		macrostep.stepSeq += 1;
		const seq: number = macrostep.stepSeq;
		const fromState: string = this.currentStateName;
		this._microstepFromState = fromState;
		// Stamp seq + fromState on the task so onTaskEnd pairs correctly even when nested priority
		// drains mutate the shared macrostep counter between this task's begin and end.
		if (meta !== undefined) {
			meta.seq = seq;
			meta.fromState = fromState;
		} else {
			setTaskMeta(task, { seq, fromState });
		}
		const eventName: string = meta?.event ?? this.eventName ?? 'unknown';
		const handlerState: string | undefined = lookupHandlerState(this, eventName);
		const storage = dispatchContext.get();
		const runMicrostep = (): void => {
			notifyMicrostepBegin(this.instrumentation, {
				macrostepId: macrostep.id,
				seq,
				event: eventName,
				bucket: this.slotBucket(eventName),
				queue: meta?.queue ?? 'default',
				fromState: this.currentStateName,
				handlerState,
				cause: meta?.cause,
			});
		};
		if (storage !== undefined && this.needsDispatchContext()) {
			storage.run(this.buildDispatchToken(), runMicrostep);
		} else {
			runMicrostep();
		}
	}

	onTaskEnd(task: Task, outcome: 'ok' | 'error'): void {
		const meta = getTaskMeta(task);
		if (meta?.internal === true || this.instrumentation === undefined || this._currentMacrostep === undefined) return;
		const macrostep = this._currentMacrostep;
		const fromState: string = meta?.fromState ?? this._microstepFromState ?? macrostep.startState;
		const seq: number = meta?.seq ?? macrostep.stepSeq;
		const transitioned: boolean = this.currentStateName !== fromState;
		if (transitioned) macrostep.transitioned = true;
		if (outcome === 'error') macrostep.outcome = 'error';
		notifyMicrostepEnd(this.instrumentation, {
			macrostepId: macrostep.id,
			seq,
			toState: this.currentStateName,
			transitioned,
			async: false,
			outcome,
		});
	}

	onDispatchError(err: Error): void {
		if (this.instrumentation === undefined) return;
		notifyError(this.instrumentation, {
			phase: errorPhaseFromError(err),
			errorClass: err.name,
			error: err,
			recovered: false,
		});
	}

	onQueuesDrained(): void {
		if (this.instrumentation === undefined || this._currentMacrostep === undefined) return;
		const macrostep = this._currentMacrostep;
		notifyMacrostepEnd(this.instrumentation, {
			id: macrostep.id,
			endState: this.currentStateName,
			steps: macrostep.stepSeq + 1,
			transitioned: macrostep.transitioned,
			outcome: macrostep.outcome,
		});
		this._currentMacrostep = undefined;
	}

	private resolveEnqueueCause(): CauseRef {
		const inherited: CauseRef | undefined = this.readDispatchCause('message');
		if (inherited === undefined) {
			return { actorUuid: this.actorUuid, kind: 'cause' };
		}
		if (inherited.actorUuid !== this.actorUuid) {
			return inherited;
		}
		return { ...inherited, kind: 'cause' };
	}

	private enqueueWithInstrumentation(task: Task, event: string, queue: NotificationQueue, triggerKind: TriggerKind): void {
		const cause: CauseRef = this.resolveEnqueueCause();
		setTaskMeta(task, { event, queue, cause, triggerKind });
		notifyEnqueue(this.instrumentation, {
			event,
			queue,
			cause,
			targetUuid: this.actorUuid,
		});
		if (queue === 'priority') {
			this.pushHiPriorityTask(task);
		} else {
			this.pushTask(task);
		}
	}

	override get traceLevel(): TraceLevel {
		return super.traceLevel;
	}

	override set traceLevel(traceLevel: TraceLevel) {
		super.traceLevel = traceLevel;
		this._dispatchStrategy = dispatchStrategyFor(traceLevel);
	}

	dispatchService(name: string, args: unknown[]): Promise<unknown> {
		if (this.traceLevel !== TraceLevel.PRODUCTION) {
			const storage = dispatchContext.get();
			const token = storage?.getStore() as DispatchToken | undefined;
			if (token?.machine === this) {
				throw new SelfCallDeadlockError();
			}
		}
		this.recordObserverEvent(name, args);
		return new Promise<unknown>((resolve, reject) => {
			const task: Task = createServiceTask(this, this.transitionResolver, name, args, resolve, reject);
			if (this.instrumentation !== undefined) {
				this.enqueueWithInstrumentation(task, name, 'default', 'call');
				return;
			}
			this.pushTask(task);
		});
	}

	dispatchNotification(name: string, args: unknown[], queue: NotificationQueue): void {
		this.recordObserverEvent(name, args);
		const task = createNotificationTask(this, this.transitionResolver, name, args);
		if (this.instrumentation !== undefined) {
			const triggerKind: TriggerKind = this._currentMacrostep === undefined ? 'external' : 'self';
			this.enqueueWithInstrumentation(task, name, queue, triggerKind);
			return;
		}
		if (queue === 'priority') {
			this.pushHiPriorityTask(task);
		} else {
			this.pushTask(task);
		}
	}

	actorHsmFor(kind: EmbodimentKind): ExternalHsm<C> | InboundHsm<C> | ChildHsm<C> {
		let facade = this.actorFacades.get(kind);
		if (facade === undefined) {
			facade = this.buildActorHsm(kind);
			this.actorFacades.set(kind, facade);
		}
		return facade;
	}

	private scheduleNotification(ms: number, name: string, args: unknown[]): void {
		const port = this._instance.portRef as IPort<C> | undefined;
		if (port === undefined) {
			throw new Error('ihsm: deferred notification requires a port');
		}
		if (this.instrumentation === undefined) {
			port.setTimeout(() => this.dispatchNotification(name, args, 'default'), ms);
			return;
		}
		// Capture the arming step's dispatch token now (the timer fires later while the actor is idle,
		// so the ambient token is gone by then). The fired macrostep links back to it as `timer` (§5.3.1).
		const armed: CauseRef | undefined = this.readDispatchCause('timer');
		const cause: CauseRef = armed ?? { actorUuid: this.actorUuid, kind: 'timer' };
		port.setTimeout(() => this.enqueueTimerNotification(name, args, cause, ms), ms);
	}

	private enqueueTimerNotification(name: string, args: unknown[], cause: CauseRef, delayMs: number): void {
		this.recordObserverEvent(name, args);
		const task = createNotificationTask(this, this.transitionResolver, name, args);
		setTaskMeta(task, { event: name, queue: 'default', cause, triggerKind: 'timer', delayMs });
		notifyEnqueue(this.instrumentation, { event: name, queue: 'default', cause, delayMs, targetUuid: this.actorUuid });
		this.pushTask(task);
	}

	private _actorLogger?: ActorLogger;

	/** Severity-typed handler logger surfaced as `this.hsm.log.*` (CORE-F, §4.10.1). */
	get logger(): ActorLogger {
		if (this._actorLogger === undefined) {
			const emit = (severity: LogRecord['severity'], message: string | Error, attributes?: LogAttributes): void => this.emitUserLog(severity, message, attributes);
			this._actorLogger = {
				trace: (m, a) => emit('trace', m, a),
				debug: (m, a) => emit('debug', m, a),
				info: (m, a) => emit('info', m, a),
				warn: (m, a) => emit('warn', m, a),
				error: (m, a) => emit('error', m, a),
				fatal: (m, a) => emit('fatal', m, a),
			};
		}
		return this._actorLogger;
	}

	private emitUserLog(severity: LogRecord['severity'], message: string | Error, attributes?: LogAttributes): void {
		const isError: boolean = message instanceof Error;
		const text: string = isError ? (message as Error).message : (message as string);
		const body = `${this.traceHeader}${this.currentStateName}: ${text}`;
		// User logs fire on intent and are never TraceLevel-gated; mirror to the TraceWriter for console.
		this.traceWriter.write(this, body);
		if (this.instrumentation === undefined) return;
		const record: LogRecord = {
			severity,
			body,
			attributes,
			frames: this.traceFrames,
			error: isError ? (message as Error) : undefined,
			source: 'user',
		};
		notifyLog(this.instrumentation, record);
	}

	/** @internal Binds deferred self-notifications to a port instance. */
	bindPort(portRef: unknown): void {
		if (portRef instanceof Port) {
			(portRef as Port<TopStateArg<C>>).bindDeferredNotifications(ms => this.createDeferredSelfNotifications(ms));
		}
	}

	private buildHandlerFacade(instance: { portRef?: unknown }): HandlerHsm<C> {
		const machine = this;
		const facade: HandlerHsm<C> = {
			get ctx(): ActorContextOf<C> {
				return machine.ctx;
			},
			transition: next => machine.transition(next as StateClass<C>),
			get port(): ActorPortOf<C> {
				const rawPort = instance.portRef as ActorPortOf<C>;
				if (machine.instrumentation === undefined || rawPort === undefined || typeof rawPort !== 'object') {
					return rawPort;
				}
				if (machine._proxiedPort !== undefined) return machine._proxiedPort;
				const proxy = new Proxy(rawPort as object, {
					get(target: object, prop: string | symbol, receiver: unknown): unknown {
						const value = Reflect.get(target, prop, receiver);
						if (typeof value !== 'function') return value;
						const method = String(prop);
						return (...args: unknown[]): unknown => {
							const begin = machine.beginPortCall(method);
							if (begin === undefined) {
								return Reflect.apply(value as Function, target, args);
							}
							const call = (): unknown => Reflect.apply(value as Function, target, args);
							const storage = portCallContext.get();
							try {
								const result = storage !== undefined ? storage.run({ machine, callId: begin.callId, method, cause: begin.cause }, call) : call();
								if (result instanceof Promise) {
									return result.then(
										(value: unknown) => {
											machine.endPortCall(begin, 'ok');
											return value;
										},
										(cause: unknown) => {
											const err = asError(cause);
											machine.endPortCall(begin, 'error', err);
											throw err;
										}
									);
								}
								machine.endPortCall(begin, 'ok');
								return result;
							} catch (cause) {
								const err = asError(cause);
								machine.endPortCall(begin, 'error', err);
								throw err;
							}
						};
					},
				}) as ActorPortOf<C>;
				machine._proxiedPort = proxy;
				return proxy;
			},
			unhandled: () => machine.unhandled(),
			get eventName(): string {
				return machine.eventName;
			},
			get eventPayload(): unknown[] {
				return machine.eventPayload;
			},
			get currentState(): StateClass<C> {
				return machine.currentState as StateClass<C>;
			},
			get currentStateName(): string {
				return machine.currentStateName;
			},
			get topState(): StateClass<C> {
				return machine.topState as StateClass<C>;
			},
			get topStateName(): string {
				return machine.topStateName;
			},
			get traceHeader(): string {
				return machine.traceHeader;
			},
			get traceFrames(): readonly TraceFrame[] {
				return machine.traceFrames;
			},
			get log(): ActorLogger {
				return machine.logger;
			},
			get id(): string {
				return machine.actorUuid;
			},
			get actorUuid(): string {
				return machine.actorUuid;
			},
			get actorName(): string {
				return machine.actorName;
			},
			get actorPath(): string {
				return machine.actorPath;
			},
			get traceLevel(): TraceLevel {
				return machine.traceLevel;
			},
			set traceLevel(level: TraceLevel) {
				machine.traceLevel = level;
			},
			get traceWriter(): TraceWriter {
				return machine.traceWriter;
			},
			set traceWriter(writer: TraceWriter) {
				machine.traceWriter = writer;
			},
			get dispatchErrorCallback(): (hsm: unknown, err: Error) => void {
				return machine.dispatchErrorCallback as (hsm: unknown, err: Error) => void;
			},
			set dispatchErrorCallback(cb: (hsm: unknown, err: Error) => void) {
				machine.dispatchErrorCallback = cb as DispatchErrorCallback<C>;
			},
		};
		return facade;
	}

	private createDeferredSelfNotifications(ms: number): SelfNotifications<C> {
		const machine = this;
		const proto: Record<string, Function> = Object.create(null);
		for (const [name, slot] of this.protocolIndex.entries('inbound')) {
			if (slot.bucket === 'notifications' || slot.bucket === 'internalNotifications') {
				proto[name] = (...args: unknown[]): void => {
					machine.scheduleNotification(ms, name, args);
				};
			}
		}
		for (const [name, slot] of this.protocolIndex.entries('root')) {
			if (slot.bucket === 'notifications') {
				proto[name] = (...args: unknown[]): void => {
					machine.scheduleNotification(ms, name, args);
				};
			}
		}
		return Object.create(Object.freeze(proto)) as SelfNotifications<C>;
	}

	private buildActorHsm(kind: EmbodimentKind): ExternalHsm<C> | InboundHsm<C> | ChildHsm<C> {
		const machine = this;
		const includeState = kind !== 'root';
		const includeOwner = kind === 'child' || kind === 'test';
		const facade: Record<string, unknown> = {
			sync: () => machine.sync(),
			get currentStateName(): string {
				return machine.currentStateName;
			},
			get topStateName(): string {
				return machine.topStateName;
			},
			get traceLevel(): TraceLevel {
				return machine.traceLevel;
			},
			set traceLevel(level: TraceLevel) {
				machine.traceLevel = level;
			},
			get traceWriter(): TraceWriter {
				return machine.traceWriter;
			},
			set traceWriter(writer: TraceWriter) {
				machine.traceWriter = writer;
			},
			get traceHeader(): string {
				return machine.traceHeader;
			},
			get id(): string {
				return machine.actorUuid;
			},
			get actorUuid(): string {
				return machine.actorUuid;
			},
			get actorName(): string {
				return machine.actorName;
			},
			get actorPath(): string {
				return machine.actorPath;
			},
		};
		if (includeState) {
			Object.defineProperties(facade, {
				currentState: {
					enumerable: true,
					get(): StateClass<C> {
						return machine.currentState as StateClass<C>;
					},
				},
				topState: {
					enumerable: true,
					get(): StateClass<C> {
						return machine.topState as StateClass<C>;
					},
				},
			});
		}
		if (includeOwner) {
			Object.defineProperties(facade, {
				restore: {
					enumerable: true,
					value: (state: StateClass<C>, ctx: ActorContextOf<C>) => machine.restore(state as never, ctx),
				},
				dispatchErrorCallback: {
					enumerable: true,
					get(): (hsm: unknown, err: Error) => void {
						return machine.dispatchErrorCallback as (hsm: unknown, err: Error) => void;
					},
					set(cb: (hsm: unknown, err: Error) => void) {
						machine.dispatchErrorCallback = cb as DispatchErrorCallback<C>;
					},
				},
			});
		}
		return facade as ExternalHsm<C> | InboundHsm<C> | ChildHsm<C>;
	}
}

//#region factories

export function isRequestingPort(port: unknown): boolean {
	if (port === null || typeof port !== 'object') {
		return false;
	}
	const ctor = Object.getPrototypeOf(port)?.constructor as RequestingPortCtor | undefined;
	if (ctor === undefined) {
		return false;
	}
	return ctor[kRequestingPort] === true;
}

class ConsoleTraceWriter implements TraceWriter {
	write<C extends ActorConfig>(hsm: Properties<C>, msg: unknown): void {
		if (typeof msg === 'string') {
			console.log(`${hsm.traceHeader}${hsm.currentStateName}: ${msg}`);
		} else {
			console.log(msg);
		}
	}
}

/** @internal */
export const defaultTraceWriter: TraceWriter = new ConsoleTraceWriter();

/** @internal */
export const defaultInitialize = true;

/** @internal */
export function defaultDispatchErrorCallback<C extends ActorConfig>(hsm: Properties<C>, err: Error): void {
	hsm.traceWriter.write(hsm, `An event dispatch has failed; error ${err.name}: ${err.message} has not been managed`);
	hsm.traceWriter.write(hsm, err);
	throw err;
}

type ActorHandleFor<C extends ActorConfig, K extends EmbodimentKind> = K extends 'root' ? ExternalActor<C> : K extends 'inbound' ? InboundActor<C> : ChildActor<C>;

type SpawnContext<C extends ActorConfig = ActorConfig> = {
	readonly parentMachine?: Machine<C>;
};

const ACTOR_OPTION_KEYS = new Set<string>(['initialize', 'traceLevel', 'traceWriter', 'dispatchErrorCallback', 'transitions']);

/** @internal Distinguish {@link ActorOptions} from a port when the port argument is omitted. */
export function isActorOptions(value: unknown): value is ActorOptions<ActorConfig> {
	if (value === null || typeof value !== 'object') {
		return false;
	}
	if (value instanceof Port || isRequestingPort(value)) {
		return false;
	}
	const keys = Object.keys(value);
	if (keys.length === 0) {
		return true;
	}
	return keys.every(key => ACTOR_OPTION_KEYS.has(key));
}

/** @internal */
export function resolveFactoryPortAndOptions<C extends ActorConfig>(portOrOptions?: MachinePortInput<C> | ActorOptions<C>, maybeOptions?: ActorOptions<C>): { port: MachinePortInput<C> | undefined; options: ActorOptions<C> } {
	if (maybeOptions !== undefined) {
		return { port: portOrOptions as MachinePortInput<C> | undefined, options: maybeOptions };
	}
	if (portOrOptions !== undefined && isActorOptions(portOrOptions)) {
		return { port: undefined, options: portOrOptions as ActorOptions<C> };
	}
	return { port: portOrOptions as MachinePortInput<C> | undefined, options: {} };
}

/** @internal Spawn with embodiment kind — used by factories and `ihsm/testing`. */
export function spawnActor<C extends ActorConfig, K extends EmbodimentKind>(kind: K, topState: TopStateArg<C>, ctx: ActorContextOf<C>, port: MachinePortInput<C> | undefined, options: ActorOptions<C>, spawnContext: SpawnContext<C> = {}): ActorHandleFor<C, K> {
	const { initialize = defaultInitialize, traceLevel = TraceLevel.DEBUG, traceWriter = defaultTraceWriter, dispatchErrorCallback = defaultDispatchErrorCallback as DispatchErrorCallback<C>, transitions } = options;

	const protocolIndex = buildProtocolIndex(topState);
	const topStateName: string = getStateName(topState as StateClass<C>);
	const parentMachine: Machine<C> | undefined = spawnContext.parentMachine;
	// Tracing is a cross-cutting concern: the actor adopts the globally-registered collector(s) at
	// spawn (no per-actor `instrumentation` option). Snapshotting here keeps "no collector" actors
	// at zero overhead while still sharing one collector instance across a parent and its children.
	const resolvedInstrumentation: Instrumentation<C> | undefined = getActiveInstrumentation() as Instrumentation<C> | undefined;
	const identity: ActorIdentity = parentMachine !== undefined ? mintActorIdentity('child', childActorPath(parentMachine.actorPath, topStateName, parentMachine.allocateChildSpawnIndex(topStateName)), parentMachine.actorUuid) : mintActorIdentity(kind, rootActorPath(topStateName));

	const boundPort = (port ?? new Port<TopStateArg<C>>()) as MachinePortInput<C>;
	const instance: { ctx: ActorContextOf<C>; hsm: never; portRef?: unknown } = {
		ctx,
		hsm: undefined as never,
		portRef: boundPort,
	};
	Object.setPrototypeOf(instance, topState.prototype);

	const machine = new Machine(topState as StateClass<C>, instance, protocolIndex, traceWriter, traceLevel, dispatchErrorCallback, initialize, identity, resolvedInstrumentation, transitions ?? new RuntimeTransitionResolver());
	if (resolvedInstrumentation !== undefined) {
		const token = dispatchContext.get()?.getStore() as DispatchToken | undefined;
		const parentCause: CauseRef =
			token?.actorUuid !== undefined
				? {
						actorUuid: token.actorUuid,
						macrostepId: token.macrostepId,
						stepSeq: token.stepSeq,
						kind: 'spawn',
					}
				: {
						actorUuid: identity.parentUuid ?? identity.uuid,
						kind: 'spawn',
					};
		const spawnInfo: SpawnInfo = {
			parent: parentCause,
			child: identity,
		};
		notifyActorSpawned(resolvedInstrumentation, spawnInfo);
	}

	const portKind: EmbodimentKind = isRequestingPort(boundPort) ? 'child' : kind === 'root' ? 'inbound' : kind;
	boundPort.actor = createActorHandle(machine, topState, protocolIndex, portKind) as never;

	return createActorHandle(machine, topState, protocolIndex, kind) as unknown as ActorHandleFor<C, K>;
}

/** Production black-box — public protocol only (generated handle). */
export function makeActor<T extends TopStateArg<ActorConfig>>(topState: T, ctx: ActorContextOf<ActorConfigOf<T>>, options?: ActorOptions<ActorConfigOf<T>>): ExternalActor<ActorConfigOf<T>>;
export function makeActor<T extends TopStateArg<ActorConfig>>(topState: T, ctx: ActorContextOf<ActorConfigOf<T>>, port: MachinePortInput<ActorConfigOf<T>>, options?: ActorOptions<ActorConfigOf<T>>): ExternalActor<ActorConfigOf<T>>;
export function makeActor<T extends TopStateArg<ActorConfig>>(topState: T, ctx: ActorContextOf<ActorConfigOf<T>>, portOrOptions?: MachinePortInput<ActorConfigOf<T>> | ActorOptions<ActorConfigOf<T>>, options?: ActorOptions<ActorConfigOf<T>>): ExternalActor<ActorConfigOf<T>> {
	type C = ActorConfigOf<T>;
	const { port, options: resolvedOptions } = resolveFactoryPortAndOptions<C>(portOrOptions, options);
	return spawnActor('root', topState as TopStateArg<C>, ctx, port, resolvedOptions);
}

export function asParentActor<T extends TopStateArg<ActorConfig>>(handler: TopState<ActorConfigOf<T>>): ParentActor<T> {
	const machine = (handler as { [kHandlerMachine]?: Machine<ActorConfigOf<T>> })[kHandlerMachine];
	if (machine === undefined) {
		throw new Error('ihsm: asParentActor requires an active handler machine');
	}
	return {
		top: machine.topState as T,
		[kParentLink]: machine,
	};
}

/** Parent composes a child machine — returns full child protocol shell with `parent` set. */
export function makeChildActor<ParentT extends TopStateArg<ActorConfig>, ChildT extends TopStateArg<ActorConfig>>(parent: ParentActor<ParentT>, childTop: ChildT, childCtx: ActorContextOf<ActorConfigOf<ChildT>>, options?: ActorOptions<ActorConfigOf<ChildT>>): ChildActor<ActorConfigOf<ChildT>> & { readonly parent: ParentActor<ParentT> };
export function makeChildActor<ParentT extends TopStateArg<ActorConfig>, ChildT extends TopStateArg<ActorConfig>>(parent: ParentActor<ParentT>, childTop: ChildT, childCtx: ActorContextOf<ActorConfigOf<ChildT>>, port: MachinePortInput<ActorConfigOf<ChildT>>, options?: ActorOptions<ActorConfigOf<ChildT>>): ChildActor<ActorConfigOf<ChildT>> & { readonly parent: ParentActor<ParentT> };
export function makeChildActor<ParentT extends TopStateArg<ActorConfig>, ChildT extends TopStateArg<ActorConfig>>(parent: ParentActor<ParentT>, childTop: ChildT, childCtx: ActorContextOf<ActorConfigOf<ChildT>>, portOrOptions?: MachinePortInput<ActorConfigOf<ChildT>> | ActorOptions<ActorConfigOf<ChildT>>, options?: ActorOptions<ActorConfigOf<ChildT>>): ChildActor<ActorConfigOf<ChildT>> & { readonly parent: ParentActor<ParentT> } {
	type ChildC = ActorConfigOf<ChildT>;
	const { port, options: resolvedOptions } = resolveFactoryPortAndOptions<ChildC>(portOrOptions, options);
	const parentMachine: Machine<ActorConfigOf<ParentT>> | undefined = parent[kParentLink] as Machine<ActorConfigOf<ParentT>> | undefined;
	const child = spawnActor('child', childTop as TopStateArg<ChildC>, childCtx, port, resolvedOptions, { parentMachine: parentMachine as Machine<ChildC> | undefined });
	Object.defineProperty(child, 'parent', { value: parent, enumerable: true, writable: false, configurable: true });
	return child as ChildActor<ChildC> & { readonly parent: ParentActor<ParentT> };
}

export { kHandlerMachine, kParentLink } from './types';
export { configureRunSeed, getRunSeed, getRunNamespace, actorNameFromTopState, mintActorIdentity, rootActorPath, childActorPath } from './identity';
