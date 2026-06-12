import type { ProtocolIndex } from './protocol-index';
import type { Config, HandleWidth } from './types';

export const kMachine = Symbol('ihsm.machine');

export interface DispatchableMachine {
	dispatchService(name: string, args: unknown[]): Promise<unknown>;
	dispatchNotification(name: string, args: unknown[], queue: NotificationQueue): void;
	readonly ctx: unknown;
	actorHsmFor(width: HandleWidth): unknown;
}

export type NotificationQueue = 'default' | 'priority' | 'timer';

export interface HandleOwn extends Record<symbol | string, unknown> {
	[kMachine]: DispatchableMachine;
	ctx: unknown;
	hsm: unknown;
}

const protoCache = new WeakMap<object, Map<HandleWidth, object>>();

function protoCacheFor(topState: object): Map<HandleWidth, object> {
	let map = protoCache.get(topState);
	if (map === undefined) {
		map = new Map();
		protoCache.set(topState, map);
	}
	return map;
}

export function buildHandleProto(index: ProtocolIndex, width: HandleWidth): object {
	const proto: Record<string, Function> = Object.create(null);
	for (const [name, slot] of index.entries(width)) {
		if (slot.bucket === 'services' || slot.bucket === 'internalServices') {
			proto[name] = function (this: HandleOwn, ...args: unknown[]): Promise<unknown> {
				return this[kMachine].dispatchService(name, args);
			};
		} else {
			proto[name] = function (this: HandleOwn, ...args: unknown[]): void {
				this[kMachine].dispatchNotification(name, args, 'default');
			};
		}
	}
	return Object.freeze(proto);
}

export function getHandleProto(topState: object, index: ProtocolIndex, width: HandleWidth): object {
	const map = protoCacheFor(topState);
	let proto = map.get(width);
	if (proto === undefined) {
		proto = buildHandleProto(index, width);
		map.set(width, proto);
	}
	return proto;
}

export function createActorHandle<C extends Config>(
	machine: DispatchableMachine,
	topState: object,
	index: ProtocolIndex,
	width: HandleWidth,
): HandleOwn {
	const handle = Object.create(getHandleProto(topState, index, width)) as HandleOwn;
	Object.defineProperty(handle, kMachine, { value: machine, enumerable: false });
	Object.defineProperty(handle, 'ctx', {
		enumerable: true,
		get(): unknown {
			return machine.ctx;
		},
	});
	handle.hsm = machine.actorHsmFor(width);
	return handle;
}

export function buildSelfNotificationsProto(index: ProtocolIndex, queue: NotificationQueue): object {
	const proto: Record<string, Function> = Object.create(null);
	for (const [name, slot] of index.entries('internal')) {
		if (slot.bucket === 'notifications' || slot.bucket === 'internalNotifications') {
			proto[name] = function (this: HandleOwn, ...args: unknown[]): void {
				this[kMachine].dispatchNotification(name, args, queue);
			};
		}
	}
	for (const [name, slot] of index.entries('actor')) {
		if (slot.bucket === 'notifications') {
			proto[name] = function (this: HandleOwn, ...args: unknown[]): void {
				this[kMachine].dispatchNotification(name, args, queue);
			};
		}
	}
	return Object.freeze(proto);
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
		proto = buildSelfNotificationsProto(index, queue);
		map.set(queue, proto);
	}
	return proto;
}

export function createSelfNotifications(
	machine: DispatchableMachine,
	topState: object,
	index: ProtocolIndex,
	queue: NotificationQueue,
): HandleOwn {
	const handle = Object.create(getSelfNotificationsProto(topState, index, queue)) as HandleOwn;
	Object.defineProperty(handle, kMachine, { value: machine, enumerable: false });
	return handle;
}
