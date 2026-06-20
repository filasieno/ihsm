/**
 * @internal Pure types for the ihsm runtime — no runtime values in this module.
 */
import type { Machine, Port, RuntimeError, TopState as RuntimeTopState, TraceLevel, UnhandledEventError } from './runtime';

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

export type StateClassOf<C extends ActorConfig = ActorConfig> = new (...args: any[]) => RuntimeTopState<C>;
export type TopStateArg<C extends ActorConfig = ActorConfig> = StateClassOf<C>;

export type ActorConfigOf<T> = T extends new (...args: any[]) => RuntimeTopState<infer C extends ActorConfig>
	? C
	: T extends TopStateArg<infer C>
		? C
		: T extends abstract new (...args: never[]) => RuntimeTopState<infer C extends ActorConfig>
			? C
			: T extends new (...args: any[]) => infer Inst
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

export type ReservedName = 'ctx' | 'hsm' | 'notify' | 'notifyNow' | 'onEntry' | 'onExit' | 'onError' | 'onUnhandled';
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

export type OverlappingProtocolKeys<C extends ActorConfig> =
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
	readonly actorUuid: string;
	readonly actorName: string;
	readonly actorPath: string;
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
	readonly [kParentLink]?: Machine<ActorConfigOf<T>>;
};

/** Optional parent link on actors created via {@link makeChildActor}. */
export type ActorParentField<ParentT extends TopStateArg = TopStateArg> = {
	readonly parent?: ParentActor<ParentT>;
};

export interface RandomService {
	/** Pseudorandom number in `[0, 1)`. */
	random(): number;
	/** Cryptographic-quality random in `[0, 1)` when the platform provides it. */
	cryptoRandom(): number;
	/** Generate a UUID v4 string. */
	randomUUID(): string;
	/** Fill `array` with cryptographically strong random bytes. */
	getRandomValues<T extends ArrayBufferView>(array: T): T;
}

export interface TimerService {
	/** Schedule a one-shot callback after `millis` milliseconds. */
	setTimeout(callback: () => void, millis?: number): number;
	/** Cancel a timer previously returned by {@link TimerService.setTimeout}. */
	clearTimeout(id: number | undefined): void;
	/** Schedule a repeating callback every `millis` milliseconds. */
	setInterval(callback: () => void, millis?: number): number;
	/** Cancel an interval previously returned by {@link TimerService.setInterval}. */
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

/**
 * Faceted call surface — `actor.call.<service>(...)` returns `Promise<Reply>`.
 * Delivery mode is chosen by the facet at the call site, not inferred.
 */
export type CallFacet<S extends object> = ServiceClient<S>;

/** Faceted notification surface — `actor.notify.<event>(...)` / `actor.notifyNow.<event>(...)`. */
export type NotifyFacet<N extends object> = NotificationClient<N>;

export type ActorHsm<_C extends ActorConfig = ActorConfig> = {
	sync(): Promise<void>;
	currentStateName: string;
	topStateName: string;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	traceHeader: string;
	readonly id: string;
	readonly actorUuid: string;
	readonly actorName: string;
	readonly actorPath: string;
};

export type TestActorHsm<C extends ActorConfig = ActorConfig> = ActorHsm<C> & {
	currentState: StateClassOf<C>;
	topState: StateClassOf<C>;
};

export type OwnerActorHsm<C extends ActorConfig = ActorConfig> = TestActorHsm<C> & {
	restore(state: StateClassOf<C>, ctx: ActorContextOf<C>): void;
	dispatchErrorCallback: DispatchErrorCallback<C>;
};

export type ExternalActor<C extends ActorConfig = ActorConfig> = ActorParentField & {
	readonly id: string;
	readonly notify: NotifyFacet<ActorNotificationsOf<C>>;
	readonly notifyNow: NotifyFacet<ActorNotificationsOf<C>>;
	readonly call: CallFacet<ActorServicesOf<C>>;
	readonly hsm: ActorHsm<C>;
};

export type ExternalHsm<C extends ActorConfig = ActorConfig> = ExternalActor<C>['hsm'];

export type InboundActor<C extends ActorConfig = ActorConfig> = ActorParentField & {
	readonly id: string;
	readonly notify: NotifyFacet<ActorNotificationsOf<C> & ActorInternalNotificationsOf<C>>;
	readonly notifyNow: NotifyFacet<ActorNotificationsOf<C> & ActorInternalNotificationsOf<C>>;
	readonly call: CallFacet<ActorServicesOf<C>>;
	readonly hsm: TestActorHsm<C>;
};

export type InboundHsm<C extends ActorConfig = ActorConfig> = InboundActor<C>['hsm'];

export type ChildActor<C extends ActorConfig = ActorConfig> = Omit<InboundActor<C>, 'call' | 'hsm'> & {
	readonly call: CallFacet<ActorServicesOf<C> & ActorInternalServicesOf<C>>;
	readonly hsm: OwnerActorHsm<C>;
};

export type ChildHsm<C extends ActorConfig = ActorConfig> = ChildActor<C>['hsm'];

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
export type UntypedPortInput = Port<TopStateArg>;
export type MachinePortInput<C extends ActorConfig = ActorConfig> = IPort<C> | UntypedPortInput;

export type HandlerHsm<C extends ActorConfig = ActorConfig> = {
	ctx: ActorContextOf<C>;
	transition(next: StateClassOf<C>): void;
	port: ActorPortOf<C>;
	unhandled(): never;
	eventName: string;
	eventPayload: unknown[];
	currentState: StateClassOf<C>;
	currentStateName: string;
	topState: StateClassOf<C>;
	topStateName: string;
	traceHeader: string;
	/** Structured live domain stack (`ihsm.domain.path`) — derived from the trace header (§4.10.3). */
	readonly traceFrames: readonly TraceFrame[];
	/** Severity-typed handler logger — emits trace-correlated OTEL logs (§4.10.1). */
	readonly log: ActorLogger;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	dispatchErrorCallback: DispatchErrorCallback<C>;
	readonly id: string;
	readonly actorUuid: string;
	readonly actorName: string;
	readonly actorPath: string;
};

/** Structural root state instance — merged with the runtime {@link TopState} class. */
export interface TopState<C extends ActorConfig = ActorConfig> {
	readonly ctx: ActorContextOf<C>;
	readonly hsm: HandlerHsm<C>;
	/** Self-directed default-queue notifications — `this.notify.x()`. */
	readonly notify: SelfNotifications<C>;
	/** Self-directed priority-queue notifications — `this.notifyNow.x()`. */
	readonly notifyNow: SelfNotifications<C>;
}

export type TestHsm<C extends ActorConfig = ActorConfig> = ChildHsm<C> & {
	port: ActorPortOf<C>;
	subscribe(observer: (message: { event: string; payload: unknown[] }) => void): { dispose(): void };
};

export type EmbodimentKind = 'root' | 'inbound' | 'child' | 'test';

//#endregion

//#region State lifecycle (types only — implementations on runtime TopState)

export interface StateEvents<C extends ActorConfig = ActorConfig> {
	onExit(): Promise<void> | void;
	onEntry(): Promise<void> | void;
	onError(error: RuntimeError<C>): Promise<void> | void;
	onUnhandled(error: UnhandledEventError<C>): Promise<void> | void;
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

/** @internal Per-actor runtime instance bag (context, handler facade, port). */
export interface Instance<C extends ActorConfig> {
	ctx: ActorContextOf<C>;
	hsm: HsmWithTracing<C>;
	portRef?: unknown;
}

/** @internal Compiled transition between two states. */
export interface Transition<C extends ActorConfig> {
	execute(hsm: HsmWithTracing<C>, srcState: StateClassOf<C>, dstState: StateClassOf<C>): Promise<void>;
}

export type DoneCallback = () => void;
/** @internal Run-to-completion work unit queued on the machine. */
export type Task = (done: DoneCallback) => void;

export interface ActorIdentity {
	readonly uuid: string;
	readonly name: string;
	readonly path: string;
	readonly kind: EmbodimentKind;
	readonly parentUuid?: string;
}

export type TriggerKind = 'external' | 'call' | 'self' | 'actor' | 'timer' | 'init';
export type DispatchPhase = 'lookup' | 'handler' | 'transition' | 'onEntry' | 'onExit' | 'unhandled' | 'initialize';

export interface MacrostepBegin {
	readonly id: string;
	readonly actor: ActorIdentity;
	readonly trigger: string;
	readonly triggerKind: TriggerKind;
	readonly startState: string;
	readonly cause?: CauseRef;
	/** For `timer` triggers — the scheduled delay, surfaced on the `ihsm.link.kind=timer` link (§4.7.5). */
	readonly delayMs?: number;
}

export interface MacrostepEnd {
	readonly id: string;
	readonly endState: string;
	readonly steps: number;
	readonly transitioned: boolean;
	readonly outcome: 'ok' | 'error';
}

export interface MicrostepBegin {
	readonly macrostepId: string;
	readonly seq: number;
	readonly event: string;
	readonly bucket: ProtocolBucket;
	readonly queue: NotificationQueue;
	readonly fromState: string;
	readonly handlerState?: string;
	readonly cause?: CauseRef;
}

export interface MicrostepEnd {
	readonly macrostepId: string;
	readonly seq: number;
	readonly toState: string;
	readonly transitioned: boolean;
	readonly async: boolean;
	readonly outcome: 'ok' | 'error';
}

export interface CauseRef {
	readonly actorUuid: string;
	readonly macrostepId?: string;
	readonly stepSeq?: number;
	readonly kind: 'cause' | 'timer' | 'message' | 'spawn' | 'wire';
	carrier?: Record<string, string>;
}

export interface SpawnInfo {
	readonly parent: CauseRef;
	readonly child: ActorIdentity;
}

export interface PortCallBegin {
	readonly callId: number;
	readonly method: string;
	readonly cause?: CauseRef;
}

export interface PortCallEnd {
	readonly callId: number;
	readonly method: string;
	readonly outcome: 'ok' | 'error';
	readonly error?: Error;
}

export interface OutboundCallBegin {
	readonly callId: number;
	readonly service: string;
	readonly targetUuid?: string;
	readonly cause?: CauseRef;
}

export interface OutboundCallEnd {
	readonly callId: number;
	readonly service: string;
	readonly outcome: 'ok' | 'error';
	readonly error?: Error;
}

export interface EnqueueInfo {
	readonly event: string;
	readonly queue: NotificationQueue;
	readonly delayMs?: number;
	readonly targetUuid?: string;
	cause: CauseRef;
}

export interface DispatchError {
	readonly phase: DispatchPhase;
	readonly errorClass: string;
	readonly error: Error;
	readonly recovered: boolean;
}

export interface TraceFrame {
	readonly name: string;
	readonly kind: 'event' | 'handler' | 'transition' | 'onEntry' | 'onExit' | 'port' | 'service' | 'initialize';
}

export type LogAttributes = Record<string, string | number | boolean>;

export interface LogRecord {
	readonly severity: 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
	readonly body: string;
	readonly attributes?: LogAttributes;
	readonly frames: readonly TraceFrame[];
	readonly error?: Error;
	readonly source: 'user' | 'runtime';
}

export interface ActorLogger {
	trace(message: string, attributes?: LogAttributes): void;
	debug(message: string, attributes?: LogAttributes): void;
	info(message: string, attributes?: LogAttributes): void;
	warn(message: string, attributes?: LogAttributes): void;
	error(message: string | Error, attributes?: LogAttributes): void;
	fatal(message: string | Error, attributes?: LogAttributes): void;
}

export interface Instrumentation<_C extends ActorConfig = ActorConfig> {
	onActorCreated?(id: ActorIdentity): void;
	onActorSpawned?(info: SpawnInfo): void;
	onActorDisposed?(id: ActorIdentity): void;
	onMacrostepBegin?(info: MacrostepBegin): void;
	onMacrostepEnd?(info: MacrostepEnd): void;
	onMicrostepBegin?(info: MicrostepBegin): void;
	onMicrostepEnd?(info: MicrostepEnd): void;
	onPortCallBegin?(info: PortCallBegin): void;
	onPortCallEnd?(info: PortCallEnd): void;
	onOutboundCallBegin?(info: OutboundCallBegin): void;
	onOutboundCallEnd?(info: OutboundCallEnd): void;
	onEnqueue?(info: EnqueueInfo): void;
	onError?(info: DispatchError): void;
	onLog?(record: LogRecord): void;
	transition?: TransitionTracer;
}

export interface ActorOptions<C extends ActorConfig = ActorConfig> {
	initialize?: boolean;
	traceLevel?: TraceLevel;
	traceWriter?: TraceWriter;
	dispatchErrorCallback?: DispatchErrorCallback<C>;
	transitions?: TransitionResolver<C>;
}

/** Machine host passed to {@link executeTransitionRoutine}. */
export interface TransitionHost<C extends ActorConfig = ActorConfig> {
	readonly ctx: ActorContextOf<C>;
	readonly currentStateName: string;
	readonly topState: StateClassOf<C>;
	readonly topStateName: string;
	readonly ctxTypeName: string;
	readonly traceHeader: string;
	readonly eventName: string;
	readonly eventPayload: unknown[];
	currentState: StateClassOf<C>;
}

/** @internal Runtime host passed to transition execution and dispatch tasks. */
export interface HsmWithTracing<C extends ActorConfig = ActorConfig> extends TransitionHost<C> {
	readonly actorUuid: string;
	readonly actorName: string;
	readonly actorPath: string;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	dispatchErrorCallback: DispatchErrorCallback<C>;
	reportDispatchError(err: Error): void;
	sync(): Promise<void>;
	restore(state: StateClassOf<C>, ctx: ActorContextOf<C>): void;
	transition(nextState: StateClassOf<C>): void;
	unhandled(): never;
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

/** @internal Machine surface used by generated actor handles and dispatch. */
export interface DispatchableMachine {
	dispatchService(name: string, args: unknown[]): Promise<unknown>;
	dispatchNotification(name: string, args: unknown[], queue: NotificationQueue): void;
	unshiftHiPriorityTask(t: (done: () => void) => void): void;
	readonly ctx: unknown;
	readonly actorUuid: string;
	actorHsmFor(kind: EmbodimentKind): unknown;
	/**
	 * Timer service used to arm service-call timeouts. The actor's bound port when it provides a
	 * timer service (so a virtual clock governs `timeoutMs` deterministically), otherwise
	 * `undefined` (the runtime falls back to the host timer).
	 */
	readonly callTimer?: TimerService;
}

export type NotificationQueue = 'default' | 'priority' | 'timer';

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
	traceInitializeStart?(stateName: string): void;
	traceInitializeDone?(finalStateName: string): void;
	/** Optional: fired just before a real (non-default) `onExit`/`onEntry` runs — lets a structural tracer bracket the hook as a child span. */
	traceHookStart?(stateName: string, hook: 'onExit' | 'onEntry'): void;
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
	/**
	 * Emit hook (`onExit`/`onEntry`) tracer callbacks regardless of `style`. Set when the tracer is a
	 * structural instrumentation seam (not the console tracer), whose entry/exit spans are not
	 * `TraceLevel`-gated (spec §4.8). Default `false` — console tracer keeps its verbose-only gating.
	 */
	readonly hookEvents?: boolean;
}

export type TransitionTraceHost = {
	_tracePush(domain: string, msg: string): void;
	_traceWrite(msg: string): void;
	_tracePopDone(msg: string): void;
	_tracePopError(msg: string): void;
};

//#endregion
