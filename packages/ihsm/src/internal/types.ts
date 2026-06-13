/**
 * @internal Pure types for the ihsm runtime — no runtime values in this module.
 */
import type { TraceLevel } from './runtime';

export type Any = Record<string, any>;

/** Optional trailing argument on generated service client methods. */
export type ServiceCallOptions = {
	readonly timeoutMs?: number;
};

export interface ActorConfig {
	context?: object;
	services?: object;
	notifications?: object;
	internalServices?: object;
	internalNotifications?: object;
	port?: object;
}

export type ActorContextOf<C extends ActorConfig> = C extends { context: infer Context } ? Context : Any;
export type ActorServicesOf<C extends ActorConfig> = C extends { services: infer S extends object } ? S : {};
export type ActorNotificationsOf<C extends ActorConfig> = C extends { notifications: infer N extends object } ? N : {};
export type ActorInternalServicesOf<C extends ActorConfig> = C extends { internalServices: infer S extends object } ? S : {};
export type ActorInternalNotificationsOf<C extends ActorConfig> = C extends { internalNotifications: infer N extends object } ? N : {};
export type DomainPortOf<C extends ActorConfig> = C extends { port: infer P extends object } ? P : {};
export type ActorPortOf<C extends ActorConfig> = C extends { port: infer P extends object } ? P & PortServices<C> : IPort<C>;
export type ActorMethodKeysOf<C extends ActorConfig> = keyof ActorServicesOf<C> | keyof ActorNotificationsOf<C> | keyof ActorInternalServicesOf<C> | keyof ActorInternalNotificationsOf<C>;
export type ProtocolBucket = 'services' | 'notifications' | 'internalServices' | 'internalNotifications';

/** Structural root state instance — merged with the runtime {@link TopState} class. */
export interface TopState<C extends ActorConfig = ActorConfig> {
	readonly ctx: ActorContextOf<C>;
}

export type StateClassOf<C extends ActorConfig = ActorConfig> = abstract new (...args: never[]) => TopState<C>;
export type TopStateArg<C extends ActorConfig = ActorConfig> = StateClassOf<C>;
export type ActorConfigOf<T> = T extends abstract new (...args: never[]) => TopState<infer C extends ActorConfig>
	? C
	: T extends TopStateArg<infer C>
		? C
		: T extends abstract new (...args: never[]) => infer Inst
			? Inst extends { readonly hsm: HandlerHsm<infer C> }
				? C
				: Inst extends { readonly ctx: infer Context }
					? [Context] extends [ActorContextOf<infer C>]
						? C
						: ActorConfig
					: ActorConfig
			: T extends { readonly ctx: infer Context }
				? [Context] extends [ActorContextOf<infer C>]
					? C
					: ActorConfig
				: ActorConfig;

/** Top state constructor whose {@link ActorConfigOf} passes {@link DisjointActorConfig}. */
export type ValidatedTopStateArg<T extends TopStateArg<ActorConfig>> = DisjointActorConfig<ActorConfigOf<T>> extends true ? T : never;
export type MachineContext<T> = ActorContextOf<ActorConfigOf<T>>;
export type MachinePublic<T> = ActorServicesOf<ActorConfigOf<T>> & ActorNotificationsOf<ActorConfigOf<T>>;
export type MachineInternal<T> = ActorInternalServicesOf<ActorConfigOf<T>> & ActorInternalNotificationsOf<ActorConfigOf<T>>;
export type MachinePort<T> = ActorPortOf<ActorConfigOf<T>>;

export type ReservedName = 'ctx' | 'hsm' | 'onEntry' | 'onExit' | 'onError' | 'onUnhandled';
export type IsReservedName<K extends PropertyKey> = K extends ReservedName ? true : false;
export type FilterReservedKeys<O extends object> = {
	[K in keyof O as IsReservedName<K> extends true ? never : K]: O[K];
};
export type ServiceHandler<Reply> = Reply | Promise<Reply>;
export type NotificationHandler = void | Promise<void>;
export type AssertAsyncService<M> = M extends (...args: never[]) => infer R ? (R extends Promise<unknown> ? M : ['ihsm: service members must return Promise<Reply>', M]) : M;
export type ServiceArgs<S extends object, K extends keyof S> = S[K] extends (...args: infer A) => Promise<unknown> ? A : never;
export type ServiceReply<S extends object, K extends keyof S> = S[K] extends (...args: never[]) => Promise<infer R> ? Awaited<R> : never;
export type NotificationArgs<N extends object, K extends keyof N> = N[K] extends (...args: infer A) => void | Promise<void> ? A : never;

type BucketKeys<B> = {} extends B ? never : keyof B;
type ProtocolFieldKeys<C extends ActorConfig> = BucketKeys<ActorServicesOf<C>> | BucketKeys<ActorNotificationsOf<C>> | BucketKeys<ActorInternalServicesOf<C>> | BucketKeys<ActorInternalNotificationsOf<C>>;

type OverlappingProtocolKeys<C extends ActorConfig> =
	Extract<BucketKeys<ActorServicesOf<C>> & BucketKeys<ActorNotificationsOf<C>>, PropertyKey> extends never
		? Extract<BucketKeys<ActorServicesOf<C>> & BucketKeys<ActorInternalServicesOf<C>>, PropertyKey> extends never
			? Extract<BucketKeys<ActorServicesOf<C>> & BucketKeys<ActorInternalNotificationsOf<C>>, PropertyKey> extends never
				? Extract<BucketKeys<ActorNotificationsOf<C>> & BucketKeys<ActorInternalServicesOf<C>>, PropertyKey> extends never
					? Extract<BucketKeys<ActorNotificationsOf<C>> & BucketKeys<ActorInternalNotificationsOf<C>>, PropertyKey> extends never
						? Extract<BucketKeys<ActorInternalServicesOf<C>> & BucketKeys<ActorInternalNotificationsOf<C>>, PropertyKey> extends never
							? Extract<ProtocolFieldKeys<C>, ReservedName> extends never
								? true
								: ['ihsm: protocol keys must not use reserved names', Extract<ProtocolFieldKeys<C>, ReservedName>]
							: ['ihsm: internalServices and internalNotifications share keys', Extract<BucketKeys<ActorInternalServicesOf<C>> & BucketKeys<ActorInternalNotificationsOf<C>>, PropertyKey>]
						: ['ihsm: notifications and internalNotifications share keys', Extract<BucketKeys<ActorNotificationsOf<C>> & BucketKeys<ActorInternalNotificationsOf<C>>, PropertyKey>]
					: ['ihsm: notifications and internalServices share keys', Extract<BucketKeys<ActorNotificationsOf<C>> & BucketKeys<ActorInternalServicesOf<C>>, PropertyKey>]
				: ['ihsm: services and internalNotifications share keys', Extract<BucketKeys<ActorServicesOf<C>> & BucketKeys<ActorInternalNotificationsOf<C>>, PropertyKey>]
			: ['ihsm: services and internalServices share keys', Extract<BucketKeys<ActorServicesOf<C>> & BucketKeys<ActorInternalServicesOf<C>>, PropertyKey>]
		: ['ihsm: services and notifications share keys', Extract<BucketKeys<ActorServicesOf<C>> & BucketKeys<ActorNotificationsOf<C>>, PropertyKey>];

export type DisjointActorConfig<C extends ActorConfig> = OverlappingProtocolKeys<C>;
export type ValidatedActorConfig<C extends ActorConfig> = DisjointActorConfig<C> extends true ? C : never;

//#region Public configuration and tracing types

export interface DispatchErrorCallback<C extends ActorConfig = ActorConfig> {
	(hsm: Properties<C>, err: Error): void;
}

export interface TraceWriter {
	write<C extends ActorConfig>(hsm: Properties<C>, msg: any): void;
}

export interface Properties<C extends ActorConfig = ActorConfig> {
	currentState: StateClass<C>;
	readonly currentStateName: string;
	readonly topState: StateClass<C>;
	readonly topStateName: string;
	readonly ctxTypeName: string;
	readonly traceHeader: string;
	readonly eventName: string;
	readonly eventPayload: unknown[];
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	dispatchErrorCallback: DispatchErrorCallback<C>;
}

export type StateClass<C extends ActorConfig = ActorConfig> = StateClassOf<C>;

//#endregion

//#region Ports and testing trace types

export interface Disposable {
	dispose(): void;
}

export interface ResultWithSubscription<Result> {
	readonly value: Result;
	readonly subscription: Disposable;
}

export interface TracedMessage {
	readonly event: string;
	readonly payload: readonly unknown[];
}

export type EventObserver = (message: TracedMessage) => void;

/** Parent-machine link on {@link ParentActor} and optional `parent` on actor shells. */
export const kParentLink = Symbol('ihsm.parentLink');

/** Active {@link Machine} on handler instances — set in {@link Machine} constructor. */
export const kHandlerMachine = Symbol('ihsm.handlerMachine');

export type ParentActor<T extends TopStateArg = TopStateArg> = {
	readonly top: T;
	readonly [kParentLink]?: import('./runtime').Machine<ActorConfigOf<T>>;
};

type ActorParentField<ParentT extends TopStateArg = TopStateArg> = {
	readonly parent?: ParentActor<ParentT>;
};

export interface RandomService {
	random(): number;
	cryptoRandom(): number;
	randomUUID(): string;
	getRandomValues<T extends ArrayBufferView>(array: T): T;
}

export interface TimerService {
	setTimeout(callback: () => void, millis?: number): number;
	clearTimeout(id: number | undefined): void;
	setInterval(callback: () => void, millis?: number): number;
	clearInterval(id: number | undefined): void;
}

//#endregion

//#region Generated actor handles

export type ServiceClient<S extends object> = {
	[K in keyof S]: S[K] extends (...args: infer A) => Promise<infer R> ? (...args: [...A, ServiceCallOptions?]) => Promise<R> : never;
};

export type NotificationClient<N extends object> = {
	[K in keyof N]: N[K] extends (...args: infer A) => void | Promise<void> ? (...args: A) => void : never;
};

/** @deprecated Handler-only; root shells use {@link ExternalActor}. */
export type ActorCore<C extends ActorConfig = ActorConfig> = {
	ctx: ActorContextOf<C>;
	hsm: ActorHsm<C>;
};

export type ExternalHsm<C extends ActorConfig = ActorConfig> = ActorHsm<C>;

export type ExternalActor<C extends ActorConfig = ActorConfig> = ActorParentField &
	ServiceClient<ActorServicesOf<C>> &
	NotificationClient<ActorNotificationsOf<C>> & {
		readonly hsm: ExternalHsm<C>;
	};

/** @deprecated Use {@link ExternalActor} — root shells have no `ctx`. */
export type Actor<C extends ActorConfig = ActorConfig> = ExternalActor<C> & { ctx?: never };

export type InboundHsm<C extends ActorConfig = ActorConfig> = TestActorHsm<C>;

export type InboundActor<C extends ActorConfig = ActorConfig> = ActorParentField &
	ServiceClient<ActorServicesOf<C>> &
	NotificationClient<ActorNotificationsOf<C>> &
	NotificationClient<ActorInternalNotificationsOf<C>> & {
		readonly hsm: InboundHsm<C>;
	};

/** @deprecated Use {@link InboundActor}. */
export type InternalActor<C extends ActorConfig = ActorConfig> = InboundActor<C>;

/** @deprecated Use {@link InboundHsm}. */
export type InternalActorHsm<C extends ActorConfig = ActorConfig> = InboundHsm<C>;

export type ChildHsm<C extends ActorConfig = ActorConfig> = OwnerActorHsm<C>;

export type ChildActor<C extends ActorConfig = ActorConfig> = InboundActor<C> &
	ServiceClient<ActorInternalServicesOf<C>> & {
		readonly hsm: ChildHsm<C>;
	};

/** @deprecated Use {@link ChildActor}. */
export type OwnerActor<C extends ActorConfig = ActorConfig> = ChildActor<C>;

export type SelfNotifications<C extends ActorConfig = ActorConfig> = NotificationClient<ActorNotificationsOf<C>> & NotificationClient<ActorInternalNotificationsOf<C>>;

/** Timer, random, and deferred self-notifications — always on {@link ActorPortOf}. */
export type PortServices<C extends ActorConfig = ActorConfig> = TimerService &
	RandomService & {
		defer(ms: number): SelfNotifications<C>;
	};

/** Runtime port — timers, randomness, deferred notifications, and {@link IPort.actor}. */
export interface IPort<C extends ActorConfig = ActorConfig> extends TimerService, RandomService {
	actor: InboundActor<C> | ChildActor<C>;
	defer(ms: number): SelfNotifications<C>;
}

/** Port instance passed to a factory before {@link IPort.actor} is bound. */
export type MachinePortInput<C extends ActorConfig = ActorConfig> = import('./runtime').Port<Any>;

export type HandlerHsm<C extends ActorConfig = ActorConfig> = {
	ctx: ActorContextOf<C>;
	transition(next: StateClassOf<C>): void;
	actor: SelfNotifications<C>;
	immediate: SelfNotifications<C>;
	port: ActorPortOf<C>;
	unhandled(): never;
	eventName: string;
	eventPayload: unknown[];
	currentState: StateClassOf<C>;
	currentStateName: string;
	topState: StateClassOf<C>;
	topStateName: string;
	traceHeader: string;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	dispatchErrorCallback: DispatchErrorCallback<C>;
};

export interface TopState<C extends ActorConfig = ActorConfig> {
	readonly hsm: HandlerHsm<C>;
}

export type ActorHsm<C extends ActorConfig = ActorConfig> = {
	sync(): Promise<void>;
	currentStateName: string;
	topStateName: string;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	traceHeader: string;
};

export type TestActorHsm<C extends ActorConfig = ActorConfig> = ActorHsm<C> & {
	currentState: StateClassOf<C>;
	topState: StateClassOf<C>;
};

export type OwnerActorHsm<C extends ActorConfig = ActorConfig> = TestActorHsm<C> & {
	restore(state: StateClassOf<C>, ctx: ActorContextOf<C>): void;
	dispatchErrorCallback: DispatchErrorCallback<C>;
};

export type TestHsm<C extends ActorConfig = ActorConfig> = ChildHsm<C> & {
	port: ActorPortOf<C>;
	subscribe(observer: (message: { event: string; payload: unknown[] }) => void): { dispose(): void };
};

/** @deprecated Use {@link TestHsm} */
export type TestOwnerActorHsm<C extends ActorConfig = ActorConfig> = TestHsm<C>;

export type EmbodimentKind = 'root' | 'inbound' | 'child' | 'test';

/** @deprecated Use {@link EmbodimentKind}. */
export type HandleWidth = EmbodimentKind;

//#endregion

//#region State lifecycle (types only — implementations on runtime TopState)

export interface StateEvents<C extends ActorConfig = ActorConfig> {
	onExit(): Promise<void> | void;
	onEntry(): Promise<void> | void;
	onError(error: import('./runtime').RuntimeError<C>): Promise<void> | void;
	onUnhandled(error: import('./runtime').UnhandledEventError<C>): Promise<void> | void;
}

/** Machine snapshot passed to error constructors at failure time. */
export type ErrorHost<C extends ActorConfig = ActorConfig> = {
	readonly ctx: ActorContextOf<C>;
	readonly topStateName: string;
	readonly currentStateName: string;
	readonly eventName: string;
	readonly eventPayload: unknown[];
};

//#endregion

//#region Internal runtime host types

export interface Instance<C extends ActorConfig> {
	ctx: ActorContextOf<C>;
	hsm: HsmWithTracing<C>;
	portRef?: unknown;
}

export interface Transition<C extends ActorConfig> {
	execute(hsm: HsmWithTracing<C>, srcState: StateClassOf<C>, dstState: StateClassOf<C>): Promise<void>;
}

export type DoneCallback = () => void;
export type Task = (done: DoneCallback) => void;

export interface HsmWithTracing<C extends ActorConfig = ActorConfig> {
	readonly ctx: ActorContextOf<C>;
	readonly currentStateName: string;
	readonly topState: StateClassOf<C>;
	readonly topStateName: string;
	readonly ctxTypeName: string;
	readonly traceHeader: string;
	readonly eventName: string;
	readonly eventPayload: unknown[];

	currentState: StateClassOf<C>;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	dispatchErrorCallback: DispatchErrorCallback<C>;
	sync(): Promise<void>;
	restore(state: StateClassOf<C>, ctx: ActorContextOf<C>): void;
	transition(nextState: StateClassOf<C>): void;
	unhandled(): never;
	_transitionCache: Map<string, Transition<C>>;
	_createEventDispatchTask: <DispatchC extends ActorConfig>(hsm: HsmWithTracing<DispatchC>, eventName: string, ...eventPayload: unknown[]) => Task;
	_instance: Instance<C>;
	_transitionState?: StateClassOf<C>;
	_currentEventName?: string;
	_currentEventPayload?: unknown[];
	_tracePush(domain: string, msg: string): void;
	_tracePopDone(msg: string): void;
	_tracePopError(msg: string): void;
	_traceWrite(msg: any): void;
	pushTask(t: Task): void;
	unshiftHiPriorityTask(t: Task): void;
	pushHiPriorityTask(t: Task): void;
}

export interface ProtocolSlot {
	readonly bucket: ProtocolBucket;
	readonly name: string;
}

export interface ProtocolIndex {
	readonly slots: ReadonlyMap<string, ProtocolSlot>;
	get(name: string): ProtocolSlot | undefined;
	entries(kind: EmbodimentKind): Iterable<[string, ProtocolSlot]>;
}

export interface DispatchableMachine {
	dispatchService(name: string, args: unknown[]): Promise<unknown>;
	dispatchNotification(name: string, args: unknown[], queue: NotificationQueue): void;
	unshiftHiPriorityTask(t: (done: () => void) => void): void;
	readonly ctx: unknown;
	actorHsmFor(kind: EmbodimentKind): unknown;
}

export type NotificationQueue = 'default' | 'priority' | 'timer';
export type DispatchKind = 'notification' | 'service';

export interface TransitionResolver<C extends ActorConfig = ActorConfig> {
	resolve(src: StateClassOf<C>, dest: StateClassOf<C>): Transition<C>;
}

export interface PlannedTransition<C extends ActorConfig = ActorConfig> {
	readonly exit: readonly StateClassOf<C>[];
	readonly entry: readonly StateClassOf<C>[];
	readonly finalState?: StateClassOf<C>;
}

export interface TransitionRoutinePlan<C extends ActorConfig = ActorConfig> extends PlannedTransition<C> {
	readonly from: StateClassOf<C>;
	readonly to: StateClassOf<C>;
}

export interface TransitionTracer {
	traceTransitionStart(fromStateName: string, toStateName: string): void;
	traceHookDone(stateName: string, hook: 'onExit' | 'onEntry'): void;
	traceHookSkipped(stateName: string, hook: 'onExit' | 'onEntry'): void;
	traceHookError(stateName: string, hook: 'onExit' | 'onEntry', cause: unknown): void;
	traceTransitionDone(finalStateName: string): void;
}

export type TransitionRoutineStyle = 'production' | 'debug' | 'verbose';

export interface TransitionRoutineExecuteOptions<C extends ActorConfig = ActorConfig> {
	readonly style?: TransitionRoutineStyle;
	readonly tracer?: TransitionTracer;
	readonly setCurrentState?: (state: StateClassOf<C>) => void;
}

export type TransitionTraceHost = {
	_tracePush(domain: string, msg: string): void;
	_traceWrite(msg: string): void;
	_tracePopDone(msg: string): void;
	_tracePopError(msg: string): void;
};

export interface ActorOptions<C extends ActorConfig = ActorConfig> {
	initialize?: boolean;
	traceLevel?: TraceLevel;
	traceWriter?: TraceWriter;
	dispatchErrorCallback?: DispatchErrorCallback<C>;
	transitions?: TransitionResolver<C>;
}

//#endregion
