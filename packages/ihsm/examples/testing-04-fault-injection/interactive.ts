import { TraceLevel, TestPort, makeTestActor } from '../../src/testing';
import { CollectingTraceWriter } from '../shared/trace';
import { registerStateNamesFromExports } from '../shared/state-names';
import { getSenderHsm } from '../shared/interactive-helpers';
import type { InteractiveRuntime, TutorialInteractiveMeta } from '../shared/interactive-types';
import * as machine from './machine';
import { WorkerTop, WorkerCtx, FaultPort, freshCtx } from './machine';

/** Stub port (a class on {@link TestPort}, typed by the root {@link WorkerTop}): records retries
 * but never auto-reports — the buttons inject faults by hand. */
class StubFaultPort extends TestPort<WorkerTop> implements FaultPort {
	attempt(n: number): void {
		this.record('attempt', n);
	}
}

function summarize(sm: { hsm: { currentStateName: string }; ctx: WorkerCtx }): string {
	const { attempts, maxAttempts, log } = sm.ctx;
	const last = log[log.length - 1] ?? '—';
	return `State: ${sm.hsm.currentStateName} · attempt ${attempts}/${maxAttempts} · last: ${last}`;
}

async function inject(runtime: InteractiveRuntime, ok: boolean): Promise<void> {
	const sm = getSenderHsm(runtime, 'machine');
	sm.onResult(ok);
	await sm.hsm.sync();
}

export const interactive: TutorialInteractiveMeta = {
	title: 'Fault injection & seeded DST',
	senders: [{ id: 'machine', label: 'Worker' }],
	messagesBySender: {
		machine: [{ id: 'run', label: 'run', kind: 'notification' }],
	},
	createRuntime: (): InteractiveRuntime => {
		registerStateNamesFromExports(machine);
		const writer = new CollectingTraceWriter();
		const sm = makeTestActor(
			WorkerTop, // root state
			freshCtx(4), // fresh domain context (4 attempts)
			new StubFaultPort(), // manual fault injection
			{
				traceLevel: TraceLevel.VERBOSE_DEBUG, // full trace for the playground
				traceWriter: writer, // collect lines for the trace panel
			}
		);
		return { kind: 'single', sm, writer };
	},
	stateSummary: (runtime): string => {
		if (runtime.kind !== 'single') {
			return '';
		}
		return summarize(runtime.sm);
	},
	extraActions: [
		{
			id: 'fault',
			label: 'inject fault',
			run: (runtime): Promise<void> => inject(runtime, false),
		},
		{
			id: 'success',
			label: 'inject success',
			run: (runtime): Promise<void> => inject(runtime, true),
		},
	],
};
