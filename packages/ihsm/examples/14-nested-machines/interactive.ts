import { TraceLevel } from '../../src';
import type { CoordinatorRuntime, TutorialInteractiveMeta } from '../shared/interactive-types';
import { CollectingTraceWriter } from '../shared/trace';
import * as machine from './machine';
import { createOrderCoordinator } from './machine';
import { registerStateNamesFromExports } from '../shared/state-names';

registerStateNamesFromExports(machine);

function createCoordinatorRuntime(): CoordinatorRuntime {
	const writer = new CollectingTraceWriter();
	const coordinator = createOrderCoordinator();
	coordinator.payment.hsm.traceLevel = TraceLevel.VERBOSE_DEBUG;
	coordinator.payment.hsm.traceWriter = writer;
	coordinator.shipping.hsm.traceLevel = TraceLevel.VERBOSE_DEBUG;
	coordinator.shipping.hsm.traceWriter = writer;
	return { kind: 'coordinator', coordinator, writer };
}

export const interactive: TutorialInteractiveMeta = {
	title: 'Order coordinator',
	senders: [
		{ id: 'payment', label: 'Payment region' },
		{ id: 'shipping', label: 'Shipping region' },
	],
	messagesBySender: {
		payment: [{ id: 'markPaid', label: 'markPaid', kind: 'notification' }],
		shipping: [{ id: 'markShipped', label: 'markShipped', kind: 'notification' }],
	},
	createRuntime: createCoordinatorRuntime,
	stateSummary: runtime => {
		if (runtime.kind !== 'coordinator') {
			return '';
		}
		const { payment, shipping } = runtime.coordinator;
		return `Payment: ${payment.hsm.currentStateName} (paid=${payment.ctx.paid}) · Shipping: ${shipping.hsm.currentStateName} (shipped=${shipping.ctx.shipped})`;
	},
	extraActions: [
		{
			id: 'fulfill',
			label: 'Coordinator fulfill()',
			run: async runtime => {
				if (runtime.kind !== 'coordinator') {
					return;
				}
				runtime.writer.lines.push('↳ coordinator.fulfill()');
				await runtime.coordinator.fulfill();
			},
		},
	],
};
