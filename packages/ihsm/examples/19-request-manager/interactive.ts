import { TraceLevel } from '../../src';
import { makeTestActor } from '../../src/testing';
import type { TutorialInteractiveMeta } from '../shared/interactive-types';
import { CollectingTraceWriter } from '../shared/trace';
import { registerStateNamesFromExports } from '../shared/state-names';
import * as machine from './machine';
import { RequestManagerTop, createRequestManager, syncRequestManager } from './machine';

registerStateNamesFromExports(machine);

type ManagerActor = ReturnType<typeof createRequestManager>;

function tableSummary(manager: ManagerActor): string {
	const rows = Object.entries(manager.ctx.table)
		.map(([id, row]) => `#${id} ${row.kind}:${row.status}`)
		.join(', ');
	return rows.length > 0 ? rows : '(empty)';
}

export const interactive: TutorialInteractiveMeta = {
	title: 'Request manager',
	senders: [{ id: 'manager', label: 'Request manager' }],
	messagesBySender: {
		manager: [
			{ id: 'submit', label: 'submit', kind: 'notification', fields: [{ name: 'kind', label: 'kind (alpha|beta)', type: 'string', default: 'alpha' }] },
			{ id: 'cancel', label: 'cancel', kind: 'notification', fields: [{ name: 'requestId', label: 'request id', type: 'number', default: 1 }] },
		],
	},
	afterDispatch: async runtime => {
		await syncRequestManager(runtime.sm as ManagerActor);
	},
	createRuntime: () => {
		const writer = new CollectingTraceWriter();
		const sm = makeTestActor(
			RequestManagerTop,
			{ nextId: 0, table: {}, children: {}, childPorts: {} },
			{
				traceLevel: TraceLevel.VERBOSE_DEBUG,
				traceWriter: writer,
			}
		);
		return { kind: 'single', sm, writer };
	},
	stateSummary: runtime => {
		const manager = runtime.sm as ManagerActor;
		const inflight = Object.keys(manager.ctx.children).length;
		return `Manager: ${manager.hsm.currentStateName} · table: ${tableSummary(manager)} · inflight=${inflight}`;
	},
	extraActions: [
		{
			id: 'syncAll',
			label: 'Sync manager + commands',
			run: async runtime => {
				runtime.writer.lines.push('↳ syncRequestManager()');
				await syncRequestManager(runtime.sm as ManagerActor);
			},
		},
		{
			id: 'advance50',
			label: 'Advance timers 50ms (all children)',
			run: async runtime => {
				const manager = runtime.sm as ManagerActor;
				for (const port of Object.values(manager.ctx.childPorts)) {
					await port.advance(50);
				}
				runtime.writer.lines.push('↳ advance(50) on command ports');
				await syncRequestManager(manager);
			},
		},
	],
};
