import { ResultWithSubscription, TestPort, TraceLevel, makeTestActor } from '../../src/testing';
import { CollectingTraceWriter } from '../shared/trace';
import { registerStateNamesFromExports } from '../shared/state-names';
import { getSenderHsm } from '../shared/interactive-helpers';
import type { InteractiveRuntime, TutorialInteractiveMeta } from '../shared/interactive-types';
import * as machine from './machine';
import { MouseTop, MouseCtx, MouseConfig, MouseStreamPort, freshCtx } from './machine';

/**
 * Local playground stream source (a class on {@link TestPort}). The "move mouse" / mouse-pad
 * actions post `onMouseMove` directly onto the test actor, so this port only needs to open and
 * close the stream — exactly the surface the machine drives.
 */
class PlaygroundMouseStream extends TestPort<MouseTop> implements MouseStreamPort {
	private streamId = 0;

	subscribe(): ResultWithSubscription<number> {
		const id = ++this.streamId;
		this.record('subscribe', id);
		return {
			value: id,
			subscription: {
				dispose: () => this.record('unsubscribe', id),
			},
		};
	}
}

function summarize(sm: { hsm: { currentStateName: string }; ctx: MouseCtx }): string {
	const last = sm.ctx.moves[sm.ctx.moves.length - 1];
	const lastText = last ? `(${last.x}, ${last.y})` : '—';
	return `State: ${sm.hsm.currentStateName} · listening: ${sm.ctx.listening} · moves: ${sm.ctx.moves.length} · last: ${lastText}`;
}

async function streamMove(runtime: InteractiveRuntime, x: number, y: number): Promise<void> {
	const sm = getSenderHsm<MouseConfig>(runtime, 'machine');
	sm.onMouseMove(x, y);
	await sm.hsm.sync();
}

function randomCoord(): number {
	return Math.round(Math.random() * 200);
}

export const interactive: TutorialInteractiveMeta = {
	title: 'Event streaming (mouse)',
	senders: [{ id: 'machine', label: 'Event streaming (mouse)' }],
	messagesBySender: {
		machine: [
			{ id: 'listen', label: 'listen', kind: 'notification' },
			{ id: 'stopListening', label: 'stop listening', kind: 'notification' },
		],
	},
	createRuntime: (): InteractiveRuntime => {
		registerStateNamesFromExports(machine);
		const writer = new CollectingTraceWriter();
		const sm = makeTestActor(
			MouseTop, // root state
			freshCtx(), // fresh domain context
			new PlaygroundMouseStream(), // the deterministic mock stream port
			{
				traceLevel: TraceLevel.VERBOSE_DEBUG, // full trace for the playground
				traceWriter: writer, // collect lines for the trace panel
			}
		);
		return { kind: 'single', sm, writer } as unknown as InteractiveRuntime;
	},
	stateSummary: (runtime): string => {
		if (runtime.kind !== 'single') {
			return '';
		}
		return summarize(runtime.sm as unknown as { hsm: { currentStateName: string }; ctx: MouseCtx });
	},
	extraActions: [
		{
			id: 'move',
			label: 'move mouse',
			run: (runtime): Promise<void> => streamMove(runtime, randomCoord(), randomCoord()),
		},
		{
			id: 'burst',
			label: 'stream 8 moves',
			run: async (runtime): Promise<void> => {
				for (let i = 0; i < 8; i++) {
					await streamMove(runtime, randomCoord(), randomCoord());
				}
			},
		},
		{
			id: 'session',
			label: 'run simulated session',
			run: async (runtime): Promise<void> => {
				const sm = getSenderHsm<MouseConfig>(runtime, 'machine');
				sm.listen();
				await sm.hsm.sync();
				for (const [x, y] of [
					[10, 20],
					[14, 26],
					[18, 30],
				]) {
					await streamMove(runtime, x, y);
				}
				sm.stopListening();
				await sm.hsm.sync();
				await streamMove(runtime, 99, 99); // ignored: not listening
			},
		},
	],
	mousePad: {
		label: 'Mouse pad',
		hint: 'Press “listen”, then move the pointer here to stream moves. Press “stop listening” to go quiet.',
		onMove: (runtime, x, y): Promise<void> => streamMove(runtime, Math.round(x), Math.round(y)),
	},
};
