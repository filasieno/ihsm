/**
 * @ihsm/tools — development utilities for ihsm state machines.
 *
 * @packageDocumentation
 */

export { collectStates, collectStatesFromExports, isDescendantStateClass, isStateClass, resolveStates } from './discover';
export type { StateRef } from './discover';

export { planCartesianTransitions, planTransition } from './plan';
export type { TransitionPlan } from './plan';

export { generateTransitionTableModule, writeTransitionTableFile } from './generate';
export type { GenerateTransitionTableOptions } from './generate-options';

export { lifecycleHookIsAsync, planLifecycleStates, planNeedsAsync } from './lifecycle';

export { buildTransitionRoutines } from './oracle/routines';
export type { BuiltTransitionRoutine } from './oracle/routines';
