import { Base, TraceLevel } from '../';
import { registerStateNamesFromExports } from '../../tutorials/shared/state-names';

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

let lastError: Error | undefined = undefined;

export function createTestDispatchErrorCallback(eatError = false) {
	return <Context, Protocol extends {} | undefined>(hsm: Base<Context, Protocol>, err: Error): void => {
		console.log(`
// -------------------------------------------------------------------------------------------------------
// The following error has escaped the dispatch (eat error = ${eatError})
// -------------------------------------------------------------------------------------------------------
`);
		hsm.traceWriter.write(hsm, err);
		lastError = err;
		if (!eatError) throw err;
	};
}

export function getLastError(): Error | undefined {
	return lastError;
}

export function clearLastError(): void {
	lastError = undefined;
}
