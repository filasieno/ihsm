/** @internal Consolidated ihsm runtime (no pure types — see ./types.ts). */
/// <reference types="node" />
import type {
	ActorConfig,
	ActorContextOf,
	ActorConfigOf,
	ActorPortOf,
	ActorHsm,
	ActorOptions,
	Any,
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
	TopStateArg,
	TraceWriter,
	DispatchErrorCallback,
	Transition,
	TransitionResolver,
	TransitionRoutineExecuteOptions,
	TransitionRoutinePlan,
	TransitionRoutineStyle,
	TransitionTracer,
	Disposable,
	EventObserver,
	TransitionTraceHost,
} from './types';
import { kHandlerMachine, kParentLink } from './types';

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

export class Port<T = Any> implements IPort<ActorConfigOf<T>>, RandomService {
	declare readonly __topState: T;
	actor!: InboundActor<ActorConfigOf<T>> | ChildActor<ActorConfigOf<T>>;
	private _deferFactory?: (ms: number) => SelfNotifications<ActorConfigOf<T>>;

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

	protected _timerSeq = 0;
	protected readonly _timeoutHandles = new Map<number, ReturnType<typeof setTimeout>>();
	protected readonly _intervalHandles = new Map<number, ReturnType<typeof setInterval>>();

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

	setInterval(callback: () => void, millis?: number): number {
		const id = ++this._timerSeq;
		const handle = globalThis.setInterval(callback, Math.max(0, millis ?? 0));
		this._intervalHandles.set(id, handle);
		return id;
	}

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

	random(): number {
		return Math.random();
	}

	cryptoRandom(): number {
		const crypto = globalThis.crypto as Crypto & { random?: () => number };
		return crypto.random?.() ?? Math.random();
	}

	randomUUID(): string {
		return globalThis.crypto.randomUUID();
	}

	getRandomValues<T extends ArrayBufferView>(array: T): T {
		globalThis.crypto.getRandomValues(array as never);
		return array;
	}
}

const kRequestingPort = Symbol('ihsm.requestingPort');
type RequestingPortCtor = Function & Record<typeof kRequestingPort, boolean | undefined>;

export abstract class RequestingPort<T> extends Port<T> {
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

export function serviceCallWithTimeout<T>(promise: Promise<T>, method: string, timeoutMs: number): Promise<T> {
	if (timeoutMs === 0) {
		return Promise.reject(new CallTimeoutError(method));
	}
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new CallTimeoutError(method));
		}, timeoutMs);
		promise.then(
			value => {
				clearTimeout(timer);
				resolve(value);
			},
			err => {
				clearTimeout(timer);
				reject(err);
			}
		);
	});
}

const protoCache = new WeakMap<object, Map<EmbodimentKind, object>>();

export function getHandleProto(topState: object, index: ProtocolIndex, kind: EmbodimentKind): object {
	let map = protoCache.get(topState);
	if (map === undefined) {
		map = new Map();
		protoCache.set(topState, map);
	}
	let proto = map.get(kind);
	if (proto === undefined) {
		const built: Record<string, Function> = Object.create(null);
		for (const [name, slot] of index.entries(kind)) {
			if (slot.bucket === 'services' || slot.bucket === 'internalServices') {
				built[name] = function (this: HandleOwn, ...args: unknown[]): Promise<unknown> {
					const { callArgs, timeoutMs } = splitServiceArgs(args);
					const promise = this[kMachine].dispatchService(name, callArgs);
					if (timeoutMs === undefined) {
						return promise;
					}
					return serviceCallWithTimeout(promise, name, timeoutMs);
				};
			} else {
				built[name] = function (this: HandleOwn, ...args: unknown[]): void {
					this[kMachine].dispatchNotification(name, args, 'default');
				};
			}
		}
		proto = Object.freeze(built);
		map.set(kind, proto);
	}
	return proto;
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
		for (const [name, slot] of index.entries(kind)) {
			if (facet === 'call') {
				if (slot.bucket === 'services' || slot.bucket === 'internalServices') {
					built[name] = function (this: HandleOwn, ...args: unknown[]): Promise<unknown> {
						const { callArgs, timeoutMs } = splitServiceArgs(args);
						const promise = this[kMachine].dispatchService(name, callArgs);
						return timeoutMs === undefined ? promise : serviceCallWithTimeout(promise, name, timeoutMs);
					};
				}
			} else if (slot.bucket === 'notifications' || slot.bucket === 'internalNotifications') {
				const queue: NotificationQueue = facet === 'notifyNow' ? 'priority' : 'default';
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

export function createActorHandle(machine: DispatchableMachine, topState: object, index: ProtocolIndex, kind: EmbodimentKind): HandleOwn {
	const handle = Object.create(getHandleProto(topState, index, kind)) as HandleOwn;
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
	handle.hsm = machine.actorHsmFor(kind);
	return handle;
}

const selfProtoCache = new WeakMap<object, Map<NotificationQueue, object>>();

export function getSelfNotificationsProto(topState: object, index: ProtocolIndex, queue: NotificationQueue): object {
	let map = selfProtoCache.get(topState);
	if (map === undefined) {
		map = new Map();
		selfProtoCache.set(topState, map);
	}
	let proto = map.get(queue);
	if (proto === undefined) {
		const built: Record<string, Function> = Object.create(null);
		for (const [name, slot] of index.entries('inbound')) {
			if (slot.bucket === 'notifications' || slot.bucket === 'internalNotifications') {
				built[name] = function (this: HandleOwn, ...args: unknown[]): void {
					this[kMachine].dispatchNotification(name, args, queue);
				};
			}
		}
		for (const [name, slot] of index.entries('root')) {
			if (slot.bucket === 'notifications') {
				built[name] = function (this: HandleOwn, ...args: unknown[]): void {
					this[kMachine].dispatchNotification(name, args, queue);
				};
			}
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

type DispatchToken = { machine: DispatchableMachine };

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

//#region transition-routines

type TransitionHost<C extends ActorConfig> = HsmWithTracing<C>;

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
	let dstPath: StateClass<C>[] = [];
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

async function invokeLifecycleHook<C extends ActorConfig>(hsm: TransitionHost<C>, instance: object, state: StateClass<C>, hook: 'onExit' | 'onEntry', fromStateName: string, toStateName: string, style: TransitionRoutineStyle, tracer: TransitionTracer | undefined): Promise<void> {
	const statePrototype = state.prototype;
	const stateName = getStateName(state);
	const hasHook = Object.prototype.hasOwnProperty.call(statePrototype, hook);

	if ((style === 'verbose' || style === 'debug') && !hasHook) {
		if (style === 'verbose') {
			tracer?.traceHookSkipped(stateName, hook);
		}
		return;
	}

	try {
		const res = statePrototype[hook].call(instance);
		if (res) {
			await res;
		}
		if (style === 'verbose') {
			tracer?.traceHookDone(stateName, hook);
		}
	} catch (cause) {
		if (style === 'verbose') {
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
	const fromStateName = getStateName(srcState);
	const toStateName = getStateName(dstState);

	if (style === 'verbose' || style === 'debug') {
		tracer?.traceTransitionStart(fromStateName, toStateName);
	}

	for (const state of plan.exit) {
		await invokeLifecycleHook(hsm, instance, state, 'onExit', fromStateName, toStateName, style, tracer);
	}

	for (const state of plan.entry) {
		await invokeLifecycleHook(hsm, instance, state, 'onEntry', fromStateName, toStateName, style, tracer);
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
	}
}

export function createTransitionTracer(hsm: TransitionTraceHost): TransitionTracer {
	return {
		traceTransitionStart(fromStateName, toStateName) {
			hsm._tracePush(`transition from ${fromStateName} to ${toStateName}`, `started transition from ${fromStateName} to ${toStateName} `);
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
		await executeTransitionRoutine(hsm, hsm._instance, this.plan, srcState, dstState, {
			style: 'production',
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	}
}

export class RuntimeTransitionResolver<C extends ActorConfig = ActorConfig> implements TransitionResolver<C> {
	private readonly cache = new Map<string, Transition<C>>();

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

export async function executePendingTransition<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>): Promise<void> {
	if (host._transitionState === undefined) return;
	try {
		const srcState = host.currentState;
		const destState = host._transitionState;
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

async function invokeHandler<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>, name: string, args: readonly unknown[]): Promise<unknown> {
	host._currentEventName = name;
	host._currentEventPayload = [...args];
	try {
		const eventHandler = lookupEventHandler(host, name);
		if (!eventHandler) {
			await doUnhandledEvent(host, resolver, new UnhandledEventError(host), () => {
				host._currentEventName = undefined;
				host._currentEventPayload = undefined;
			});
			return undefined;
		}
		try {
			const result = eventHandler.call(host._instance, ...args);
			const settled = result instanceof Promise ? await result : result;
			await completePendingTransitions(host, resolver, () => {
				host._currentEventName = undefined;
				host._currentEventPayload = undefined;
			});
			return settled;
		} catch (recoveryErr) {
			if (recoveryErr instanceof UnhandledEventError) {
				await doUnhandledEvent(host, resolver, recoveryErr, () => {
					host._currentEventName = undefined;
					host._currentEventPayload = undefined;
				});
				return undefined;
			}
			if (recoveryErr instanceof TransitionError) {
				host._currentEventName = undefined;
				host._currentEventPayload = undefined;
				throw recoveryErr;
			}
			host._currentEventName = undefined;
			host._currentEventPayload = undefined;
			throw asError(recoveryErr);
		}
	} catch (err) {
		host._currentEventName = undefined;
		host._currentEventPayload = undefined;
		throw err;
	}
}

export function createInitTask<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>): Task {
	const runInit = host.traceLevel === TraceLevel.PRODUCTION ? executeInitProduction : host.traceLevel === TraceLevel.DEBUG ? executeInitDebug : executeInitVerbose;
	return (done: DoneCallback): void => {
		runInit(host)
			.then(() => executePendingTransition(host, resolver))
			.then(() => done())
			.catch((err: unknown) => {
				host.dispatchErrorCallback(host, asError(err));
				done();
			});
	};
}

export function createServiceTask<C extends ActorConfig>(host: HsmWithTracing<C>, resolver: TransitionResolver<C>, name: string, args: readonly unknown[], resolve: (value: unknown) => void, reject: (error: Error) => void): Task {
	const machine = host as unknown as DispatchableMachine;
	return (done: DoneCallback): void => {
		const run = (): Promise<void> =>
			invokeHandler(host, resolver, name, args)
				.then(resolve)
				.catch((err: unknown) => {
					reject(asError(err));
				})
				.catch((err: unknown) => host.dispatchErrorCallback(host, asError(err)))
				.finally(() => done());
		if (host.traceLevel === TraceLevel.PRODUCTION) {
			void run();
			return;
		}
		const storage = dispatchContext.get();
		if (storage === undefined) {
			void run();
			return;
		}
		void storage.run({ machine }, run);
	};
}

export function createNotificationTask<C extends ActorConfig>(host: HsmWithTracing<C>, _resolver: TransitionResolver<C>, name: string, args: readonly unknown[]): Task {
	return (done: DoneCallback): void => {
		host._createEventDispatchTask(host, name, ...args)(done);
	};
}

//#endregion

//#region hsm

function mapEventDispatchTaskFactory(traceLevel: TraceLevel): <DispatchC extends ActorConfig>(hsm: HsmWithTracing<DispatchC>, eventName: string, ...eventPayload: unknown[]) => Task {
	switch (traceLevel) {
		case TraceLevel.PRODUCTION:
			return createEventDispatchTaskProduction;
		case TraceLevel.DEBUG:
			return createEventDispatchTaskDebug;
		case TraceLevel.VERBOSE_DEBUG:
			return createEventDispatchTaskVerbose;
	}
}

/** @internal */
export class HsmObject<C extends ActorConfig> implements HsmWithTracing<C> {
	public topState: StateClass<C>;
	public topStateName: string;
	public readonly ctxTypeName: string;
	public traceWriter: TraceWriter;

	public _instance: Instance<C>;
	public _transitionCache: Map<string, Transition<C>> = new Map();
	public _jobs: Task[];
	public _hiPriorityJobs: Task[];
	private _isRunning = false;
	public _transitionState?: StateClass<C>;

	public _currentEventName?: string;
	public _currentEventPayload?: unknown[];
	private _observers?: Set<EventObserver>;
	public dispatchErrorCallback: DispatchErrorCallback<C>;
	private _traceLevel: TraceLevel;
	private _traceDomainStack: string[];
	public _createEventDispatchTask: <DispatchC extends ActorConfig>(hsm: HsmWithTracing<DispatchC>, eventName: string, ...eventPayload: unknown[]) => Task;

	constructor(TopState: StateClass<C>, instance: Instance<C>, traceWriter: TraceWriter, traceLevel: TraceLevel, dispatchErrorCallback: DispatchErrorCallback<C>) {
		this._instance = instance;
		this._transitionState = undefined;
		this._transitionCache = new Map();
		this._traceLevel = traceLevel;
		this._currentEventName = undefined;
		this._currentEventPayload = undefined;
		this._traceDomainStack = [];
		this._createEventDispatchTask = mapEventDispatchTaskFactory(traceLevel);
		this._jobs = [];
		this._hiPriorityJobs = [];
		this._isRunning = false;

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
		this._createEventDispatchTask = mapEventDispatchTaskFactory(traceLevel);
		this._traceLevel = traceLevel;
	}

	sync(): Promise<void> {
		return new Promise(resolve => {
			this.pushTask((doneCallback: () => void): void => {
				resolve();
				doneCallback();
			});
		});
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
		this.dequeue();
	}

	private enqueueTask(t: Task, queue: Task[]): void {
		queue.push(t);
		if (this._isRunning) return;
		this._isRunning = true;
		this.dequeue();
	}

	public restore(state: StateClass<C>, ctx: ActorContextOf<C>): void {
		this.currentState = state;
		this.ctx = ctx;
	}

	private dequeue(): void {
		if (this._hiPriorityJobs.length == 0 && this._jobs.length == 0) {
			this._isRunning = false;
			return;
		}
		const task = this._hiPriorityJobs.length > 0 ? this._hiPriorityJobs.shift()! : this._jobs.shift()!;
		this.exec(task);
	}

	private exec(task: Task): void {
		setTimeout(() => this.runTask(task).then(() => this.dequeue()), 0);
	}

	private runTask(task: Task): Promise<void> {
		return new Promise<void>(resolve => {
			task(() => {
				this.drainHiPriority().then(resolve);
			});
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
}

//#region machine

export class Machine<C extends ActorConfig> extends HsmObject<C> implements DispatchableMachine {
	readonly transitionResolver: TransitionResolver<C>;
	private readonly protocolIndex: ProtocolIndex;
	private readonly handlerFacade: HandlerHsm<C>;
	private readonly selfActor: SelfNotifications<C>;
	private readonly selfImmediate: SelfNotifications<C>;
	private readonly actorFacades = new Map<EmbodimentKind, ExternalHsm<C> | InboundHsm<C> | ChildHsm<C>>();

	constructor(topState: StateClass<C>, instance: { ctx: ActorContextOf<C>; hsm: HandlerHsm<C>; portRef?: unknown }, protocolIndex: ProtocolIndex, traceWriter: TraceWriter, traceLevel: TraceLevel, dispatchErrorCallback: DispatchErrorCallback<C>, initialize: boolean, transitionResolver?: TransitionResolver<C>) {
		super(topState, instance as never, traceWriter, traceLevel, dispatchErrorCallback);
		Object.defineProperty(instance, kHandlerMachine, { value: this, enumerable: false, writable: false, configurable: false });
		this.protocolIndex = protocolIndex;
		cacheProtocolIndex(topState, protocolIndex);
		this.transitionResolver = transitionResolver ?? new RuntimeTransitionResolver();
		this.selfActor = createSelfNotifications(this, topState, protocolIndex, 'default') as SelfNotifications<C>;
		this.selfImmediate = createSelfNotifications(this, topState, protocolIndex, 'priority') as SelfNotifications<C>;
		this.handlerFacade = this.buildHandlerFacade(instance);
		instance.hsm = this.handlerFacade;
		Object.defineProperty(instance, 'notify', { value: this.selfActor, enumerable: true, configurable: true });
		Object.defineProperty(instance, 'notifyNow', { value: this.selfImmediate, enumerable: true, configurable: true });
		this.bindPort(instance.portRef);
		if (initialize) {
			this.pushTask(createInitTask(this, this.transitionResolver));
		}
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
			this.pushTask(createServiceTask(this, this.transitionResolver, name, args, resolve, reject));
		});
	}

	dispatchNotification(name: string, args: unknown[], queue: NotificationQueue): void {
		this.recordObserverEvent(name, args);
		const task = createNotificationTask(this, this.transitionResolver, name, args);
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
		const enqueue = (): void => {
			this.dispatchNotification(name, args, 'default');
		};
		const port = this._instance.portRef as IPort<C> | undefined;
		if (port === undefined) {
			throw new Error('ihsm: deferred notification requires a port');
		}
		port.setTimeout(enqueue, ms);
	}

	/** @internal Binds deferred self-notifications to a port instance. */
	bindPort(portRef: unknown): void {
		if (portRef instanceof Port) {
			(portRef as Port<C>).bindDeferredNotifications(ms => this.createDeferredSelfNotifications(ms) as unknown as SelfNotifications<ActorConfigOf<C>>);
		}
	}

	private buildHandlerFacade(instance: { portRef?: unknown }): HandlerHsm<C> {
		const machine = this;
		const facade: HandlerHsm<C> = {
			get ctx(): ActorContextOf<C> {
				return machine.ctx;
			},
			transition: next => machine.transition(next as StateClass<C>),
			actor: this.selfActor,
			immediate: this.selfImmediate,
			get port(): ActorPortOf<C> {
				return instance.portRef as ActorPortOf<C>;
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
		if (kind === 'root') {
			return {
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
			} as ExternalHsm<C>;
		}
		if (kind === 'inbound') {
			return {
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
				get currentState(): StateClass<C> {
					return machine.currentState as StateClass<C>;
				},
				get topState(): StateClass<C> {
					return machine.topState as StateClass<C>;
				},
			} as InboundHsm<C>;
		}
		return {
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
			get currentState(): StateClass<C> {
				return machine.currentState as StateClass<C>;
			},
			get topState(): StateClass<C> {
				return machine.topState as StateClass<C>;
			},
			restore: (state: StateClass<C>, ctx: ActorContextOf<C>) => machine.restore(state as never, ctx),
			get dispatchErrorCallback(): (hsm: unknown, err: Error) => void {
				return machine.dispatchErrorCallback as (hsm: unknown, err: Error) => void;
			},
			set dispatchErrorCallback(cb: (hsm: unknown, err: Error) => void) {
				machine.dispatchErrorCallback = cb as DispatchErrorCallback<C>;
			},
		} as ChildHsm<C>;
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

/** @internal Spawn with embodiment kind — used by factories and `ihsm/testing`. */
export function spawnActor<C extends ActorConfig, K extends EmbodimentKind>(kind: K, topState: TopStateArg<C>, ctx: ActorContextOf<C>, port: MachinePortInput<C> | undefined, options: ActorOptions<C>): ActorHandleFor<C, K> {
	const { initialize = defaultInitialize, traceLevel = TraceLevel.DEBUG, traceWriter = defaultTraceWriter, dispatchErrorCallback = defaultDispatchErrorCallback as DispatchErrorCallback<C>, transitions } = options;

	const protocolIndex = buildProtocolIndex(topState);

	const boundPort = (port ?? new Port<C>()) as Port<C>;
	const instance: { ctx: ActorContextOf<C>; hsm: never; portRef?: unknown } = {
		ctx,
		hsm: undefined as never,
		portRef: boundPort,
	};
	Object.setPrototypeOf(instance, topState.prototype);

	const machine = new Machine(topState as StateClass<C>, instance, protocolIndex, traceWriter, traceLevel, dispatchErrorCallback, initialize, transitions ?? new RuntimeTransitionResolver());

	const portKind: EmbodimentKind = isRequestingPort(boundPort) ? 'child' : kind === 'root' ? 'inbound' : kind;
	boundPort.actor = createActorHandle(machine, topState, protocolIndex, portKind) as never;

	return createActorHandle(machine, topState, protocolIndex, kind) as unknown as ActorHandleFor<C, K>;
}

/** Production black-box — public protocol only (generated handle). */
export function makeActor<T extends TopStateArg<ActorConfig>>(topState: T, ctx: ActorContextOf<ActorConfigOf<T>>, port?: MachinePortInput<ActorConfigOf<T>>, options: ActorOptions<ActorConfigOf<T>> = {}): ExternalActor<ActorConfigOf<T>> {
	type C = ActorConfigOf<T>;
	return spawnActor('root', topState as TopStateArg<C>, ctx, port, options);
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
export function makeChildActor<ParentT extends TopStateArg<ActorConfig>, ChildT extends TopStateArg<ActorConfig>>(parent: ParentActor<ParentT>, childTop: ChildT, childCtx: ActorContextOf<ActorConfigOf<ChildT>>, port?: MachinePortInput<ActorConfigOf<ChildT>>, options: ActorOptions<ActorConfigOf<ChildT>> = {}): ChildActor<ActorConfigOf<ChildT>> & { readonly parent: ParentActor<ParentT> } {
	type ChildC = ActorConfigOf<ChildT>;
	const child = spawnActor('child', childTop as TopStateArg<ChildC>, childCtx, port, options);
	Object.defineProperty(child, 'parent', { value: parent, enumerable: true, writable: false, configurable: true });
	return child as ChildActor<ChildC> & { readonly parent: ParentActor<ParentT> };
}

export { kHandlerMachine, kParentLink } from './types';

//#region dispatch

//#region production

class prod_ProductionTransition<C extends ActorConfig> implements Transition<C> {
	constructor(
		private plan: ReturnType<typeof planTransitionClasses<C>>,
		private srcState: StateClass<C>,
		private dstState: StateClass<C>
	) {}

	async execute(hsm: HsmWithTracing<C>, srcState: StateClass<C>, dstState: StateClass<C>): Promise<void> {
		await executeTransitionRoutine(hsm, hsm._instance, this.plan, srcState, dstState, {
			style: 'production',
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	}
}

async function prod_doTransition<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
	if (hsm._transitionState) {
		try {
			const srcState = hsm.currentState;
			const destState = hsm._transitionState;
			const transitionKey = getTransitionKey(srcState, destState);
			let tr: Transition<C> | undefined = hsm._transitionCache.get(transitionKey);
			if (!tr) {
				tr = new prod_ProductionTransition(planTransitionClasses(srcState, destState), srcState, destState);
				hsm._transitionCache.set(transitionKey, tr);
			}
			try {
				await tr.execute(hsm, srcState, destState);
			} catch (transitionError) {
				hsm.currentState = FatalErrorState as unknown as StateClass<C>;
				throw transitionError;
			}
		} finally {
			hsm._transitionState = undefined;
		}
	}
}

async function prod_completePendingTransitions<C extends ActorConfig>(hsm: HsmWithTracing<C>, onComplete: () => void): Promise<void> {
	await prod_doTransition(hsm);
	onComplete();
}

async function prod_doError<C extends ActorConfig>(hsm: HsmWithTracing<C>, err: Error, onComplete: () => void): Promise<void> {
	hsm._transitionState = undefined; // clear next state
	const messageHandler = hsm.currentState.prototype.onError;
	try {
		const result = messageHandler.call(hsm._instance, new EventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		await prod_completePendingTransitions(hsm, onComplete);
	} catch (recoveryErr) {
		if (recoveryErr instanceof TransitionError) {
			throw new FatalError(hsm, recoveryErr);
		}
		const err = asError(recoveryErr);
		hsm.transition(FatalErrorState as unknown as StateClass<C>);
		await prod_completePendingTransitions(hsm, onComplete);
		throw new FatalError(hsm, err);
	}
}

async function prod_doUnhandledEvent<C extends ActorConfig>(hsm: HsmWithTracing<C>, error: UnhandledEventError<C>, onComplete: () => void): Promise<void> {
	try {
		const result = hsm.currentState.prototype.onUnhandled.call(hsm._instance, error);
		if (result) {
			await result;
		}
		await prod_completePendingTransitions(hsm, onComplete);
	} catch (recoveryErr) {
		if (recoveryErr instanceof TransitionError) {
			hsm.currentState = FatalErrorState as unknown as StateClass<C>;
			throw recoveryErr;
		}
		await prod_doError(hsm, asError(recoveryErr), onComplete);
	}
}

export async function executeInitProduction<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
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

function prod_finishEventDispatch<C extends ActorConfig>(hsm: HsmWithTracing<C>): void {
	hsm._currentEventName = undefined;
	hsm._currentEventPayload = undefined;
}

async function prod_dispatchEvent<C extends ActorConfig>(hsm: HsmWithTracing<C>, eventName: string, ...eventPayload: unknown[]): Promise<void> {
	hsm._currentEventName = String(eventName);
	hsm._currentEventPayload = eventPayload;
	try {
		const eventHandler = lookupEventHandler(hsm, eventName);
		if (!eventHandler) {
			await prod_doUnhandledEvent(hsm, new UnhandledEventError(hsm), () => prod_finishEventDispatch(hsm));
			return;
		}
		try {
			const result = eventHandler.call(hsm._instance, ...eventPayload);
			if (result) await result;
			await prod_completePendingTransitions(hsm, () => prod_finishEventDispatch(hsm));
		} catch (recoveryErr) {
			if (recoveryErr instanceof UnhandledEventError) {
				await prod_doUnhandledEvent(hsm, recoveryErr, () => prod_finishEventDispatch(hsm));
			} else if (recoveryErr instanceof TransitionError) {
				prod_finishEventDispatch(hsm);
				throw recoveryErr;
			} else {
				await prod_doError(hsm, asError(recoveryErr), () => prod_finishEventDispatch(hsm));
			}
		}
	} catch (err) {
		prod_finishEventDispatch(hsm);
		throw err;
	}
}

//#region Export: _createEventDispatchTask

/** @internal */
export function createEventDispatchTaskProduction<DispatchC extends ActorConfig>(hsm: HsmWithTracing<DispatchC>, eventName: string, ...eventPayload: unknown[]): Task {
	return (done: DoneCallback): void => {
		prod_dispatchEvent(hsm, eventName, ...eventPayload)
			.catch((err: unknown) => hsm.dispatchErrorCallback(hsm, asError(err)))
			.finally(() => done());
	};
}

//#endregion

//#region debug

function debug_finishEventDispatch<C extends ActorConfig>(hsm: HsmWithTracing<C>): void {
	hsm._traceWrite(`end event dispatch`);
	hsm._currentEventName = undefined;
	hsm._currentEventPayload = undefined;
}

async function debug_completePendingTransitions<C extends ActorConfig>(hsm: HsmWithTracing<C>, onComplete: () => void): Promise<void> {
	await debug_doTransition(hsm);
	onComplete();
}

/** @internal */
class debug_DebugTransition<C extends ActorConfig> implements Transition<C> {
	constructor(private plan: ReturnType<typeof planTransitionClasses<C>>) {}

	async execute(hsm: HsmWithTracing<C>, srcState: StateClass<C>, dstState: StateClass<C>): Promise<void> {
		await executeTransitionRoutine(hsm, hsm._instance, this.plan, srcState, dstState, {
			style: 'debug',
			tracer: createTransitionTracer(hsm),
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	}
}

/** @internal */
async function debug_doTransition<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
	if (hsm._transitionState) {
		try {
			const srcState = hsm.currentState;
			const destState = hsm._transitionState;
			const transitionKey = getTransitionKey(srcState, destState);
			let tr: Transition<C> | undefined = hsm._transitionCache.get(transitionKey);
			if (!tr) {
				tr = new debug_DebugTransition(planTransitionClasses(srcState, destState));
				hsm._transitionCache.set(transitionKey, tr);
			}
			try {
				await tr.execute(hsm, srcState, destState);
			} catch (transitionError) {
				hsm.currentState = FatalErrorState as unknown as StateClass<C>;
				throw transitionError;
			}
		} finally {
			hsm._transitionState = undefined;
		}
	}
}

/** @internal */
async function debug_doError<C extends ActorConfig>(hsm: HsmWithTracing<C>, err: Error, onComplete: () => void): Promise<void> {
	hsm._transitionState = undefined;
	hsm._tracePush(`error recovery`, `started error recovery`);
	try {
		hsm._tracePush('execute', 'started #onError handler execution');
		const result = hsm.currentState.prototype.onError.call(hsm._instance, new EventHandlerError(hsm, err));
		if (result) {
			await result;
		}
		hsm._tracePopDone('error handler execution successful');
		await debug_completePendingTransitions(hsm, () => {
			hsm._tracePopDone('error recovery successful');
			onComplete();
		});
	} catch (recoveryErr) {
		hsm._tracePopError(`error handler execution failure: ${quoteUnknown(recoveryErr)}`);
		if (recoveryErr instanceof TransitionError) {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(recoveryErr)}`);
			throw new FatalError(hsm, recoveryErr);
		}
		const err = asError(recoveryErr);
		hsm.transition(FatalErrorState as unknown as StateClass<C>);
		await debug_completePendingTransitions(hsm, () => {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(err)}`);
			onComplete();
		});
		throw new FatalError(hsm, err);
	}
}

/** @internal */
async function debug_doUnhandledEvent<C extends ActorConfig>(hsm: HsmWithTracing<C>, error: UnhandledEventError<C>, onComplete: () => void): Promise<void> {
	hsm._tracePush('unhandled recovery', `started unhandled event recovery`);
	try {
		hsm._tracePush('execute', 'started #onUnhandled handler execution');
		const result = hsm.currentState.prototype.onUnhandled.call(hsm._instance, error);
		if (result) {
			await result;
		}
		hsm._tracePopDone('unhandled handler execution successful');
		await debug_completePendingTransitions(hsm, () => {
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
			await debug_doError(hsm, asError(recoveryErr), () => {
				hsm._tracePopDone('unhandled event recovery successful');
				onComplete();
			});
		} catch (nestedErr) {
			hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(nestedErr)}`);
			throw nestedErr;
		}
	}
}

/** @internal */
export async function executeInitDebug<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
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

/** @internal */
async function debug_dispatchEvent<C extends ActorConfig>(hsm: HsmWithTracing<C>, eventName: string, ...eventPayload: unknown[]): Promise<void> {
	const eventLabel = String(eventName);
	hsm._traceWrite(`begin event dispatch of #${eventLabel}`);
	hsm._tracePush(`#${eventLabel}`, `started event dispatch`);
	hsm._currentEventName = eventLabel;
	hsm._currentEventPayload = eventPayload;
	try {
		const eventHandler = lookupEventHandler(hsm, eventName);

		if (!eventHandler) {
			try {
				await debug_doUnhandledEvent(hsm, new UnhandledEventError(hsm), () => {
					hsm._tracePopDone('event dispatch successful');
					debug_finishEventDispatch(hsm);
				});
				return;
			} catch (recoveryErr) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				debug_finishEventDispatch(hsm);
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
			await debug_completePendingTransitions(hsm, () => {
				hsm._tracePopDone(`event dispatch successful`);
				debug_finishEventDispatch(hsm);
			});
		} catch (recoveryErr) {
			hsm._tracePopError(quoteUnknown(recoveryErr));
			if (recoveryErr instanceof UnhandledEventError) {
				try {
					await debug_doUnhandledEvent(hsm, recoveryErr, () => {
						hsm._tracePopDone('event dispatch successful');
						debug_finishEventDispatch(hsm);
					});
					return;
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					debug_finishEventDispatch(hsm);
					throw nestedErr;
				}
			} else if (recoveryErr instanceof TransitionError) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				debug_finishEventDispatch(hsm);
				throw recoveryErr;
			} else {
				try {
					await debug_doError(hsm, asError(recoveryErr), () => {
						hsm._tracePopDone('event dispatch successful');
						debug_finishEventDispatch(hsm);
					});
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					debug_finishEventDispatch(hsm);
					throw nestedErr;
				}
			}
		}
	} catch (err) {
		debug_finishEventDispatch(hsm);
		throw err;
	}
}

export function createEventDispatchTaskDebug<DispatchC extends ActorConfig>(hsm: HsmWithTracing<DispatchC>, eventName: string, ...eventPayload: unknown[]): Task {
	return (done: DoneCallback): void => {
		debug_dispatchEvent(hsm, eventName, ...eventPayload)
			.catch((err: unknown) => hsm.dispatchErrorCallback(hsm, asError(err)))
			.finally(() => done());
	};
}

//#region verbose

function verbose_finishEventDispatch<C extends ActorConfig>(hsm: HsmWithTracing<C>): void {
	hsm._traceWrite(`end event dispatch`);
	hsm._currentEventName = undefined;
	hsm._currentEventPayload = undefined;
}

async function verbose_completePendingTransitions<C extends ActorConfig>(hsm: HsmWithTracing<C>, onComplete: () => void): Promise<void> {
	await verbose_doTransition(hsm);
	onComplete();
}

/** @internal */
class verbose_TraceTransition<C extends ActorConfig> implements Transition<C> {
	constructor(private plan: ReturnType<typeof planTransitionClasses<C>>) {}

	async execute(hsm: HsmWithTracing<C>, srcState: StateClass<C>, dstState: StateClass<C>): Promise<void> {
		await executeTransitionRoutine(hsm, hsm._instance, this.plan, srcState, dstState, {
			style: 'verbose',
			tracer: createTransitionTracer(hsm),
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	}
}

/** @internal */
async function verbose_doTransition<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
	if (hsm._transitionState) {
		try {
			const srcState = hsm.currentState;
			const destState = hsm._transitionState;
			hsm._traceWrite(`requested transition from ${getStateName(srcState)} to ${getStateName(destState)} `);
			const transitionKey = getTransitionKey(srcState, destState);
			let tr: Transition<C> | undefined = hsm._transitionCache.get(transitionKey);
			if (tr) {
				hsm._traceWrite(`transition cache hit for ${getStateName(srcState)} to ${getStateName(destState)} `);
			} else {
				hsm._traceWrite(`transition cache miss for ${getStateName(srcState)} to ${getStateName(destState)} `);
				tr = new verbose_TraceTransition(planTransitionClasses(srcState, destState));
				hsm._transitionCache.set(transitionKey, tr);
			}
			try {
				await tr.execute(hsm, srcState, destState);
			} catch (transitionError) {
				hsm.currentState = FatalErrorState as unknown as StateClass<C>;
				throw transitionError;
			}
		} finally {
			hsm._transitionState = undefined;
		}
	} else {
		hsm._traceWrite('no transition requested');
	}
}

/** @internal */
async function verbose_doError<C extends ActorConfig>(hsm: HsmWithTracing<C>, err: Error, onComplete: () => void): Promise<void> {
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
		await verbose_completePendingTransitions(hsm, () => {
			hsm._tracePopDone('error recovery successful');
			onComplete();
		});
	} catch (recoveryErr) {
		hsm._tracePopError(`error handler execution failure: ${quoteUnknown(recoveryErr)}`);
		if (recoveryErr instanceof TransitionError) {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(recoveryErr)}`);
			throw recoveryErr;
		}
		const err = asError(recoveryErr);
		hsm.transition(FatalErrorState as unknown as StateClass<C>);
		await verbose_completePendingTransitions(hsm, () => {
			hsm._tracePopError(`error recovery failure: ${quoteUnknown(err)}`);
			onComplete();
		});
		throw new FatalError(hsm, err);
	}
}

/** @internal */
async function verbose_doUnhandledEvent<C extends ActorConfig>(hsm: HsmWithTracing<C>, error: UnhandledEventError<C>, onComplete: () => void): Promise<void> {
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
		await verbose_completePendingTransitions(hsm, () => {
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
			await verbose_doError(hsm, asError(recoveryErr), () => {
				hsm._tracePopDone('unhandled event recovery successful');
				onComplete();
			});
		} catch (nestedErr) {
			hsm._tracePopError(`unhandled event recovery failure: ${quoteUnknown(nestedErr)}`);
			throw nestedErr;
		}
	}
}

/** @internal */
export async function executeInitVerbose<C extends ActorConfig>(hsm: HsmWithTracing<C>): Promise<void> {
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

/** @internal */
async function verbose_dispatchEvent<C extends ActorConfig>(hsm: HsmWithTracing<C>, eventName: string, ...eventPayload: unknown[]): Promise<void> {
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
				await verbose_doUnhandledEvent(hsm, new UnhandledEventError(hsm), () => {
					hsm._tracePopDone('event dispatch successful');
					verbose_finishEventDispatch(hsm);
				});
				return;
			} catch (recoveryErr) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				verbose_finishEventDispatch(hsm);
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
			await verbose_completePendingTransitions(hsm, () => {
				hsm._tracePopDone(`event dispatch successful`);
				verbose_finishEventDispatch(hsm);
			});
		} catch (recoveryErr) {
			hsm._tracePopError(quoteUnknown(recoveryErr));
			if (recoveryErr instanceof UnhandledEventError) {
				hsm._traceWrite(`event #${eventLabel} is unhandled in state ${hsm.currentStateName}`);
				try {
					await verbose_doUnhandledEvent(hsm, recoveryErr, () => {
						hsm._tracePopDone('event dispatch successful');
						verbose_finishEventDispatch(hsm);
					});
					return;
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					verbose_finishEventDispatch(hsm);
					throw nestedErr;
				}
			} else if (recoveryErr instanceof TransitionError) {
				hsm._tracePopError(`event dispatch failed: ${quoteUnknown(recoveryErr)}`);
				verbose_finishEventDispatch(hsm);
				throw recoveryErr;
			} else {
				try {
					await verbose_doError(hsm, asError(recoveryErr), () => {
						hsm._tracePopDone('event dispatch successful');
						verbose_finishEventDispatch(hsm);
					});
				} catch (nestedErr) {
					hsm._tracePopError(`event dispatch failed: ${quoteUnknown(nestedErr)}`);
					verbose_finishEventDispatch(hsm);
					throw nestedErr;
				}
			}
		}
	} catch (err) {
		verbose_finishEventDispatch(hsm);
		throw err;
	}
}

export function createEventDispatchTaskVerbose<DispatchC extends ActorConfig>(hsm: HsmWithTracing<DispatchC>, eventName: string, ...eventPayload: unknown[]): Task {
	return (done: DoneCallback): void => {
		verbose_dispatchEvent(hsm, eventName, ...eventPayload)
			.catch((err: unknown) => hsm.dispatchErrorCallback(hsm, asError(err)))
			.finally(() => done());
	};
}
