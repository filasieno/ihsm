import { StateClass, TopState } from '../';

import { getStateName } from '../internal/utils';

const graphByRoot = new WeakMap<StateClass, Set<StateClass>>();

function findRootState(state: StateClass): StateClass {
	let current: StateClass = state;
	let manifestRoot: StateClass | undefined;
	while (true) {
		if (Object.hasOwn(current, 'manifest') && (current as { manifest?: unknown }).manifest !== undefined) {
			manifestRoot = current;
		}
		const parent = Object.getPrototypeOf(current) as StateClass;
		if (parent === TopState || parent.prototype === TopState.prototype) {
			return manifestRoot ?? current;
		}
		current = parent;
	}
}

/** Register a state class for protocol scanning (called from {@link registerStateNames}). */
export function registerStateInGraph(state: StateClass): void {
	const root = findRootState(state);
	let graph = graphByRoot.get(root);
	if (graph === undefined) {
		graph = new Set();
		graphByRoot.set(root, graph);
	}
	graph.add(state);
}

export function collectStateClasses(topState: StateClass): StateClass[] {
	const graph = graphByRoot.get(topState);
	if (graph !== undefined && graph.size > 0) {
		return [...graph];
	}
	const collected = new Set<StateClass>();
	let current: StateClass | undefined = topState;
	while (current !== undefined && current !== TopState) {
		collected.add(current);
		current = Object.getPrototypeOf(current) as StateClass;
		if (current === TopState) break;
	}
	return [...collected];
}

export function stateDisplayName(state: StateClass): string {
	return getStateName(state);
}
