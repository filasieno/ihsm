import { StateRef } from './discover';
import { TransitionPlan } from './plan';
import { AnyStateClass } from './types';

type LifecycleHook = 'onEntry' | 'onExit';

/** True when the state class defines `hook` as an `async` method on its prototype. */
export function lifecycleHookIsAsync(state: AnyStateClass, hook: LifecycleHook): boolean {
	const proto = state.prototype as Record<string, unknown>;
	if (!Object.prototype.hasOwnProperty.call(proto, hook)) {
		return false;
	}
	const fn = proto[hook];
	return typeof fn === 'function' && fn.constructor.name === 'AsyncFunction';
}

/** True when any exit/entry hook on the planned path is an `async` method. */
export function planNeedsAsync(plan: TransitionPlan): boolean {
	for (const ref of plan.exit) {
		if (lifecycleHookIsAsync(ref.state, 'onExit')) {
			return true;
		}
	}
	for (const ref of plan.entry) {
		if (lifecycleHookIsAsync(ref.state, 'onEntry')) {
			return true;
		}
	}
	return false;
}

/** States whose lifecycle hooks run during this transition (for metadata). */
export function planLifecycleStates(plan: TransitionPlan): { exit: StateRef[]; entry: StateRef[] } {
	return { exit: plan.exit, entry: plan.entry };
}
