import { expect } from 'chai';
import 'mocha';

import { Approved, Completing, Draft, Rejected, createCheckout } from './machine';

describe('Tutorial 15: complex workflow', () => {
	it('approves an order within limit and completes', async () => {
		const order = createCheckout('ORD-100', 500, 1000);
		await order.hsm.sync();
		expect(order.hsm.currentState).equals(Draft);

		order.submit();
		await order.hsm.sync();
		expect(order.hsm.currentState).equals(Approved);
		expect(order.ctx.validationNotes).includes('fraud-check-ok');

		order.approve();
		await order.hsm.sync();
		expect(order.hsm.currentState).equals(Completing);
		expect(order.ctx.phase).equals('completed');

		const phase = await order.getStatus();
		expect(phase).equals('completed');
	});

	it('rejects an order over the limit', async () => {
		const order = createCheckout('ORD-200', 5000, 1000);
		await order.hsm.sync();

		order.submit();
		await order.hsm.sync();
		expect(order.hsm.currentState).equals(Rejected);
		expect(order.ctx.phase).equals('rejected');
		expect(order.ctx.validationNotes).includes('over-limit');
	});
});
