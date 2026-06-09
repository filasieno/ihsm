import { type State, type StateClass } from 'ihsm';
import { executeTransitionRoutine, planTransitionClasses, type TransitionRoutinePlan } from 'ihsm/transition-routines';

import { resolveStates } from '../discover';
import { planCartesianTransitions } from '../plan';
import type { AnyStateClass } from '../types';

export interface BuiltTransitionRoutine {
	readonly key: string;
	readonly plan: TransitionRoutinePlan;
	readonly from: StateClass<unknown, undefined>;
	readonly to: StateClass<unknown, undefined>;
	readonly run: (
		instance: object,
		setCurrentState: (state: StateClass<unknown, undefined>) => void,
		hsm: State<unknown, undefined>,
	) => Promise<void>;
}

/** Build in-memory transition routines mirroring generated `TRANSITION_ROUTINES`. */
export function buildTransitionRoutines(topState: AnyStateClass, exports: Record<string, unknown>): BuiltTransitionRoutine[] {
	const states = resolveStates(topState, { exports });
	const plans = planCartesianTransitions(states);

	return plans.map(plan => {
		const planned = planTransitionClasses(plan.from.state, plan.to.state);
		const routinePlan: TransitionRoutinePlan = {
			...planned,
			from: plan.from.state,
			to: plan.to.state,
		};
		return {
			key: plan.key,
			plan: routinePlan,
			from: plan.from.state,
			to: plan.to.state,
			run: async (instance, setCurrentState, hsm) => {
				await executeTransitionRoutine(hsm, instance, routinePlan, plan.from.state, plan.to.state, {
					style: 'production',
					setCurrentState,
				});
			},
		};
	});
}
