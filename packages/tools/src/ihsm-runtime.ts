import { AnyStateClass } from './types';

/** Mirrors `ihsm` internal utils used by `dispatch.production.ts`. */
export function getInitialState(state: AnyStateClass): AnyStateClass {
	return (state as unknown as { _initialState: AnyStateClass })._initialState;
}

export function hasInitialState(state: AnyStateClass): boolean {
	return Object.prototype.hasOwnProperty.call(state, '_initialState');
}

export function getStateName(state: AnyStateClass): string {
	if (Object.prototype.hasOwnProperty.call(state, '_stateName')) {
		return (state as unknown as { _stateName: string })._stateName;
	}
	return state.name;
}
