import { ResultWithSubscription, TestPort, TraceLevel, makeTestActor } from '../../src/testing';
import { CollectingTraceWriter } from '../shared/trace';
import { registerStateNamesFromExports } from '../shared/state-names';
import { getSenderHsm } from '../shared/interactive-helpers';
import type { InteractiveRuntime, TutorialInteractiveMeta } from '../shared/interactive-types';
import * as machine from './machine';
import { FetchTop, FetchCtx, FetchPort, freshCtx } from './machine';

/**
 * Local playground port (a class on {@link TestPort}). It records the request and returns an abort
 * subscription, but never settles on its own — the "deliver 200 / 503 / error" buttons push the
 * settled event in, mirroring the deterministic `port.send(...)` the unit test calls.
 */
class PlaygroundFetchPort extends TestPort<FetchTop> implements FetchPort {
	private seq = 0;

	request(url: string): ResultWithSubscription<number> {
		const id = ++this.seq;
		this.record('request', url);
		return {
			value: id,
			subscription: {
				dispose: () => this.record('abort', id),
			},
		};
	}
}

function summarize(sm: { currentStateName: string; ctx: FetchCtx }): string {
	const { url, status, body, error } = sm.ctx;
	const detail = error ? `error: ${error}` : `status: ${status || '—'} · body: ${body.length} bytes`;
	return `State: ${sm.currentStateName} · url: ${url || '—'} · ${detail}`;
}

async function settle(runtime: InteractiveRuntime, event: 'onResponse' | 'onFailure', ...args: (number | string)[]): Promise<void> {
	const sm = getSenderHsm(runtime, 'machine');
	sm.post(event, ...args);
	await sm.sync();
}

export const interactive: TutorialInteractiveMeta = {
	title: 'Network fetch behind a port',
	senders: [{ id: 'machine', label: 'Fetcher' }],
	messagesBySender: {
		machine: [
			{
				id: 'fetch',
				label: 'fetch',
				kind: 'post',
				fields: [{ name: 'url', label: 'url', type: 'string', default: 'https://google.com' }],
			},
			{ id: 'cancel', label: 'cancel', kind: 'post' },
			{ id: 'body', label: 'body', kind: 'call' },
		],
	},
	createRuntime: (): InteractiveRuntime => {
		registerStateNamesFromExports(machine);
		const writer = new CollectingTraceWriter();
		const sm = makeTestActor(
			FetchTop, // root state
			freshCtx(), // fresh domain context
			new PlaygroundFetchPort(), // the deterministic mock network port
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
		return summarize(runtime.sm as unknown as { currentStateName: string; ctx: FetchCtx });
	},
	extraActions: [
		{
			id: 'ok',
			label: 'deliver 200',
			run: (runtime): Promise<void> => settle(runtime, 'onResponse', 200, '<!doctype html><title>google</title>'),
		},
		{
			id: 'down',
			label: 'deliver 503',
			run: (runtime): Promise<void> => settle(runtime, 'onResponse', 503, 'unavailable'),
		},
		{
			id: 'err',
			label: 'transport error',
			run: (runtime): Promise<void> => settle(runtime, 'onFailure', 'ENOTFOUND'),
		},
	],
};
