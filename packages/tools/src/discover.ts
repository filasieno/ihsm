import { TopState } from 'ihsm';

import { AnyStateClass } from './types';

/** A state class with the export name used in generated import statements. */
export interface StateRef {
	readonly exportName: string;
	readonly state: AnyStateClass;
}

/** Returns true when `value` looks like an ihsm state class constructor. */
export function isStateClass(value: unknown): value is AnyStateClass {
	return typeof value === 'function' && typeof value.prototype === 'object' && value.prototype !== null;
}

/**
 * True when `state` is `topState` or a descendant on the class prototype chain
 * (stops at {@link TopState}, never walks into `State` / `Object`).
 */
export function isDescendantStateClass(state: AnyStateClass, topState: AnyStateClass): boolean {
	let cur: AnyStateClass | null = state;
	while (cur !== null) {
		if (cur === topState) {
			return true;
		}
		if (cur === TopState) {
			return false;
		}
		const parentProto = Object.getPrototypeOf(cur.prototype) as object | null;
		cur = parentProto !== null ? (parentProto.constructor as AnyStateClass) : null;
	}
	return false;
}

/** Collect every state class under `topState` from an exports object (same pattern as `registerStateNames`). */
export function collectStatesFromExports(topState: AnyStateClass, exports: Record<string, unknown>): StateRef[] {
	const refs: StateRef[] = [];
	for (const [exportName, value] of Object.entries(exports)) {
		if (!isStateClass(value)) {
			continue;
		}
		if (!isDescendantStateClass(value, topState)) {
			continue;
		}
		refs.push({ exportName, state: value });
	}
	return sortStateRefs(refs);
}

/** Filter an explicit list of candidates to states under `topState`. */
export function collectStates(topState: AnyStateClass, candidates: AnyStateClass[]): StateRef[] {
	const refs: StateRef[] = [];
	for (const state of candidates) {
		if (!isDescendantStateClass(state, topState)) {
			continue;
		}
		refs.push({ exportName: state.name, state });
	}
	return sortStateRefs(refs);
}

/** Resolve state list from explicit refs or an exports namespace. */
export function resolveStates(
	topState: AnyStateClass,
	options: { states?: AnyStateClass[]; exports?: Record<string, unknown> }
): StateRef[] {
	if (options.exports !== undefined) {
		return collectStatesFromExports(topState, options.exports);
	}
	if (options.states !== undefined) {
		return collectStates(topState, options.states);
	}
	throw new Error('@ihsm/tools: provide either `states` or `exports` to enumerate machine states');
}

function sortStateRefs(refs: StateRef[]): StateRef[] {
	return [...refs].sort((a, b) => a.exportName.localeCompare(b.exportName));
}
