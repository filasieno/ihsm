/// <reference types="node" />
import { TraceLevel } from '../';

import { SelfCallDeadlockError } from './errors';
import type { DispatchableMachine } from './handles';

type DispatchToken = { machine: DispatchableMachine };

type AsyncLocalStorageCtor = new <T>() => {
	run<R>(store: T, fn: () => R): R;
	getStore(): T | undefined;
};

let dispatchStorage: InstanceType<AsyncLocalStorageCtor> | null | undefined;

/** @internal Test hook — reset lazy ALS initialization between specs. */
export function __testOnlyResetDispatchStorage(): void {
	dispatchStorage = undefined;
}

/** @internal Test hook — simulate environments where `node:async_hooks` is unavailable. */
export function __testOnlyDisableDispatchStorage(): void {
	dispatchStorage = null;
}

function nodeAsyncLocalStorage(): InstanceType<AsyncLocalStorageCtor> | undefined {
	if (dispatchStorage !== undefined) {
		return dispatchStorage ?? undefined;
	}
	if (typeof process === 'undefined' || process.versions?.node === undefined) {
		dispatchStorage = null;
		return undefined;
	}
	try {
		// Dynamic require — no unconditional `node:async_hooks` import (browser-safe bundle).
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const hooks = require('node:async_hooks') as { AsyncLocalStorage: AsyncLocalStorageCtor };
		dispatchStorage = new hooks.AsyncLocalStorage<DispatchToken>();
		return dispatchStorage;
	} catch {
		dispatchStorage = null;
		return undefined;
	}
}

export function assertNoSelfServiceDeadlock(
	machine: DispatchableMachine,
	traceLevel: TraceLevel,
): void {
	if (traceLevel === TraceLevel.PRODUCTION) {
		return;
	}
	const storage = nodeAsyncLocalStorage();
	const token = storage?.getStore() as DispatchToken | undefined;
	if (token?.machine === machine) {
		throw new SelfCallDeadlockError();
	}
}

export function runInsideDispatch<R>(
	machine: DispatchableMachine,
	traceLevel: TraceLevel,
	fn: () => R | Promise<R>,
): R | Promise<R> {
	if (traceLevel === TraceLevel.PRODUCTION) {
		return fn();
	}
	const storage = nodeAsyncLocalStorage();
	if (storage === undefined) {
		return fn();
	}
	return storage.run({ machine }, fn);
}
