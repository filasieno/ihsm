/** @internal */
import { StateClass } from '../';

/** @internal */
export function asError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

/** @internal */
export function quoteUnknown(err: unknown): string {
	return quoteError(asError(err));
}

/** @internal */
export function quoteError(err: Error): string {
	return `${err.name}${err.message ? `: ${err.message}` : ' with no error message'}`;
}

/** @internal */
export function getInitialState<Context, Protocol extends {} | undefined>(State: StateClass<Context, Protocol>): StateClass<Context, Protocol> {
	return (State as { [key: string]: any })._initialState as StateClass<Context, Protocol>;
}

/** @internal */
export function hasInitialState<Context, Protocol extends {} | undefined>(State: StateClass<Context, Protocol>): boolean {
	return Object.prototype.hasOwnProperty.call(State, '_initialState');
}

/** @internal */
export function getTransitionKey<Context, Protocol extends {} | undefined>(FromState: StateClass<Context, Protocol>, ToState: StateClass<Context, Protocol>): string {
	return `${getStateName(FromState)}=>${getStateName(ToState)}`;
}

/** @internal */
export function defineStateName<Context, Protocol extends {} | undefined>(state: StateClass<Context, Protocol>, displayName: string): void {
	Object.defineProperty(state, '_stateName', {
		value: displayName,
		writable: false,
		configurable: false,
		enumerable: false,
	});
}

/** @internal — prefers an own explicit name registered for minified browser bundles. */
export function getStateName<Context, Protocol extends {} | undefined>(state: StateClass<Context, Protocol>): string {
	if (Object.prototype.hasOwnProperty.call(state, '_stateName')) {
		return (state as unknown as { _stateName: string })._stateName;
	}
	return state.name;
}

/**
 * @internal Switch the instance prototype to `state` immediately before `onEntry`.
 * Invariants and `this.currentState` must reflect the entering state during the hook.
 */
export function adoptStateBeforeOnEntry<Context, Protocol extends {} | undefined>(hsm: { _instance: object; currentState: StateClass<Context, Protocol> }, state: StateClass<Context, Protocol>): void {
	hsm.currentState = state;
	const actual = Object.getPrototypeOf(hsm._instance).constructor;
	if (actual !== state) {
		throw new Error(`ihsm: prototype must be ${getStateName(state)} before onEntry, was ${getStateName(actual as StateClass<Context, Protocol>)}`);
	}
}
