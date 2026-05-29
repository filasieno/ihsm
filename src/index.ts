import { HsmWithTracing, Instance } from './internal/defs.private';
import { HsmObject } from './internal/hsm';
import { hasInitialState, quoteError } from './internal/utils';

/**
 * todo
 * @category Factory
 */
export type HsmAny = Record<string, any>;

/**
 * todo
 * @category Event handler
 */
export type HsmRejectCallback = (error: Error) => void;

/**
 * todo
 * @category Event handler
 */
export type HsmResolveCallback<Reply> = (result: Reply) => void;

//
// Configuration
//

/**
 * todo
 * @category Factory
 */
export interface HsmDispatchErrorCallback<Context, Protocol extends {} | undefined> {
	(hsm: HsmBase<Context, Protocol>, err: Error): void;
}
// export type HsmDispatchErrorCallback<Context, Protocol extends {} | undefined> = (hsm: Hsm<Context, Protocol>, traceWriter: HsmTraceWriter, err: Error) => void;

/**
 * todo
 * @category Factory
 */
export enum HsmTraceLevel {
	PRODUCTION,
	DEBUG,
	VERBOSE_DEBUG,
}

/**
 * todo
 * @category Factory
 */
export interface HsmTraceWriter {
	write<Context, Protocol>(hsm: HsmProperties<Context, Protocol>, msg: any): void;
}

/**
 * @category State machine machine
 */
export interface HsmProperties<Context, Protocol extends {} | undefined> {
	readonly currentState: HsmStateClass<Context, Protocol>;
	readonly currentStateName: string;
	readonly topState: HsmStateClass<Context, Protocol>;
	readonly topStateName: string;
	readonly ctxTypeName: string;
	readonly traceHeader: string;
	readonly eventName: string;
	readonly eventPayload: any[];

	traceLevel: HsmTraceLevel;
	traceWriter: HsmTraceWriter;
	dispatchErrorCallback: HsmDispatchErrorCallback<Context, Protocol>;
}

/**
 * @category State machine machine
 */
export interface HsmBase<Context, Protocol extends {} | undefined> extends HsmProperties<Context, Protocol> {
	post<EventName extends keyof Protocol>(eventName: HsmEventHandlerName<Protocol, EventName>, ...eventPayload: HsmEventHandlerPayload<Protocol, EventName>): void;
	deferredPost<EventName extends keyof Protocol>(millis: number, eventName: HsmEventHandlerName<Protocol, EventName>, ...eventPayload: HsmEventHandlerPayload<Protocol, EventName>): void;
}

/**
 * @category State machine machine
 */
export interface HsmState<Context, Protocol extends {} | undefined> extends HsmBase<Context, Protocol> {
	readonly ctx: Context;
	transition(nextState: HsmStateClass<Context, Protocol>): void;
	unhandled(): never;
	sleep(millis: number): Promise<void>;
}

/**
 * todo
 * @category State machine
 */
export interface Hsm<Context = HsmAny, Protocol extends {} | undefined = undefined> extends HsmBase<Context, Protocol> {
	sync(): Promise<void>;
	restore(state: HsmStateClass<Context, Protocol>, ctx: Context): void;
	call<EventName extends keyof Protocol>(eventName: HsmServiceName<Protocol, EventName>, ...eventPayload: HsmServiceRequest<Protocol, EventName>): Promise<HsmServiceResponse<Protocol, EventName>>;
}

/**
 * @category Event handler
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HsmEventHandlerName<Protocol extends {} | undefined, EventName extends keyof Protocol> = Protocol extends undefined ? string : EventName extends keyof HsmState<any, any> ? never : EventName;

/**
 * @category Event handler
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type HsmEventHandlerPayload<Protocol extends {} | undefined, EventName extends keyof Protocol> = Protocol extends undefined ? any[] : Protocol[EventName] extends (...payload: infer Payload) => Promise<void> | void ? (Payload extends any[] ? Payload : never) : never;

/**
 * todo
 * @category State machine
 */
export type HsmStateClass<Context = HsmAny, Protocol extends {} | undefined = undefined> = Function & { prototype: HsmTopState<Context, Protocol> };

/**
 *
 */
export type HsmServiceRequest<Protocol, EventName extends keyof Protocol> = Protocol extends undefined ? any[] : Protocol[EventName] extends (resolve: (result: infer Reply) => void, reject: (error: infer Error) => void, ...payload: infer Payload) => Promise<void> | void ? (Payload extends any[] ? Payload : never) : never;

/**
 *
 */
export type HsmServiceResponse<Protocol, EventName extends keyof Protocol> = Protocol extends undefined ? any : Protocol[EventName] extends (resolve: infer Reply, reject: infer Error, ...payload: infer Payload) => Promise<void> | void ? Reply : never;

/**
 *
 */
export type HsmServiceName<Protocol, EventName> = Protocol extends undefined ? string : EventName extends keyof HsmState<any, any> ? never : EventName;

/**
 * todo
 * @category State machine
 */
export interface HsmStateMachineEvents<Context, Protocol> {
	onExit(): Promise<void> | void;
	onEntry(): Promise<void> | void;
	onError<EventName extends keyof Protocol>(error: HsmRuntimeError<Context, Protocol, EventName>): Promise<void> | void;
	onUnhandled<EventName extends keyof Protocol>(error: HsmUnhandledEventError<Context, Protocol, EventName>): Promise<void> | void;
}

/**
 * todo
 * @category State machine
 */
export abstract class HsmTopState<Context = HsmAny, Protocol extends {} | undefined = undefined> implements HsmState<Context, Protocol>, HsmStateMachineEvents<Context, Protocol> {
	readonly ctx!: Context;
	readonly hsm!: HsmState<Context, Protocol>;
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
	get topState(): HsmStateClass<Context, Protocol> {
		return this.hsm.topState;
	}
	get currentStateName(): string {
		return this.hsm.currentStateName;
	}
	get currentState(): HsmStateClass<Context, Protocol> {
		return this.hsm.currentState;
	}
	get ctxTypeName(): string {
		return this.hsm.ctxTypeName;
	}
	set traceLevel(value: HsmTraceLevel) {
		this.hsm.traceLevel = value;
	}
	get traceLevel(): HsmTraceLevel {
		return this.hsm.traceLevel;
	}
	get topStateName(): string {
		return this.hsm.topStateName;
	}
	get traceWriter(): HsmTraceWriter {
		return this.hsm.traceWriter;
	}
	set traceWriter(value) {
		this.hsm.traceWriter = value;
	}
	// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
	get dispatchErrorCallback() {
		return this.hsm.dispatchErrorCallback;
	}
	set dispatchErrorCallback(value) {
		this.hsm.dispatchErrorCallback = value;
	}
	transition(nextState: HsmStateClass<Context, Protocol>): void {
		this.hsm.transition(nextState);
	}
	unhandled(): never {
		this.hsm.unhandled();
	}
	sleep(millis: number): Promise<void> {
		return this.hsm.sleep(millis);
	}
	post<EventName extends keyof Protocol>(eventName: HsmEventHandlerName<Protocol, EventName>, ...eventPayload: HsmEventHandlerPayload<Protocol, EventName>): void {
		this.hsm.post(eventName, ...eventPayload);
	}
	deferredPost<EventName extends keyof Protocol>(millis: number, eventName: HsmEventHandlerName<Protocol, EventName>, ...eventPayload: HsmEventHandlerPayload<Protocol, EventName>): void {
		this.hsm.deferredPost(millis, eventName, ...eventPayload);
	}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	onExit(): Promise<void> | void {}
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	onEntry(): Promise<void> | void {}

	onError<EventName extends keyof Protocol>(error: HsmRuntimeError<Context, Protocol, EventName>): Promise<void> | void {
		throw error;
	}

	onUnhandled<EventName extends keyof Protocol>(error: HsmUnhandledEventError<Context, Protocol, EventName>): Promise<void> | void {
		throw error;
	}
}

/**
 * @category Error
 */
export abstract class HsmError<Context, Protocol extends {} | undefined> extends Error {
	name: string;
	hsmTopStateName: string;
	hsmStateName: string;
	hsmContext: Context;
	cause?: Error;

	protected constructor(name: string, hsm: HsmState<Context, Protocol>, message: string, cause?: Error) {
		super(message);
		this.name = name;
		this.hsmTopStateName = hsm.topStateName;
		this.hsmStateName = hsm.currentState.name;
		this.hsmContext = hsm.ctx;
		this.cause = cause;
	}
}

/**
 * @category Error
 */
export abstract class HsmRuntimeError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends HsmError<Context, Protocol> {
	eventName: HsmEventHandlerName<Protocol, EventName>;
	eventPayload: HsmEventHandlerPayload<Protocol, EventName>;

	protected constructor(errorName: string, hsm: HsmState<Context, Protocol>, message: string, cause?: Error) {
		super(errorName, hsm, message, cause);
		this.eventName = hsm.eventName as HsmEventHandlerName<Protocol, EventName>;
		this.eventPayload = hsm.eventPayload as HsmEventHandlerPayload<Protocol, EventName>;
	}
}

/**
 * @category Error
 */
export class HsmTransitionError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends HsmRuntimeError<Context, Protocol, EventName> {
	constructor(hsm: HsmState<Context, Protocol>, cause: Error, public failedStateName: string, public failedCallback: 'onExit' | 'onEntry', public fromStateName: string, public toStateName: string) {
		super('HsmTransitionError', hsm, `${failedStateName}.${failedCallback}() has failed while executing a transition from ${fromStateName} to ${toStateName}`, cause);
	}
}

/**
 * @category Error
 */
export class HsmEventHandlerError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends HsmRuntimeError<Context, Protocol, EventName> {
	constructor(hsm: HsmState<Context, Protocol>, cause: Error) {
		super('EventHandlerError', hsm, `an error was thrown while executing event handler #${hsm.eventName} in state ${hsm.currentStateName}`, cause);
	}
}

/**
 * @category Error
 */
export class HsmUnhandledEventError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends HsmRuntimeError<Context, Protocol, EventName> {
	constructor(hsm: HsmState<Context, Protocol>) {
		super('HsmUnhandledEventError', hsm, `event #${hsm.eventName} was unhandled in state ${hsm.currentStateName}`);
	}
}

/**
 * @category Error
 */
export class HsmInitialStateError<Context, Protocol extends {} | undefined> extends Error {
	targetStateName: string;

	constructor(targetState: HsmStateClass<Context, Protocol>) {
		super(`State '${Object.getPrototypeOf(targetState).constructor.name}' must not have more than one initial state`);
		this.name = 'HsmInitialStateError';
		this.targetStateName = targetState.name;
	}
}

/**
 * @category Error
 */
export class HsmFatalError<Context, Protocol extends {} | undefined, EventName extends keyof Protocol> extends HsmRuntimeError<Context, Protocol, EventName> {
	constructor(hsm: HsmState<Context, Protocol>, cause: Error) {
		super('HsmFatalError', hsm, `onError() has thrown ${quoteError(cause)}`, cause);
	}
}

/**
 * @category Error
 */
export class HsmInitializationError<Context, Protocol extends {} | undefined> extends HsmError<Context, Protocol> {
	constructor(hsm: HsmState<Context, Protocol>, public failedState: HsmStateClass<Context, Protocol>, cause: Error) {
		super('HsmInitializationError', hsm, `state ${failedState.name} has thrown ${quoteError(cause)} during initialization`, cause);
	}
}

/**
 * todo
 * @category State machine
 */
export class HsmFatalErrorState<Context, Protocol extends {} | undefined> extends HsmTopState<Context, Protocol> {}

/**
 * todo
 *
 * @param {State<Context, Protocol>} TargetState
 *
 * @typeparam DispatchContext
 * @typeparam DispatchProtocol
 *
 * @category Factory
 */
export function HsmInitialState<Context, Protocol extends {} | undefined>(TargetState: HsmStateClass<Context, Protocol>): void {
	const ParentOfTargetState = Object.getPrototypeOf(TargetState.prototype).constructor;
	if (hasInitialState(ParentOfTargetState)) throw new HsmInitialStateError(TargetState);
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

/** @internal */
class ConsoleTraceWriter implements HsmTraceWriter {
	write<Context, Protocol extends {} | undefined>(hsm: HsmProperties<Context, Protocol>, Message: any): void {
		if (typeof Message == 'string') {
			console.log(`${hsm.traceHeader}${hsm.currentStateName}: ${Message}`);
		} else {
			console.log(Message);
		}
	}
}

/**
 * todo
 * @category Factory
 */
export class HsmFactory<Context, Protocol extends undefined | {}> {
	private static defaultDispatchErrorCallback<Context, Protocol extends {} | undefined>(hsm: HsmBase<Context, Protocol>, err: Error): void {
		const writer = hsm.traceWriter;
		writer.write(hsm, `An event dispatch has failed; error ${err.name}: ${err.message} has not been managed`);
		writer.write(hsm, err);
		throw err;
	}
	private static defaultTraceWriter = new ConsoleTraceWriter();
	private static defaultTraceLevel = HsmTraceLevel.DEBUG;
	private static defaultInitialize = true;
	constructor(public topState: HsmStateClass<Context, Protocol>, public initialize = HsmFactory.defaultInitialize, public traceLevel = HsmFactory.defaultTraceLevel, public traceWriter = HsmFactory.defaultTraceWriter, public dispatchErrorCallback = HsmFactory.defaultDispatchErrorCallback) {}

	create(ctx: Context, initialize: boolean = this.initialize, traceLevel = this.traceLevel, traceWriter = this.traceWriter, dispatchErrorCallback = this.dispatchErrorCallback): Hsm<Context, Protocol> {
		const instance: Instance<Context, Protocol> = {
			hsm: (undefined as unknown) as HsmWithTracing<Context, Protocol>,
			ctx: ctx,
		};
		Object.setPrototypeOf(instance, this.topState.prototype);
		instance.hsm = new HsmObject(this.topState, instance, traceWriter, traceLevel, dispatchErrorCallback, initialize);
		return instance.hsm;
	}
}
