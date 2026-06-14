import { Disposable, EventObserver, Properties, TraceLevel, type ActorConfig } from '../';
import { kMachine } from '../internal/runtime';
import type { HandleOwn } from '../internal/runtime';
import { registerStateNamesFromExports } from '../../examples/shared/state-names';

export const TRACE_LEVELS: TraceLevel[] = [TraceLevel.VERBOSE_DEBUG, TraceLevel.DEBUG, TraceLevel.PRODUCTION];

declare global {
	var __IHSM_TEST_ENV__: 'browser-min' | undefined;
}

/** True when running inside the minified browser test bundle. */
export function isBrowserMinTestEnv(): boolean {
	return globalThis.__IHSM_TEST_ENV__ === 'browser-min';
}

/** Register export-key display names so specs pass when class names are minified. */
export function registerSpecStateNames(exports: Record<string, unknown>): void {
	registerStateNamesFromExports(exports);
}

const lastErrorBox: { value: Error | undefined } = { value: undefined };

export function createTestDispatchErrorCallback(eatError = false) {
	return <C extends ActorConfig>(hsm: Properties<C>, err: Error): void => {
		console.log(`
// -------------------------------------------------------------------------------------------------------
// The following error has escaped the dispatch (eat error = ${eatError})
// -------------------------------------------------------------------------------------------------------
`);
		hsm.traceWriter.write(hsm, err);
		lastErrorBox.value = err;
		if (!eatError) throw err;
	};
}

export function getLastError(): Error | undefined {
	return lastErrorBox.value;
}

export function clearLastError(): void {
	lastErrorBox.value = undefined;
}

/** Subscribe to a test actor and forward every event into a {@link TestPort} message log. */
export function traceActorOnPort(
	/** Generated actor handle (`TestActor`, …) — carries `kMachine` at runtime. */
	actor: object,
	port: { record(event: string, ...payload: unknown[]): void }
): Disposable {
	const subscribable = 'subscribe' in actor && typeof (actor as { subscribe?: unknown }).subscribe === 'function' ? (actor as { subscribe(observer: EventObserver): Disposable }) : ((actor as unknown as HandleOwn)[kMachine] as unknown as { subscribe(observer: EventObserver): Disposable });
	return subscribable.subscribe(message => port.record(message.event, ...message.payload));
}
