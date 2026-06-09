import { State, StateClass, TopState, TransitionError } from '../';

import { asError, getInitialState, getStateName, hasInitialState, quoteUnknown } from './utils';

/** LCA exit/entry path for one `from → to` pair (matches production transition planning). */
export interface PlannedTransition<Context, Protocol extends {} | undefined> {
	readonly exit: readonly StateClass<Context, Protocol>[];
	readonly entry: readonly StateClass<Context, Protocol>[];
	readonly finalState?: StateClass<Context, Protocol>;
}

/** Serializable plan passed to generated transition routines and oracle tests. */
export interface TransitionRoutinePlan<Context = Record<string, unknown>, Protocol extends {} | undefined = undefined>
	extends PlannedTransition<Context, Protocol> {
	readonly from: StateClass<Context, Protocol>;
	readonly to: StateClass<Context, Protocol>;
}

/** Verbose transition trace sink — mirrors `dispatch.trace` / `dispatch.debug` writers. */
export interface TransitionRoutineTrace {
	transitionStart(fromStateName: string, toStateName: string): void;
	hookDone(stateName: string, hook: 'onExit' | 'onEntry'): void;
	hookSkipped(stateName: string, hook: 'onExit' | 'onEntry'): void;
	hookError(stateName: string, hook: 'onExit' | 'onEntry', cause: unknown): void;
	transitionDone(finalStateName: string): void;
}

export type TransitionRoutineStyle = 'production' | 'debug' | 'verbose';

export interface TransitionRoutineExecuteOptions<Context, Protocol extends {} | undefined> {
	readonly style?: TransitionRoutineStyle;
	readonly trace?: TransitionRoutineTrace;
	readonly setCurrentState?: (state: StateClass<Context, Protocol>) => void;
}

/** Compute the LCA transition path (same algorithm as `dispatch.production.ts`). */
export function planTransitionClasses<Context, Protocol extends {} | undefined>(
	srcState: StateClass<Context, Protocol>,
	destState: StateClass<Context, Protocol>,
): PlannedTransition<Context, Protocol> {
	const src: StateClass<Context, Protocol> = srcState;
	let dst: StateClass<Context, Protocol> = destState;
	let srcPath: StateClass<Context, Protocol>[] = [];
	const end: StateClass<Context, Protocol> = TopState;
	const srcIndex = new Map<StateClass<Context, Protocol>, number>();
	let dstPath: StateClass<Context, Protocol>[] = [];
	let cur: StateClass<Context, Protocol> = src;
	let i = 0;

	while (cur !== end) {
		srcPath.push(cur);
		srcIndex.set(cur, i);
		cur = Object.getPrototypeOf(cur);
		++i;
	}
	cur = dst;

	while (cur !== end) {
		const index = srcIndex.get(cur);
		if (index !== undefined) {
			srcPath = srcPath.slice(0, index);
			break;
		}
		dstPath.unshift(cur);
		cur = Object.getPrototypeOf(cur);
	}

	while (hasInitialState(dst)) {
		dst = getInitialState(dst);
		dstPath.push(dst);
	}

	let finalState: StateClass<Context, Protocol> | undefined;
	if (dstPath.length !== 0) {
		finalState = dstPath[dstPath.length - 1];
	} else if (srcPath.length !== 0) {
		finalState = Object.getPrototypeOf(srcPath[srcPath.length - 1]);
	} else {
		finalState = undefined;
	}

	srcPath = srcPath.filter(value => !value.hasOwnProperty('onExit'));
	dstPath = dstPath.filter(value => !value.hasOwnProperty('onEntry'));

	return { exit: srcPath, entry: dstPath, finalState };
}

function resolveVerboseFinalState<Context, Protocol extends {} | undefined>(
	plan: PlannedTransition<Context, Protocol>,
	currentState: StateClass<Context, Protocol>,
): StateClass<Context, Protocol> {
	if (plan.entry.length !== 0) {
		return plan.entry[plan.entry.length - 1];
	}
	if (plan.exit.length !== 0) {
		return Object.getPrototypeOf(plan.exit[plan.exit.length - 1]) as StateClass<Context, Protocol>;
	}
	return currentState;
}

async function invokeLifecycleHook<Context, Protocol extends {} | undefined>(
	hsm: State<Context, Protocol>,
	instance: object,
	state: StateClass<Context, Protocol>,
	hook: 'onExit' | 'onEntry',
	fromStateName: string,
	toStateName: string,
	style: TransitionRoutineStyle,
	trace: TransitionRoutineTrace | undefined,
): Promise<void> {
	const statePrototype = state.prototype;
	const stateName = getStateName(state);
	const hasHook = Object.prototype.hasOwnProperty.call(statePrototype, hook);

	if ((style === 'verbose' || style === 'debug') && !hasHook) {
		if (style === 'verbose') {
			trace?.hookSkipped(stateName, hook);
		}
		return;
	}

	try {
		const res = statePrototype[hook].call(instance);
		if (res) {
			await res;
		}
		if (style === 'verbose') {
			trace?.hookDone(stateName, hook);
		}
	} catch (cause) {
		if (style === 'verbose') {
			trace?.hookError(stateName, hook, cause);
		}
		throw new TransitionError(hsm, asError(cause), stateName, hook, fromStateName, toStateName);
	}
}

/**
 * Execute a planned transition path with production or verbose semantics.
 *
 * Used by the runtime dispatch layer, generated transition tables (`@ihsm/tools`), and oracle tests.
 */
export async function executeTransitionRoutine<Context, Protocol extends {} | undefined>(
	hsm: State<Context, Protocol>,
	instance: object,
	plan: TransitionRoutinePlan<Context, Protocol> | PlannedTransition<Context, Protocol>,
	srcState: StateClass<Context, Protocol>,
	dstState: StateClass<Context, Protocol>,
	options: TransitionRoutineExecuteOptions<Context, Protocol> = {},
): Promise<void> {
	const style = options.style ?? 'production';
	const trace = options.trace;
	const fromStateName = getStateName(srcState);
	const toStateName = getStateName(dstState);

	if (style === 'verbose' || style === 'debug') {
		trace?.transitionStart(fromStateName, toStateName);
	}

	for (const state of plan.exit) {
		await invokeLifecycleHook(hsm, instance, state, 'onExit', fromStateName, toStateName, style, trace);
	}

	for (const state of plan.entry) {
		await invokeLifecycleHook(hsm, instance, state, 'onEntry', fromStateName, toStateName, style, trace);
	}

	const applyState = (next: StateClass<Context, Protocol>): void => {
		if (options.setCurrentState) {
			options.setCurrentState(next);
		} else if ('currentState' in hsm) {
			(hsm as State<Context, Protocol> & { currentState: StateClass<Context, Protocol> }).currentState = next;
		}
	};

	if (style === 'verbose') {
		const finalState = resolveVerboseFinalState(plan, srcState);
		trace?.transitionDone(getStateName(finalState));
		applyState(finalState);
		return;
	}

	if (style === 'debug' && plan.finalState) {
		trace?.transitionDone(getStateName(plan.finalState));
		applyState(plan.finalState);
		return;
	}

	if (plan.finalState) {
		applyState(plan.finalState);
	}
}

/** Minimal verbose trace host used by {@link createHsmTransitionTrace}. */
export interface TransitionTraceHost {
	_tracePush(domain: string, msg: string): void;
	_traceWrite(msg: string): void;
	_tracePopDone(msg: string): void;
	_tracePopError(msg: string): void;
}

/** Build a trace sink that forwards to an ihsm verbose trace writer. */
export function createHsmTransitionTrace(hsm: TransitionTraceHost): TransitionRoutineTrace {
	return {
		transitionStart(fromStateName, toStateName) {
			hsm._tracePush(`transition from ${fromStateName} to ${toStateName}`, `started transition from ${fromStateName} to ${toStateName} `);
		},
		hookDone(stateName, hook) {
			hsm._traceWrite(`${stateName}.${hook}() done`);
		},
		hookSkipped(stateName, hook) {
			hsm._traceWrite(`${stateName}.${hook}() skipped: default empty implementation`);
		},
		hookError(stateName, hook, cause) {
			hsm._tracePopError(`${stateName}.${hook}() has thrown ${quoteUnknown(cause)}`);
		},
		transitionDone(finalStateName) {
			hsm._tracePopDone(`final state is ${finalStateName}`);
		},
	};
}

/** Collect canonical transition trace lines (for oracle comparison). */
export function transitionTraceLines(lines: readonly string[]): string[] {
	return lines
		.map(line => {
			const idx = line.indexOf(': ');
			return idx >= 0 ? line.slice(idx + 2) : line;
		})
		.filter(
			line =>
				line.startsWith('started transition from ') ||
				line.endsWith('.onExit() done') ||
				line.endsWith('.onEntry() done') ||
				line.includes('.onExit() skipped:') ||
				line.includes('.onEntry() skipped:') ||
				line.includes('.onExit() has thrown') ||
				line.includes('.onEntry() has thrown') ||
				line.startsWith('done: final state is ') ||
				line.startsWith('failure: ') && line.includes('.onExit() has thrown') ||
				line.startsWith('failure: ') && line.includes('.onEntry() has thrown'),
		);
}
