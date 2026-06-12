import { TestPort, TraceLevel, makeTestActor } from '../../src/testing';
import { CollectingTraceWriter } from '../shared/trace';
import { registerStateNamesFromExports } from '../shared/state-names';
import { getSenderHsm } from '../shared/interactive-helpers';
import type { InteractiveRuntime, TutorialInteractiveMeta } from '../shared/interactive-types';
import * as machine from './machine';
import { HeartbeatTop, HeartbeatCtx, HOUR_MS } from './machine';

/** The manually-advanced clock backing the current playground run (one per `createRuntime`). */
let activeClock: TestPort<HeartbeatTop> | undefined;

function summarize(sm: { hsm: { currentStateName: string }; ctx: HeartbeatCtx }): string {
	const simulatedHours = activeClock ? Math.round(activeClock.now / HOUR_MS) : 0;
	return `State: ${sm.hsm.currentStateName} · running: ${sm.ctx.running} · ticks: ${sm.ctx.ticks} · simulated: ${simulatedHours}h`;
}

async function advanceHours(runtime: InteractiveRuntime, hours: number): Promise<void> {
	const sm = getSenderHsm(runtime, 'machine');
	for (let hour = 0; hour < hours; hour++) {
		activeClock?.advance(HOUR_MS);
		await sm.hsm.sync();
	}
}

export const interactive: TutorialInteractiveMeta = {
	title: 'Deferred timers & simulated time',
	senders: [{ id: 'machine', label: 'Heartbeat' }],
	messagesBySender: {
		machine: [
			{ id: 'start', label: 'start', kind: 'notification' },
			{ id: 'stop', label: 'stop', kind: 'notification' },
		],
	},
	createRuntime: (): InteractiveRuntime => {
		registerStateNamesFromExports(machine);
		const writer = new CollectingTraceWriter();
		activeClock = new TestPort<HeartbeatTop>();
		const sm = makeTestActor(
			HeartbeatTop, // root state
			new HeartbeatCtx(), // fresh domain context
			activeClock, // the manually-advanced virtual clock
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
			id: 'hour',
			label: 'advance 1 hour',
			run: (runtime): Promise<void> => advanceHours(runtime, 1),
		},
		{
			id: 'day',
			label: 'advance 24 hours',
			run: (runtime): Promise<void> => advanceHours(runtime, 24),
		},
	],
};
