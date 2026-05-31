import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Wallet machine',
	topState: machine.WalletTop,
	machineExports: machine,
	initialCtx: { balance: 100 },
	messages: [
		{
			id: 'deposit',
			label: 'deposit',
			kind: 'post',
			fields: [{ name: 'amount', label: 'Amount', type: 'number', default: 25 }],
		},
		{ id: 'getBalance', label: 'getBalance', kind: 'call' },
		{
			id: 'fetchBalanceDelayed',
			label: 'fetchBalanceDelayed',
			kind: 'call',
			fields: [{ name: 'delayMs', label: 'Delay (ms)', type: 'number', default: 100 }],
		},
		{
			id: 'withdraw',
			label: 'withdraw',
			kind: 'call',
			fields: [{ name: 'amount', label: 'Amount', type: 'number', default: 10 }],
		},
	],
	stateSummary: sm => `State: ${sm.currentStateName} · balance: ${sm.ctx.balance}`,
});
