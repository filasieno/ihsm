/** Deterministic actor identity (CORE-A) — UUIDv5 over `(runNamespace, path)` with zero npm deps. */

import type { ActorIdentity, EmbodimentKind } from './types';

/** Fixed ihsm namespace for run-scoped UUID derivation. */
export const IHSM_IDENTITY_NAMESPACE = 'a3f2c8e1-4b9d-4e7a-9c1f-2d6e8b0a4f3c';

let runSeed: string = defaultRunSeed();
let runNamespace: string | undefined;

function defaultRunSeed(): string {
	if (typeof process !== 'undefined' && typeof process.env?.IHSM_RUN_SEED === 'string' && process.env.IHSM_RUN_SEED.length > 0) {
		return process.env.IHSM_RUN_SEED;
	}
	return globalThis.crypto.randomUUID();
}

/** Set the run seed for deterministic actor UUIDs (DST harness). */
export function configureRunSeed(seed: string): void {
	runSeed = seed;
	runNamespace = undefined;
}

/** Current run seed. */
export function getRunSeed(): string {
	return runSeed;
}

/** Lazily computed `uuidv5(IHSM_IDENTITY_NAMESPACE, runSeed)`. */
export function getRunNamespace(): string {
	if (runNamespace === undefined) {
		runNamespace = uuidV5(runSeed, IHSM_IDENTITY_NAMESPACE);
	}
	return runNamespace;
}

export function actorNameFromTopState(topStateName: string): string {
	return topStateName.endsWith('Top') ? topStateName.slice(0, -3) : topStateName;
}

export function mintActorIdentity(kind: EmbodimentKind, path: string, parentUuid?: string): ActorIdentity {
	const identity: ActorIdentity = {
		uuid: uuidV5(path, getRunNamespace()),
		name:
			path
				.split('/')
				.pop()
				?.replace(/\[\d+\]$/, '') ?? path,
		path,
		kind,
	};
	if (parentUuid !== undefined) {
		return { ...identity, parentUuid };
	}
	return identity;
}

export function rootActorPath(topStateName: string): string {
	return actorNameFromTopState(topStateName);
}

export function childActorPath(parentPath: string, childTopName: string, spawnIndex: number): string {
	const childName: string = actorNameFromTopState(childTopName);
	return `${parentPath}/${childName}[${spawnIndex}]`;
}

function uuidV5(name: string, namespaceUuid: string): string {
	const namespaceBytes: Uint8Array = parseUuidToBytes(namespaceUuid);
	const nameBytes: Uint8Array = new TextEncoder().encode(name);
	const payload: Uint8Array = new Uint8Array(namespaceBytes.length + nameBytes.length);
	payload.set(namespaceBytes, 0);
	payload.set(nameBytes, namespaceBytes.length);
	const hash: Uint8Array = sha1Sync(payload);
	hash[6] = (hash[6]! & 0x0f) | 0x50;
	hash[8] = (hash[8]! & 0x3f) | 0x80;
	return formatUuid(hash.subarray(0, 16));
}

function parseUuidToBytes(uuid: string): Uint8Array {
	const hex: string = uuid.replace(/-/g, '');
	const out: Uint8Array = new Uint8Array(16);
	for (let i: number = 0; i < 16; ++i) {
		out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	}
	return out;
}

function formatUuid(bytes: Uint8Array): string {
	const hex: string = [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function sha1Sync(data: Uint8Array): Uint8Array {
	if (typeof process !== 'undefined' && process.versions?.node !== undefined) {
		try {
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const crypto = require('node:crypto') as typeof import('node:crypto');
			return new Uint8Array(crypto.createHash('sha1').update(data).digest());
		} catch {
			/* fall through */
		}
	}
	return sha1Pure(data);
}

/** Minimal SHA-1 for browser-side identity minting (sync). @internal exported for test hooks. */
export function sha1Pure(data: Uint8Array): Uint8Array {
	const w: number[] = new Array<number>(80).fill(0);
	let h0: number = 0x67452301;
	let h1: number = 0xefcdab89;
	let h2: number = 0x98badcfe;
	let h3: number = 0x10325476;
	let h4: number = 0xc3d2e1f0;
	const ml: number = data.length * 8;
	const withLen: Uint8Array = new Uint8Array(((data.length + 9 + 63) >> 6) << 6);
	withLen.set(data);
	withLen[data.length] = 0x80;
	const view: DataView = new DataView(withLen.buffer);
	view.setUint32(withLen.length - 4, ml >>> 0, false);
	for (let offset: number = 0; offset < withLen.length; offset += 64) {
		for (let i: number = 0; i < 16; ++i) {
			w[i] = view.getUint32(offset + i * 4, false);
		}
		for (let i: number = 16; i < 80; ++i) {
			w[i] = rotl(w[i - 3]! ^ w[i - 8]! ^ w[i - 14]! ^ w[i - 16]!, 1);
		}
		let a: number = h0;
		let b: number = h1;
		let c: number = h2;
		let d: number = h3;
		let e: number = h4;
		for (let i: number = 0; i < 80; ++i) {
			let f: number;
			let k: number;
			if (i < 20) {
				f = (b & c) | (~b & d);
				k = 0x5a827999;
			} else if (i < 40) {
				f = b ^ c ^ d;
				k = 0x6ed9eba1;
			} else if (i < 60) {
				f = (b & c) | (b & d) | (c & d);
				k = 0x8f1bbcdc;
			} else {
				f = b ^ c ^ d;
				k = 0xca62c1d6;
			}
			const temp: number = (rotl(a, 5) + f + e + k + w[i]!) >>> 0;
			e = d;
			d = c;
			c = rotl(b, 30);
			b = a;
			a = temp;
		}
		h0 = (h0 + a) >>> 0;
		h1 = (h1 + b) >>> 0;
		h2 = (h2 + c) >>> 0;
		h3 = (h3 + d) >>> 0;
		h4 = (h4 + e) >>> 0;
	}
	const out: Uint8Array = new Uint8Array(20);
	const outView: DataView = new DataView(out.buffer);
	outView.setUint32(0, h0, false);
	outView.setUint32(4, h1, false);
	outView.setUint32(8, h2, false);
	outView.setUint32(12, h3, false);
	outView.setUint32(16, h4, false);
	return out;
}

function rotl(x: number, n: number): number {
	return ((x << n) | (x >>> (32 - n))) >>> 0;
}
