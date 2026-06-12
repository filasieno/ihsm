import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Checkout workflow',
	topState: machine.CheckoutTop,
	machineExports: machine,
	initialCtx: {
		orderId: 'ORD-42',
		amount: 120,
		limit: 100,
		phase: 'draft',
		validationNotes: [],
	},
	messages: [
		{ id: 'submit', label: 'submit', kind: 'notification' },
		{ id: 'approve', label: 'approve', kind: 'notification' },
		{
			id: 'reject',
			label: 'reject',
			kind: 'notification',
			fields: [{ name: 'reason', label: 'Reason', type: 'string', default: 'manual reject' }],
		},
		{ id: 'getStatus', label: 'getStatus', kind: 'service' },
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · phase: ${sm.ctx.phase} · amount: ${sm.ctx.amount} · notes: [${sm.ctx.validationNotes.join(', ')}]`,
});
