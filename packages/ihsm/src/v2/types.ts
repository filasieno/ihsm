import type { Any, TraceLevel, TraceWriter } from '../';
import type { ProtocolBucketManifest } from './protocol-index';

/** State class constructor reference used by machinery facades. */
export type StateClassRef<Context = Any, Protocol extends object = Record<string, unknown>> = Function & {
	prototype: object;
};

/** Single configuration bag for a machine (v2). */
export interface Config {
	context?: object;
	services?: object;
	notifications?: object;
	internalServices?: object;
	internalNotifications?: object;
	port?: object;
}

/** Full `Config` bag carried on `TopState<C>` / `prototype.__ihsm`. */
export type ConfigOf<T> = T extends { readonly __ihsm: infer C extends Config } ? C : {};

export type ConfigContext<C extends Config> = C extends { context: infer Context } ? Context : Any;

export type ConfigServices<C extends Config> = C extends { services: infer S extends object } ? S : {};

export type ConfigNotifications<C extends Config> = C extends { notifications: infer N extends object } ? N : {};

export type ConfigInternalServices<C extends Config> = C extends { internalServices: infer S extends object } ? S : {};

export type ConfigInternalNotifications<C extends Config> = C extends { internalNotifications: infer N extends object } ? N : {};

export type ConfigPort<C extends Config> = C extends { port: infer P } ? P : undefined;

export type ServiceClient<S extends object> = {
	[K in keyof S]: S[K] extends (...args: infer A) => Promise<infer R> ? (...args: A) => Promise<R> : never;
};

export type NotificationClient<N extends object> = {
	[K in keyof N]: N[K] extends (...args: infer A) => void | Promise<void> ? (...args: A) => void : never;
};

export type ActorCore<C extends Config> = {
	ctx: ConfigContext<C>;
	hsm: ActorHsm<C>;
};

export type Actor<C extends Config> = ActorCore<C> & ServiceClient<ConfigServices<C>> & NotificationClient<ConfigNotifications<C>>;

export type InternalActor<C extends Config> = Actor<C> & NotificationClient<ConfigInternalNotifications<C>>;

export type OwnerActor<C extends Config> = InternalActor<C> & ServiceClient<ConfigInternalServices<C>>;

export type SelfNotifications<C extends Config> = NotificationClient<ConfigNotifications<C>> & NotificationClient<ConfigInternalNotifications<C>>;

export type HandlerHsm<C extends Config> = {
	transition(next: StateClassRef<ConfigContext<C>>): void;
	actor: SelfNotifications<C>;
	immediate: SelfNotifications<C>;
	defer(ms: number): SelfNotifications<C>;
	port: ConfigPort<C>;
	unhandled(): never;
	sleep(ms: number): Promise<void>;
	eventName: string;
	eventPayload: unknown[];
	currentState: StateClassRef<ConfigContext<C>>;
	currentStateName: string;
	topState: StateClassRef<ConfigContext<C>>;
	topStateName: string;
	ctxTypeName: string;
	traceHeader: string;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	dispatchErrorCallback: (hsm: unknown, err: Error) => void;
};

export type ActorHsm<C extends Config> = {
	sync(): Promise<void>;
	currentStateName: string;
	topStateName: string;
	traceLevel: TraceLevel;
	traceWriter: TraceWriter;
	traceHeader: string;
};

export type TestActorHsm<C extends Config> = ActorHsm<C> & {
	currentState: StateClassRef<ConfigContext<C>>;
	topState: StateClassRef<ConfigContext<C>>;
};

export type OwnerActorHsm<C extends Config> = TestActorHsm<C> & {
	restore(state: StateClassRef<ConfigContext<C>>, ctx: ConfigContext<C>): void;
	dispatchErrorCallback: (hsm: unknown, err: Error) => void;
};

export type TestOwnerActorHsm<C extends Config> = OwnerActorHsm<C> & {
	port: ConfigPort<C>;
	subscribe(observer: (message: { event: string; payload: unknown[] }) => void): { dispose(): void };
};

export const ReservedNames = ['ctx', 'hsm', 'onEntry', 'onExit', 'onError', 'onUnhandled'] as const;

export type ReservedName = (typeof ReservedNames)[number];

export type IsReservedName<K extends PropertyKey> = K extends ReservedName ? true : false;

export type FilterReservedKeys<O extends object> = {
	[K in keyof O as IsReservedName<K> extends true ? never : K]: O[K];
};

export type ServiceHandler<Reply> = Reply | Promise<Reply>;

export type NotificationHandler = void | Promise<void>;

export type AssertAsyncService<M> = M extends (...args: never[]) => infer R
	? R extends Promise<unknown>
		? M
		: ['ihsm: service Config members must return Promise<Reply>', M]
	: M;

export type ServiceArgs<S extends object, K extends keyof S> = S[K] extends (...args: infer A) => Promise<unknown> ? A : never;

export type ServiceReply<S extends object, K extends keyof S> = S[K] extends (...args: never[]) => Promise<infer R> ? Awaited<R> : never;

export type NotificationArgs<N extends object, K extends keyof N> = N[K] extends (...args: infer A) => void | Promise<void> ? A : never;

type ProtocolFieldKeys<C extends Config> =
	| keyof ConfigServices<C>
	| keyof ConfigNotifications<C>
	| keyof ConfigInternalServices<C>
	| keyof ConfigInternalNotifications<C>;

type OverlappingConfigKeys<C extends Config> = Extract<
	keyof ConfigServices<C> & keyof ConfigNotifications<C>,
	PropertyKey
> extends never
	? Extract<keyof ConfigServices<C> & keyof ConfigInternalServices<C>, PropertyKey> extends never
		? Extract<keyof ConfigServices<C> & keyof ConfigInternalNotifications<C>, PropertyKey> extends never
			? Extract<keyof ConfigNotifications<C> & keyof ConfigInternalServices<C>, PropertyKey> extends never
				? Extract<keyof ConfigNotifications<C> & keyof ConfigInternalNotifications<C>, PropertyKey> extends never
					? Extract<keyof ConfigInternalServices<C> & keyof ConfigInternalNotifications<C>, PropertyKey> extends never
						? Extract<ProtocolFieldKeys<C>, ReservedName> extends never
							? true
							: ['ihsm: Config protocol keys must not use reserved names', Extract<ProtocolFieldKeys<C>, ReservedName>]
						: ['ihsm: internalServices and internalNotifications share keys', Extract<keyof ConfigInternalServices<C> & keyof ConfigInternalNotifications<C>, PropertyKey>]
					: ['ihsm: notifications and internalNotifications share keys', Extract<keyof ConfigNotifications<C> & keyof ConfigInternalNotifications<C>, PropertyKey>]
				: ['ihsm: notifications and internalServices share keys', Extract<keyof ConfigNotifications<C> & keyof ConfigInternalServices<C>, PropertyKey>]
			: ['ihsm: services and internalNotifications share keys', Extract<keyof ConfigServices<C> & keyof ConfigInternalNotifications<C>, PropertyKey>]
		: ['ihsm: services and internalServices share keys', Extract<keyof ConfigServices<C> & keyof ConfigInternalServices<C>, PropertyKey>]
	: ['ihsm: services and notifications share keys', Extract<keyof ConfigServices<C> & keyof ConfigNotifications<C>, PropertyKey>];

/** Compile-time pairwise disjointness across the four protocol fields + `ReservedNames`. */
export type DisjointConfig<C extends Config> = OverlappingConfigKeys<C>;

export type StateClassOf<C extends Config = Config> = Function & {
	prototype: { readonly __ihsm: C };
	readonly manifest: ProtocolBucketManifest<C>;
};

export type TopStateArg<C extends Config = Config> = StateClassOf<C>;

export type ProtocolBucket = 'services' | 'notifications' | 'internalServices' | 'internalNotifications';

export type HandleWidth = 'actor' | 'internal' | 'owner';
