import { HsmTraceLevel } from '../../src';
import type { CoordinatorRuntime, TutorialInteractiveMeta } from '../_shared/interactive-types';
import { CollectingTraceWriter } from '../_shared/trace';
import { createOrderCoordinator } from './machine';

function createCoordinatorRuntime(): CoordinatorRuntime {
	const writer = new CollectingTraceWriter();
	const coordinator = createOrderCoordinator();
	coordinator.payment.traceLevel = HsmTraceLevel.VERBOSE_DEBUG;
	coordinator.payment.traceWriter = writer;
	coordinator.shipping.traceLevel = HsmTraceLevel.VERBOSE_DEBUG;
	coordinator.shipping.traceWriter = writer;
	return { kind: 'coordinator', coordinator, writer };
}

export const interactive: TutorialInteractiveMeta = {
	title: 'Order coordinator',
	senders: [
		{ id: 'payment', label: 'Payment region' },
		{ id: 'shipping', label: 'Shipping region' },
	],
	messagesBySender: {
		payment: [{ id: 'markPaid', label: 'markPaid', kind: 'post' }],
		shipping: [{ id: 'markShipped', label: 'markShipped', kind: 'post' }],
	},
	createRuntime: createCoordinatorRuntime,
	stateSummary: runtime => {
		if (runtime.kind !== 'coordinator') {
			return '';
		}
		const { payment, shipping } = runtime.coordinator;
		return `Payment: ${payment.currentStateName} (paid=${payment.ctx.paid}) · Shipping: ${shipping.currentStateName} (shipped=${shipping.ctx.shipped})`;
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
