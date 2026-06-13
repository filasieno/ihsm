import { ResultWithSubscription, TestPort, TraceLevel, makeTestActor } from '../../src/testing';
import { CollectingTraceWriter } from '../shared/trace';
import { registerStateNamesFromExports } from '../shared/state-names';
import { getSenderHsm } from '../shared/interactive-helpers';
import type { InteractiveRuntime, TutorialInteractiveMeta } from '../shared/interactive-types';
import * as machine from './machine';
import { WatcherTop, WatcherCtx, WatcherConfig, WatcherPort } from './machine';

/**
 * Local playground watch source (a class on {@link TestPort}). The buttons push `onChange` /
 * `onClosed` directly onto the test actor, so this port only needs to open the watch and return a
 * `Disposable` that records its teardown — the surface the machine actually drives.
 */
class PlaygroundWatcherPort extends TestPort<WatcherTop> implements WatcherPort {
	private watchId = 0;

	watch(path: string): ResultWithSubscription<number> {
		const id = ++this.watchId;
		this.record('watch', path);
		return {
			value: id,
			subscription: {
				dispose: () => this.record('dispose', id),
			},
		};
	}
}

/** Monotonic version counter for simulated change events. */
let nextVersion = 1;

function summarize(sm: { hsm: { currentStateName: string }; ctx: WatcherCtx }): string {
	const watching = sm.ctx.subscription !== undefined;
	return `State: ${sm.hsm.currentStateName} · watching: ${watching} · path: ${sm.ctx.path || '—'} · changes: ${sm.ctx.changes.length}`;
}

async function emitChange(runtime: InteractiveRuntime): Promise<void> {
	const sm = getSenderHsm<WatcherConfig>(runtime, 'machine');
	sm.onChange(nextVersion++);
	await sm.hsm.sync();
}

export const interactive: TutorialInteractiveMeta = {
	title: 'Subscriptions & disposables',
	senders: [{ id: 'machine', label: 'Watcher' }],
	messagesBySender: {
		machine: [
			{
				id: 'start',
				label: 'start watching',
				kind: 'notification',
				fields: [{ name: 'path', label: 'path', type: 'string', default: '/etc/hosts' }],
			},
			{ id: 'stop', label: 'stop watching', kind: 'notification' },
		],
	},
	createRuntime: (): InteractiveRuntime => {
		registerStateNamesFromExports(machine);
		nextVersion = 1;
		const writer = new CollectingTraceWriter();
		const sm = makeTestActor(
			WatcherTop, // root state
			new WatcherCtx(), // fresh domain context
			new PlaygroundWatcherPort(), // the deterministic mock watch source
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
		return summarize(runtime.sm as unknown as { hsm: { currentStateName: string }; ctx: WatcherCtx });
	},
	extraActions: [
		{
			id: 'change',
			label: 'emit change',
			run: (runtime): Promise<void> => emitChange(runtime),
		},
		{
			id: 'burst',
			label: 'emit 5 changes',
			run: async (runtime): Promise<void> => {
				for (let i = 0; i < 5; i++) {
					await emitChange(runtime);
				}
			},
		},
		{
			id: 'closed',
			label: 'source closes',
			run: async (runtime): Promise<void> => {
				const sm = getSenderHsm<WatcherConfig>(runtime, 'machine');
				sm.onClosed();
				await sm.hsm.sync();
			},
		},
	],
};
