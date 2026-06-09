import { TopState } from 'ihsm';

import { StateRef } from './discover';
import { getInitialState, getStateName, hasInitialState } from './ihsm-runtime';
import { AnyStateClass } from './types';

/** Serializable LCA transition plan — mirrors `createTransition` in `dispatch.production.ts`. */
export interface TransitionPlan {
	readonly key: string;
	readonly from: StateRef;
	readonly to: StateRef;
	readonly exit: StateRef[];
	readonly entry: StateRef[];
	readonly finalState?: StateRef;
	readonly selfTransition: boolean;
}

function parentStateClass(state: AnyStateClass): AnyStateClass | null {
	const parentProto = Object.getPrototypeOf(state.prototype) as object | null;
	if (parentProto === null) {
		return null;
	}
	return parentProto.constructor as AnyStateClass;
}

function transitionKey(from: StateRef, to: StateRef): string {
	return `${from.exportName}=>${to.exportName}`;
}

function refFor(state: AnyStateClass, refsByClass: Map<AnyStateClass, StateRef>): StateRef {
	const found = refsByClass.get(state);
	if (found !== undefined) {
		return found;
	}
	return { exportName: getStateName(state), state };
}

/**
 * Compute the exit/entry path for one `from → to` pair using the same algorithm as the runtime.
 *
 * @param refsByClass - optional map for stable export names in generated output
 */
export function planTransition(
	from: StateRef,
	to: StateRef,
	refsByClass?: Map<AnyStateClass, StateRef>
): TransitionPlan {
	const lookup = refsByClass ?? new Map<AnyStateClass, StateRef>([
		[from.state, from],
		[to.state, to],
	]);

	const srcState = from.state;
	let dstState = to.state;
	let srcPath: AnyStateClass[] = [];
	const end: AnyStateClass = TopState;
	const srcIndex = new Map<AnyStateClass, number>();
	let dstPath: AnyStateClass[] = [];
	let cur: AnyStateClass | null = srcState;
	let i = 0;

	while (cur !== null && cur !== end) {
		srcPath.push(cur);
		srcIndex.set(cur, i);
		cur = parentStateClass(cur);
		++i;
	}
	cur = dstState;

	while (cur !== null && cur !== end) {
		const index = srcIndex.get(cur);
		if (index !== undefined) {
			srcPath = srcPath.slice(0, index);
			break;
		}
		dstPath.unshift(cur);
		cur = parentStateClass(cur);
	}

	while (hasInitialState(dstState)) {
		dstState = getInitialState(dstState);
		dstPath.push(dstState);
	}

	let finalStateClass: AnyStateClass | undefined;
	if (dstPath.length !== 0) {
		finalStateClass = dstPath[dstPath.length - 1];
	} else if (srcPath.length !== 0) {
		finalStateClass = parentStateClass(srcPath[srcPath.length - 1]) ?? undefined;
	} else {
		finalStateClass = undefined;
	}

	// Match dispatch.production.ts — filters on the state *constructor*.
	srcPath = srcPath.filter(value => !value.hasOwnProperty('onExit'));
	dstPath = dstPath.filter(value => !value.hasOwnProperty('onEntry'));

	const exit = srcPath.map(state => refFor(state, lookup));
	const entry = dstPath.map(state => refFor(state, lookup));
	const finalState = finalStateClass !== undefined ? refFor(finalStateClass, lookup) : undefined;
	const selfTransition = exit.length === 0 && entry.length === 0 && finalState === undefined;

	return {
		key: transitionKey(from, to),
		from,
		to,
		exit,
		entry,
		finalState,
		selfTransition,
	};
}

/** Cartesian product of every `from × to` state pair under the machine root. */
export function planCartesianTransitions(states: StateRef[]): TransitionPlan[] {
	const refsByClass = new Map(states.map(ref => [ref.state, ref] as const));
	const plans: TransitionPlan[] = [];
	for (const from of states) {
		for (const to of states) {
			plans.push(planTransition(from, to, refsByClass));
		}
	}
	return plans;
}
