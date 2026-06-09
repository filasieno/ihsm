import { FatalErrorState, StateClass, TraceLevel, TransitionError, getStateName, type State } from '@ihsm/core';
import { makeTestActor, TestPort } from '@ihsm/core/testing';
import { createHsmTransitionTrace, executeTransitionRoutine, transitionTraceLines } from 'ihsm/transition-routines';

import { OracleCtx, type Protocol } from '../fixtures/transition-oracle.machine';
import * as oracle from '../fixtures/transition-oracle.machine';
import type { BuiltTransitionRoutine } from './routines';

export interface RoutineTransitionRun {
	readonly trace: string[];
	readonly finalState: StateClass<OracleCtx, Protocol>;
	readonly error?: TransitionError<OracleCtx, Protocol, 'runTransition'>;
}

export interface RoutineTransitionRunOptions {
	readonly routine: BuiltTransitionRoutine;
	readonly from: StateClass<OracleCtx, Protocol>;
	readonly ctx?: OracleCtx;
	readonly fail?: { state: StateClass<OracleCtx, Protocol>; hook: 'onEntry' | 'onExit' };
}

/** Run the generated-style routine with verbose tracing (oracle path). */
export async function runRoutineTransition(options: RoutineTransitionRunOptions): Promise<RoutineTransitionRun> {
	const ctx = options.ctx ?? new OracleCtx();
	if (options.fail) {
		ctx.fail = { stateName: getStateName(options.fail.state), hook: options.fail.hook };
	} else {
		ctx.fail = undefined;
	}

	const port = new TestPort();
	const writer = new CollectingTraceWriter();
	const sm = makeTestActor(oracle.HsmTop, ctx, port, {
		initialize: false,
		traceLevel: TraceLevel.VERBOSE_DEBUG,
		traceWriter: writer,
	});

	sm.restore(options.from, ctx);
	writer.lines.length = 0;

	const hsm = sm as unknown as State<OracleCtx, Protocol> & {
		currentState: StateClass<OracleCtx, Protocol>;
		_instance: object;
		_tracePush: (d: string, msg: string) => void;
		_traceWrite: (msg: string) => void;
		_tracePopDone: (msg: string) => void;
		_tracePopError: (msg: string) => void;
	};

	let error: TransitionError<OracleCtx, Protocol, 'runTransition'> | undefined;
	try {
		await executeTransitionRoutine(hsm, hsm._instance, options.routine.plan, options.routine.from, options.routine.to, {
			style: 'verbose',
			trace: createHsmTransitionTrace(hsm),
			setCurrentState: state => {
				hsm.currentState = state;
			},
		});
	} catch (err) {
		if (err instanceof TransitionError) {
			error = err as TransitionError<OracleCtx, Protocol, 'runTransition'>;
			hsm.currentState = FatalErrorState;
		} else {
			throw err;
		}
	}

	return {
		trace: transitionTraceLines(writer.lines),
		finalState: hsm.currentState,
		error,
	};
}

class CollectingTraceWriter {
	readonly lines: string[] = [];

	write(hsm: { traceHeader: string; currentStateName: string }, msg: unknown): void {
		if (typeof msg === 'string') {
			this.lines.push(`${hsm.traceHeader}${hsm.currentStateName}: ${msg}`);
		} else {
			this.lines.push(typeof msg === 'object' ? JSON.stringify(msg) : String(msg));
		}
	}
}
