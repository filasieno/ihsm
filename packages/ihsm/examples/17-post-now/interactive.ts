import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Checkout postNow',
	topState: machine.CheckoutTop,
	machineExports: machine,
	initialCtx: { steps: [], committed: false, cancelled: false },
	messages: [
		{ id: 'confirm', label: 'confirm', kind: 'notification' },
		{ id: 'lockInventory', label: 'lockInventory', kind: 'notification' },
		{ id: 'capturePayment', label: 'capturePayment', kind: 'notification' },
		{ id: 'cancel', label: 'cancel', kind: 'notification' },
	],
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · steps: [${sm.ctx.steps.join(', ')}] · committed: ${sm.ctx.committed} · cancelled: ${sm.ctx.cancelled}`,
});
