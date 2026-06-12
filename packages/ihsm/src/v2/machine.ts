import { DispatchErrorCallback, StateClass, TraceLevel, TraceWriter } from '../';
import { HsmObject } from '../internal/hsm';

import { createV2InitTask, createV2NotificationTask, createV2ServiceTask } from './dispatch';
import { createActorHandle, createSelfNotifications, DispatchableMachine, HandleOwn, NotificationQueue } from './handles';
import type { ProtocolIndex } from './protocol-index';
import { RuntimeTransitionResolver, TransitionResolver } from './transition-resolver';
import type { ActorHsm, Config, ConfigContext, ConfigPort, HandleWidth, HandlerHsm, OwnerActorHsm, SelfNotifications } from './types';

const indexByRoot = new WeakMap<object, ProtocolIndex>();

export function cacheProtocolIndex(topState: object, index: ProtocolIndex): ProtocolIndex {
	indexByRoot.set(topState, index);
	return index;
}

export function protocolIndexFor(topState: object): ProtocolIndex | undefined {
	return indexByRoot.get(topState);
}

type V2Protocol = Record<string, unknown>;

export class V2Machine<C extends Config> extends HsmObject<ConfigContext<C>, V2Protocol> implements DispatchableMachine {
	readonly transitionResolver: TransitionResolver<ConfigContext<C>, V2Protocol>;
	private readonly protocolIndex: ProtocolIndex;
	private readonly handlerFacade: HandlerHsm<C>;
	private readonly selfActor: SelfNotifications<C>;
	private readonly selfImmediate: SelfNotifications<C>;
	private readonly actorFacades = new Map<HandleWidth, ActorHsm<C> | OwnerActorHsm<C>>();

	constructor(
		topState: StateClass<ConfigContext<C>, V2Protocol>,
		instance: { ctx: ConfigContext<C>; hsm: HandlerHsm<C>; portRef?: unknown },
		protocolIndex: ProtocolIndex,
		traceWriter: TraceWriter,
		traceLevel: TraceLevel,
		dispatchErrorCallback: DispatchErrorCallback<ConfigContext<C>>,
		initialize: boolean,
		transitionResolver?: TransitionResolver<ConfigContext<C>, V2Protocol>,
	) {
		super(topState, instance as never, traceWriter, traceLevel, dispatchErrorCallback, false);
		this.protocolIndex = protocolIndex;
		cacheProtocolIndex(topState, protocolIndex);
		this.transitionResolver = transitionResolver ?? new RuntimeTransitionResolver();
		this.selfActor = createSelfNotifications(this, topState, protocolIndex, 'default') as SelfNotifications<C>;
		this.selfImmediate = createSelfNotifications(this, topState, protocolIndex, 'priority') as SelfNotifications<C>;
		this.handlerFacade = this.buildHandlerFacade(instance);
		instance.hsm = this.handlerFacade;
		if (initialize) {
			this.pushTask(createV2InitTask(this, this.transitionResolver));
		}
	}

	dispatchService(name: string, args: unknown[]): Promise<unknown> {
		this.recordObserverEvent(name, args);
		return new Promise<unknown>((resolve, reject) => {
			this.pushTask(createV2ServiceTask(this, this.transitionResolver, name, args, resolve, reject));
		});
	}

	dispatchNotification(name: string, args: unknown[], queue: NotificationQueue): void {
		this.recordObserverEvent(name, args);
		const task = createV2NotificationTask(this, this.transitionResolver, name, args);
		if (queue === 'priority') {
			this.pushHiPriorityTask(task);
		} else {
			this.pushTask(task);
		}
	}

	actorHsmFor(width: HandleWidth): ActorHsm<C> | OwnerActorHsm<C> {
		let facade = this.actorFacades.get(width);
		if (facade === undefined) {
			facade = this.buildActorHsm(width);
			this.actorFacades.set(width, facade);
		}
		return facade;
	}

	createActorHandleFor(width: HandleWidth): HandleOwn {
		return createActorHandle(this, this.topState, this.protocolIndex, width);
	}

	private scheduleNotification(ms: number, name: string, args: unknown[]): void {
		const enqueue = (): void => {
			this.dispatchNotification(name, args, 'default');
		};
		const port = this._instance.portRef as { setTimeout?: (callback: () => void, delay?: number) => unknown } | undefined;
		if (port !== undefined && typeof port.setTimeout === 'function') {
			port.setTimeout(enqueue, ms);
		} else {
			setTimeout(enqueue, Math.max(0, ms));
		}
	}

	private buildHandlerFacade(instance: { portRef?: unknown }): HandlerHsm<C> {
		const machine = this;
		const facade: HandlerHsm<C> = {
			transition: next => machine.transition(next),
			actor: this.selfActor,
			immediate: this.selfImmediate,
			defer: (ms: number) => machine.createDeferredSelfNotifications(ms),
			get port(): ConfigPort<C> {
				return instance.portRef as ConfigPort<C>;
			},
			unhandled: () => machine.unhandled(),
			sleep: ms => machine.sleep(ms),
			get eventName(): string {
				return machine.eventName;
			},
			get eventPayload(): unknown[] {
				return machine.eventPayload;
			},
			get currentState(): StateClass<ConfigContext<C>, object> {
				return machine.currentState as StateClass<ConfigContext<C>, object>;
			},
			get currentStateName(): string {
				return machine.currentStateName;
			},
			get topState(): StateClass<ConfigContext<C>, object> {
				return machine.topState as StateClass<ConfigContext<C>, object>;
			},
			get topStateName(): string {
				return machine.topStateName;
			},
			get ctxTypeName(): string {
				return machine.ctxTypeName;
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
				machine.dispatchErrorCallback = cb as DispatchErrorCallback<ConfigContext<C>>;
			},
		};
		return facade;
	}

	private createDeferredSelfNotifications(ms: number): SelfNotifications<C> {
		const machine = this;
		const proto: Record<string, Function> = Object.create(null);
		for (const [name, slot] of this.protocolIndex.entries('internal')) {
			if (slot.bucket === 'notifications' || slot.bucket === 'internalNotifications') {
				proto[name] = (...args: unknown[]): void => {
					machine.scheduleNotification(ms, name, args);
				};
			}
		}
		for (const [name, slot] of this.protocolIndex.entries('actor')) {
			if (slot.bucket === 'notifications') {
				proto[name] = (...args: unknown[]): void => {
					machine.scheduleNotification(ms, name, args);
				};
			}
		}
		return Object.create(Object.freeze(proto)) as SelfNotifications<C>;
	}

	private buildActorHsm(width: HandleWidth): ActorHsm<C> | OwnerActorHsm<C> {
		const machine = this;
		if (width === 'actor') {
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
			} as ActorHsm<C>;
		}
		if (width === 'internal') {
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
				get currentState(): StateClass<ConfigContext<C>, object> {
					return machine.currentState as StateClass<ConfigContext<C>, object>;
				},
				get topState(): StateClass<ConfigContext<C>, object> {
					return machine.topState as StateClass<ConfigContext<C>, object>;
				},
			} as ActorHsm<C>;
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
			get currentState(): StateClass<ConfigContext<C>, object> {
				return machine.currentState as StateClass<ConfigContext<C>, object>;
			},
			get topState(): StateClass<ConfigContext<C>, object> {
				return machine.topState as StateClass<ConfigContext<C>, object>;
			},
			restore: (state: StateClass<ConfigContext<C>, object>, ctx: ConfigContext<C>) => machine.restore(state as never, ctx),
			get dispatchErrorCallback(): (hsm: unknown, err: Error) => void {
				return machine.dispatchErrorCallback as (hsm: unknown, err: Error) => void;
			},
			set dispatchErrorCallback(cb: (hsm: unknown, err: Error) => void) {
				machine.dispatchErrorCallback = cb as DispatchErrorCallback<ConfigContext<C>>;
			},
		} as OwnerActorHsm<C>;
	}
}
