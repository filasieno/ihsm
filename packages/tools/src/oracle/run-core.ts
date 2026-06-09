import { FatalErrorState, StateClass, TraceLevel, TransitionError, getStateName } from '@ihsm/core';
import { makeTestActor, TestPort } from '@ihsm/core/testing';
import { transitionTraceLines } from 'ihsm/transition-routines';

import { OracleCtx, type Protocol } from '../fixtures/transition-oracle.machine';
import * as oracle from '../fixtures/transition-oracle.machine';

export interface CoreTransitionRun {
	readonly trace: string[];
	readonly finalState: StateClass<OracleCtx, Protocol>;
	readonly error?: TransitionError<OracleCtx, Protocol, 'runTransition'>;
}

export interface CoreTransitionRunOptions {
	readonly from: StateClass<OracleCtx, Protocol>;
	readonly to: StateClass<OracleCtx, Protocol>;
	readonly ctx?: OracleCtx;
	readonly fail?: { state: StateClass<OracleCtx, Protocol>; hook: 'onEntry' | 'onExit' };
}

/** Run a transition through `@ihsm/core` (verbose runtime) and return canonical trace lines. */
export async function runCoreTransition(options: CoreTransitionRunOptions): Promise<CoreTransitionRun> {
	const ctx = options.ctx ?? new OracleCtx();
	if (options.fail) {
		ctx.fail = { stateName: getStateName(options.fail.state), hook: options.fail.hook };
	} else {
		ctx.fail = undefined;
	}

	const port = new TestPort();
	const writer = new CollectingTraceWriter();
	let error: TransitionError<OracleCtx, Protocol, 'runTransition'> | undefined;
	const sm = makeTestActor(oracle.HsmTop, ctx, port, {
		initialize: false,
		traceLevel: TraceLevel.VERBOSE_DEBUG,
		traceWriter: writer,
		dispatchErrorCallback: (_hsm, err) => {
			if (err instanceof TransitionError) {
				error = err as TransitionError<OracleCtx, Protocol, 'runTransition'>;
			}
		},
	});

	sm.restore(options.from, ctx);
	writer.lines.length = 0;

	sm.post('runTransition', options.to);
	await sm.sync();

	return {
		trace: transitionTraceLines(writer.lines),
		finalState: sm.currentState,
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

export { FatalErrorState };
