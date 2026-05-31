import { HsmWithTracing, Instance } from './internal/defs.private';
import { HsmObject } from './internal/hsm';
import { hasInitialState, quoteError, defineStateName as defineStateNameInternal, getStateName } from './internal/utils';

/**
 * Default context and protocol map when a machine is created without explicit typing.
 * @category Factory
 */
export type Any = Record<string, any>;

/**
 * Rejects an async {@link Hsm.call} service with an error.
 * @category Event handler
 */
export type RejectCallback = (error: Error) => void;

/**
 * Resolves an async {@link Hsm.call} service with a typed reply.
 * @category Event handler
 */
export type ResolveCallback<Reply> = (result: Reply) => void;

//
// Configuration
//

/**
 * Called when event dispatch fails and the runtime does not recover via `onError`.
 * @category Factory
 */
export interface DispatchErrorCallback<Context, Protocol extends {} | undefined> {
	(hsm: Base<Context, Protocol>, err: Error): void;
}
// export type DispatchErrorCallback<Context, Protocol extends {} | undefined> = (hsm: Hsm<Context, Protocol>, traceWriter: TraceWriter, err: Error) => void;

/**
 * Trace verbosity for dispatch logging.
 * @category Factory
 */
export enum TraceLevel {
	PRODUCTION,
	DEBUG,
	VERBOSE_DEBUG,
}

/**
 * Receives trace lines from the runtime and from handlers via `this.traceWriter.write`.
 * @category Factory
 */
export interface TraceWriter {
	write<Context, Protocol extends {} | undefined>(hsm: Properties<Context, Protocol>, msg: any): void;
}

/**
 * @category State machine
 */
export interface Properties<Context, Protocol extends {} | undefined> {
	readonly currentState: StateClass<Context, Protocol>;
	readonly currentStateName: string;
	readonly topState: StateClass<Context, Protocol>;
	readonly topStateName: string;
	readonly ctxTypeName: string;
	readonly traceHeader: string;
	readonly eventName: string;
	readonly eventPayload: any[];

	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	dispatchErrorCallback: DispatchErrorCallback<Context, Protocol>;
}

/**
 * @category State machine
 */
export interface Base<Context, Protocol extends {} | undefined> extends Properties<Context, Protocol> {
	post<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void;
	deferredPost<EventName extends keyof Protocol>(millis: number, eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void;
}

/**
 * @category State machine
 */
export interface State<Context, Protocol extends {} | undefined> extends Base<Context, Protocol> {
	readonly ctx: Context;
	transition(nextState: StateClass<Context, Protocol>): void;
	unhandled(): never;
	sleep(millis: number): Promise<void>;
	/** Handler-only: queue an event on the internal high-priority mailbox (before normal `post`). */
	postNow<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void;
}

/**
 * Actor handle returned by {@link makeHsm} — client API (`post`, `call`, `sync`, `restore`).
 * @category State machine
 */
export interface Hsm<Context = Any, Protocol extends {} | undefined = undefined> extends Base<Context, Protocol> {
	readonly ctx: Context;
	sync(): Promise<void>;
	restore(state: StateClass<Context, Protocol>, ctx: Context): void;
	call<EventName extends keyof Protocol>(eventName: ServiceName<Protocol, EventName>, ...eventPayload: ServiceRequest<Protocol, EventName>): Promise<ServiceResponse<Protocol, EventName>>;
}

/**
 * @category Event handler
 */

export type PostedEvent<Protocol extends {} | undefined, EventName extends keyof Protocol> = Protocol extends undefined ? string : EventName extends keyof State<any, any> ? never : EventName;

/**
 * @category Event handler
 */

export type EventPayload<Protocol extends {} | undefined, EventName extends keyof Protocol> = Protocol extends undefined ? any[] : Protocol[EventName] extends (...payload: infer Payload) => Promise<void> | void ? (Payload extends any[] ? Payload : never) : never;

/**
 * Constructor type for a state class in the machine hierarchy.
 * @category State machine
 */
export type StateClass<Context = Any, Protocol extends {} | undefined = undefined> = Function & { prototype: TopState<Context, Protocol> };

/**
 *
 */
export type ServiceRequest<Protocol, EventName extends keyof Protocol> = Protocol extends undefined ? any[] : Protocol[EventName] extends (resolve: (result: infer Reply) => void, reject: (error: infer Error) => void, ...payload: infer Payload) => Promise<void> | void ? (Payload extends any[] ? Payload : never) : never;

/**
 *
 */
export type ServiceResponse<Protocol, EventName extends keyof Protocol> = Protocol extends undefined ? any : Protocol[EventName] extends (resolve: infer Reply, reject: infer Error, ...payload: infer Payload) => Promise<void> | void ? Reply : never;

/**
 *
 */
export type ServiceName<Protocol, EventName> = Protocol extends undefined ? string : EventName extends keyof State<any, any> ? never : EventName;

/**
 * Optional lifecycle hooks implemented by state classes (`onEntry`, `onExit`, …).
 * @category State machine
 */
export interface StateEvents<Context, Protocol extends {} | undefined> {
	onExit(): Promise<void> | void;
	onEntry(): Promise<void> | void;
	onError<EventName extends keyof Protocol>(error: RuntimeError<Context, Protocol, EventName>): Promise<void> | void;
	onUnhandled<EventName extends keyof Protocol>(error: UnhandledEventError<Context, Protocol, EventName>): Promise<void> | void;
}

/**
 * Root of the state class hierarchy; hosts mailbox machinery. Subclass or pass to {@link makeHsm}.
 * @category State machine
 */
export abstract class TopState<Context = Any, Protocol extends {} | undefined = undefined> implements State<Context, Protocol>, StateEvents<Context, Protocol> {
	readonly ctx!: Context;
	readonly hsm!: State<Context, Protocol>;
	constructor() {
		throw new Error('Fatal error: States cannot be instantiated');
	}
	get eventName(): string {
		return this.hsm.eventName;
	}
	get eventPayload(): any[] {
		return this.hsm.eventPayload;
	}
	get traceHeader(): string {
		return this.hsm.traceHeader;
	}
	get topState(): StateClass<Context, Protocol> {
		return this.hsm.topState;
	}
	get currentStateName(): string {
		return this.hsm.currentStateName;
	}
	get currentState(): StateClass<Context, Protocol> {
		return this.hsm.currentState;
	}
	get ctxTypeName(): string {
		return this.hsm.ctxTypeName;
	}
	set traceLevel(value: TraceLevel) {
		this.hsm.traceLevel = value;
	}
	get traceLevel(): TraceLevel {
		return this.hsm.traceLevel;
	}
	get topStateName(): string {
		return this.hsm.topStateName;
	}
	get traceWriter(): TraceWriter {
		return this.hsm.traceWriter;
	}
	set traceWriter(value) {
		this.hsm.traceWriter = value;
	}

	get dispatchErrorCallback() {
		return this.hsm.dispatchErrorCallback;
	}
	set dispatchErrorCallback(value) {
		this.hsm.dispatchErrorCallback = value;
	}
	transition(nextState: StateClass<Context, Protocol>): void {
		this.hsm.transition(nextState);
	}
	unhandled(): never {
		this.hsm.unhandled();
	}
	sleep(millis: number): Promise<void> {
		return this.hsm.sleep(millis);
	}
	post<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void {
		this.hsm.post(eventName, ...eventPayload);
	}
	deferredPost<EventName extends keyof Protocol>(millis: number, eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void {
		this.hsm.deferredPost(millis, eventName, ...eventPayload);
	}
	postNow<EventName extends keyof Protocol>(eventName: PostedEvent<Protocol, EventName>, ...eventPayload: EventPayload<Protocol, EventName>): void {
		this.hsm.postNow(eventName, ...eventPayload);
	}

	onExit(): Promise<void> | void {}

	onEntry(): Promise<void> | void {}

	onError<EventName extends keyof Protocol>(error: RuntimeError<Context, Protocol, EventName>): Promise<void> | void {
		throw error;
	}

	onUnhandled<EventName extends keyof Protocol>(error: UnhandledEventError<Context, Protocol, EventName>): Promise<void> | void {
		throw error;
	}
}

/**
 * @category Error
 */
export abstract class HsmError<Context, Protocol extends {} | undefined> extends Error {
	name: string;
	topStateName: string;
	stateName: string;
	context: Context;
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
 * @category Error
 */
export abstract class RuntimeError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends HsmError<Context, Protocol> {
	eventName: PostedEvent<Protocol, EventName>;
	eventPayload: EventPayload<Protocol, EventName>;

	protected constructor(errorName: string, hsm: State<Context, Protocol>, message: string, cause?: Error) {
		super(errorName, hsm, message, cause);
		this.eventName = hsm.eventName as PostedEvent<Protocol, EventName>;
		this.eventPayload = hsm.eventPayload as EventPayload<Protocol, EventName>;
	}
}

/**
 * @category Error
 */
export class TransitionError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends RuntimeError<Context, Protocol, EventName> {
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
 * @category Error
 */
export class EventHandlerError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends RuntimeError<Context, Protocol, EventName> {
	constructor(hsm: State<Context, Protocol>, cause: Error) {
		super('EventHandlerError', hsm, `an error was thrown while executing event handler #${hsm.eventName} in state ${hsm.currentStateName}`, cause);
	}
}

/**
 * @category Error
 */
export class UnhandledEventError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends RuntimeError<Context, Protocol, EventName> {
	constructor(hsm: State<Context, Protocol>) {
		super('UnhandledEventError', hsm, `event #${hsm.eventName} was unhandled in state ${hsm.currentStateName}`);
	}
}

/**
 * @category Error
 */
export class InitialStateError<Context, Protocol extends {} | undefined> extends Error {
	targetStateName: string;

	constructor(targetState: StateClass<Context, Protocol>) {
		super(`State '${getStateName(Object.getPrototypeOf(targetState.prototype).constructor as StateClass<Context, Protocol>)}' must not have more than one initial state`);
		this.name = 'InitialStateError';
		this.targetStateName = getStateName(targetState);
	}
}

/**
 * @category Error
 */
export class FatalError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends RuntimeError<Context, Protocol, EventName> {
	constructor(hsm: State<Context, Protocol>, cause: Error) {
		super('FatalError', hsm, `onError() has thrown ${quoteError(cause)}`, cause);
	}
}

/**
 * @category Error
 */
export class InitializationError<Context, Protocol extends {} | undefined> extends HsmError<Context, Protocol> {
	constructor(
		hsm: State<Context, Protocol>,
		public failedState: StateClass<Context, Protocol>,
		cause: Error
	) {
		super('InitializationError', hsm, `state ${getStateName(failedState)} has thrown ${quoteError(cause)} during initialization`, cause);
	}
}

/**
 * Terminal error state class used when the machine cannot recover.
 * @category State machine
 */
export class FatalErrorState<Context, Protocol extends {} | undefined> extends TopState<Context, Protocol> {}

defineStateNameInternal(TopState, 'TopState');
defineStateNameInternal(FatalErrorState, 'FatalErrorState');

/**
 * Marks `TargetState` as the initial substate of its parent composite state.
 * @category Factory
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
 * Assigns a stable display name to a state class.
 *
 * Minifiers (and browser production bundles) rewrite class names, so the
 * built-in `Class.name` is unreliable in optimized builds. Registering an
 * explicit name keeps {@link Properties.currentStateName},
 * {@link Properties.topStateName}, trace output, and error messages stable in
 * every environment (Node and minified browsers alike).
 *
 * The name is stored as a non-enumerable, non-inherited own property, so it is
 * never accidentally shared with subclasses through the prototype chain.
 *
 * @example
 * ```ts
 * class Door extends TopState {}
 * defineStateName(Door, 'Door');
 * ```
 * @category State machine
 */
export function defineStateName<Context, Protocol extends {} | undefined>(state: StateClass<Context, Protocol>, name: string): void {
	defineStateNameInternal(state, name);
}

/**
 * Registers stable display names for every state class found in an exports map,
 * using the export key as the display name.
 *
 * This is the convenient way to make a whole machine module minification-safe:
 * pass the module namespace (or an object literal of the state classes) and
 * each state class gets its export key as its display name. Non state-class
 * values (factory functions, interfaces compiled away, constants) are ignored.
 *
 * @example
 * ```ts
 * // machine.ts
 * export class DoorTop extends TopState {}
 * export class Open extends DoorTop {}
 * export class Closed extends DoorTop {}
 * registerStateNames({ DoorTop, Open, Closed });
 * ```
 * @example
 * ```ts
 * // from another module
 * import * as machine from './machine';
 * registerStateNames(machine);
 * ```
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
 * Creates a state machine instance bound to the given context object.
 *
 * @param topState - Root state class
 * @param ctx - Mutable domain context
 * @param initialize - When `true`, walk `@InitialState` chain and run `onEntry` on the path to the initial leaf (default `true`)
 * @param traceLevel - Trace verbosity (default {@link TraceLevel.DEBUG})
 * @param traceWriter - Trace sink (default console logger)
 * @param dispatchErrorCallback - Hook when dispatch throws and is not recovered (default: log and rethrow)
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
