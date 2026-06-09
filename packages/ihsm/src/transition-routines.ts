/**
 * Shared transition planning and execution for the runtime and generated routine tables.
 *
 * @packageDocumentation
 */

export {
	createHsmTransitionTrace,
	executeTransitionRoutine,
	planTransitionClasses,
	transitionTraceLines,
} from './internal/transition-routines';

export type {
	PlannedTransition,
	TransitionRoutineExecuteOptions,
	TransitionRoutinePlan,
	TransitionRoutineStyle,
	TransitionRoutineTrace,
	TransitionTraceHost,
} from './internal/transition-routines';
