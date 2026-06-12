import {
	defaultDispatchErrorCallback,
	defaultInitialize,
	defaultTraceWriter,
	DispatchErrorCallback,
	Port,
	PortHandle,
	StateClass,
	TraceLevel,
	TraceWriter,
} from '../';

import { buildProtocolIndex, ProtocolBucketManifest } from './protocol-index';
import { V2Machine } from './machine';
import { RuntimeTransitionResolver, TransitionResolver } from './transition-resolver';
import type { Actor, Config, ConfigContext, ConfigPort, DisjointConfig, InternalActor, OwnerActor, TopStateArg } from './types';

export interface ActorOptions<C extends Config> {
	initialize?: boolean;
	traceLevel?: TraceLevel;
	traceWriter?: TraceWriter;
	dispatchErrorCallback?: DispatchErrorCallback<ConfigContext<C>>;
	transitions?: TransitionResolver<ConfigContext<C>, Record<string, unknown>>;
}

function manifestOf<C extends Config>(topState: TopStateArg<C>): ProtocolBucketManifest<C> {
	const manifest = topState.manifest;
	if (manifest === undefined) {
		throw new Error(`ihsm: ${topState.name || 'TopState'} is missing static readonly manifest`);
	}
	return manifest;
}

function instantiate<C extends Config>(
	topState: TopStateArg<C>,
	ctx: ConfigContext<C>,
	width: 'actor' | 'internal' | 'owner',
	port: PortHandle<C> | undefined,
	options: ActorOptions<C>,
): V2Machine<C> {
	const {
		initialize = defaultInitialize,
		traceLevel = TraceLevel.DEBUG,
		traceWriter = defaultTraceWriter,
		dispatchErrorCallback = defaultDispatchErrorCallback as DispatchErrorCallback<ConfigContext<C>>,
		transitions,
	} = options;
	const protocolIndex = buildProtocolIndex(topState, manifestOf(topState));
	const instance: { ctx: ConfigContext<C>; hsm: never; portRef?: unknown } = {
		ctx,
		hsm: undefined as never,
	};
	Object.setPrototypeOf(instance, topState.prototype);
	const machine = new V2Machine(
		topState as StateClass<ConfigContext<C>, Record<string, unknown>>,
		instance,
		protocolIndex,
		traceWriter,
		traceLevel,
		dispatchErrorCallback,
		initialize,
		transitions ?? new RuntimeTransitionResolver(),
	);
	const boundPort = (port ?? new Port()) as PortHandle<C>;
	boundPort.actor = machine.createActorHandleFor(width === 'actor' ? 'internal' : width) as InternalActor<C>;
	instance.portRef = boundPort;
	return machine;
}

/** Production black-box — public protocol only (generated handle). */
export function makeActor<C extends Config>(
	topState: TopStateArg<C>,
	ctx: ConfigContext<C>,
	port: PortHandle<C>,
	options: ActorOptions<C> = {},
	..._disjointGuard: DisjointConfig<C> extends true ? [] : [error: DisjointConfig<C>]
): Actor<C> {
	const machine = instantiate(topState, ctx, 'actor', port, options);
	return machine.createActorHandleFor('actor') as Actor<C>;
}

/** Supervisors / port wiring — adds internalNotifications on the same handle. */
export function makeInternalActor<C extends Config>(
	topState: TopStateArg<C>,
	ctx: ConfigContext<C>,
	port: PortHandle<C>,
	options: ActorOptions<C> = {},
	..._disjointGuard: DisjointConfig<C> extends true ? [] : [error: DisjointConfig<C>]
): InternalActor<C> {
	const machine = instantiate(topState, ctx, 'internal', port, options);
	return machine.createActorHandleFor('internal') as InternalActor<C>;
}

/** Parent owns child — adds internalServices (composition only). */
export function makeOwnerActor<C extends Config>(
	topState: TopStateArg<C>,
	ctx: ConfigContext<C>,
	port: PortHandle<C>,
	options: ActorOptions<C> = {},
	..._disjointGuard: DisjointConfig<C> extends true ? [] : [error: DisjointConfig<C>]
): OwnerActor<C> {
	const machine = instantiate(topState, ctx, 'owner', port, options);
	return machine.createActorHandleFor('owner') as OwnerActor<C>;
}

/** Alias for {@link makeOwnerActor}. */
export const makeHsm = makeOwnerActor;

export type V2ActorOptions<C extends Config> = ActorOptions<C>;

export const makeActorV2 = makeActor;
export const makeInternalActorV2 = makeInternalActor;
export const makeOwnerActorV2 = makeOwnerActor;
export const makeHsmV2 = makeHsm;
