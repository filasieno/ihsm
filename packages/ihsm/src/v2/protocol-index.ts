import { StateClass } from '../';

import {
	protocolCollisionDuplicateKey,
	protocolCollisionMissingHandler,
	protocolCollisionReservedConfig,
	protocolCollisionReservedState,
} from './errors';
import { collectStateClasses, stateDisplayName } from './state-graph';
import type { Config, ProtocolBucket, ReservedName } from './types';
import { ReservedNames } from './types';

export interface ProtocolSlot {
	readonly bucket: ProtocolBucket;
	readonly name: string;
}

export interface ProtocolIndex {
	readonly slots: ReadonlyMap<string, ProtocolSlot>;
	get(name: string): ProtocolSlot | undefined;
	entries(width: import('./types').HandleWidth): Iterable<[string, ProtocolSlot]>;
}

export type ProtocolBucketManifest<C extends Config> = {
	readonly services: ReadonlyArray<string>;
	readonly notifications: ReadonlyArray<string>;
	readonly internalServices: ReadonlyArray<string>;
	readonly internalNotifications: ReadonlyArray<string>;
};

const reservedSet = new Set<string>(ReservedNames);
const lifecycleHooks = new Set<string>(['onEntry', 'onExit', 'onError', 'onUnhandled']);

function bucketForName(manifest: ProtocolBucketManifest<Config>, name: string): ProtocolBucket | undefined {
	if (manifest.services.includes(name)) return 'services';
	if (manifest.notifications.includes(name)) return 'notifications';
	if (manifest.internalServices.includes(name)) return 'internalServices';
	if (manifest.internalNotifications.includes(name)) return 'internalNotifications';
	return undefined;
}

function collectHandlerNames(state: StateClass): string[] {
	const names: string[] = [];
	const prototype = state.prototype as Record<string, unknown>;
	for (const name of Object.getOwnPropertyNames(prototype)) {
		if (reservedSet.has(name) || lifecycleHooks.has(name)) continue;
		if (name === 'constructor') continue;
		const value = prototype[name];
		if (typeof value === 'function') names.push(name);
	}
	return names;
}

function validateManifest(manifest: ProtocolBucketManifest<Config>): void {
	const seen = new Map<string, ProtocolBucket>();
	for (const bucket of ['services', 'notifications', 'internalServices', 'internalNotifications'] as const) {
		for (const name of manifest[bucket]) {
			if (reservedSet.has(name)) throw protocolCollisionReservedConfig(name as ReservedName);
			const prior = seen.get(name);
			if (prior !== undefined) throw protocolCollisionDuplicateKey(name);
			seen.set(name, bucket);
		}
	}
}

class ProtocolIndexImpl implements ProtocolIndex {
	readonly slots: ReadonlyMap<string, ProtocolSlot>;

	constructor(slots: ReadonlyMap<string, ProtocolSlot>) {
		this.slots = slots;
	}

	get(name: string): ProtocolSlot | undefined {
		return this.slots.get(name);
	}

	*entries(width: import('./types').HandleWidth): Iterable<[string, ProtocolSlot]> {
		for (const [name, slot] of this.slots) {
			if (width === 'actor' && (slot.bucket === 'services' || slot.bucket === 'notifications')) {
				yield [name, slot];
			} else if (width === 'internal' && slot.bucket !== 'internalServices') {
				yield [name, slot];
			} else if (width === 'owner') {
				yield [name, slot];
			}
		}
	}
}

export function buildProtocolIndex(topState: StateClass, manifest: ProtocolBucketManifest<Config>): ProtocolIndex {
	validateManifest(manifest);
	const handlersByName = new Map<string, string>();
	const states = collectStateClasses(topState);

	for (const state of states) {
		const prototype = state.prototype as Record<string, unknown>;
		for (const name of Object.getOwnPropertyNames(prototype)) {
			if (!reservedSet.has(name) || lifecycleHooks.has(name) || name === 'constructor') continue;
			if (typeof prototype[name] === 'function') {
				throw protocolCollisionReservedState(stateDisplayName(state), name as ReservedName);
			}
		}
		for (const name of collectHandlerNames(state)) {
			const prior = handlersByName.get(name);
			if (prior === undefined) handlersByName.set(name, stateDisplayName(state));
		}
	}

	const slots = new Map<string, ProtocolSlot>();

	for (const bucket of ['services', 'notifications', 'internalServices', 'internalNotifications'] as const) {
		for (const name of manifest[bucket]) {
			if (!handlersByName.has(name)) throw protocolCollisionMissingHandler(name);
			if (!slots.has(name)) slots.set(name, { bucket, name });
		}
	}

	return new ProtocolIndexImpl(slots);
}
