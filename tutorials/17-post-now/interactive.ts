import { singleSenderTutorial } from '../_shared/interactive-helpers';
import { CheckoutTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Checkout postNow',
	topState: CheckoutTop,
	initialCtx: { steps: [], committed: false, cancelled: false },
	messages: [
		{ id: 'confirm', label: 'confirm', kind: 'post' },
		{ id: 'lockInventory', label: 'lockInventory', kind: 'post' },
		{ id: 'capturePayment', label: 'capturePayment', kind: 'post' },
		{ id: 'cancel', label: 'cancel', kind: 'post' },
	],
	stateSummary: sm => `State: ${sm.currentStateName} · steps: [${sm.ctx.steps.join(', ')}] · committed: ${sm.ctx.committed} · cancelled: ${sm.ctx.cancelled}`,
});
