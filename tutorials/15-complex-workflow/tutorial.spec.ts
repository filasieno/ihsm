import { expect } from 'chai';
import 'mocha';

import { Approved, Completing, Draft, Rejected, createCheckout } from './machine';

describe('Tutorial 15: complex workflow', () => {
	it('approves an order within limit and completes', async () => {
		const order = createCheckout('ORD-100', 500, 1000);
		await order.sync();
		expect(order.currentState).equals(Draft);

		order.post('submit');
		await order.sync();
		expect(order.currentState).equals(Approved);
		expect(order.ctx.validationNotes).includes('fraud-check-ok');

		order.post('approve');
		await order.sync();
		expect(order.currentState).equals(Completing);
		expect(order.ctx.phase).equals('completed');

		const phase = await order.call('getStatus');
		expect(phase).equals('completed');
	});

	it('rejects an order over the limit', async () => {
		const order = createCheckout('ORD-200', 5000, 1000);
		await order.sync();

		order.post('submit');
		await order.sync();
		expect(order.currentState).equals(Rejected);
		expect(order.ctx.phase).equals('rejected');
		expect(order.ctx.validationNotes).includes('over-limit');
	});
});
