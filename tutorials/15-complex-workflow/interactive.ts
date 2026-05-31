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
		{ id: 'submit', label: 'submit', kind: 'post' },
		{ id: 'approve', label: 'approve', kind: 'post' },
		{
			id: 'reject',
			label: 'reject',
			kind: 'post',
			fields: [{ name: 'reason', label: 'Reason', type: 'string', default: 'manual reject' }],
		},
		{ id: 'getStatus', label: 'getStatus', kind: 'call' },
	],
	stateSummary: sm => `State: ${sm.currentStateName} · phase: ${sm.ctx.phase} · amount: ${sm.ctx.amount} · notes: [${sm.ctx.validationNotes.join(', ')}]`,
});
