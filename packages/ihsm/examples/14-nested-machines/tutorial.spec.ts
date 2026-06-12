import { expect } from 'chai';
import 'mocha';

import { PaymentDone, PaymentPending, ShippingDone, ShippingWaiting, createOrderCoordinator } from './machine';

describe('Tutorial 14: nested machines', () => {
	it('coordinates orthogonal payment and shipping actors', async () => {
		const order = createOrderCoordinator();
		await order.sync();

		expect(order.payment.hsm.currentState).equals(PaymentPending);
		expect(order.shipping.hsm.currentState).equals(ShippingWaiting);

		await order.fulfill();

		expect(order.payment.hsm.currentState).equals(PaymentDone);
		expect(order.shipping.hsm.currentState).equals(ShippingDone);
		expect(order.payment.ctx.paid).equals(true);
		expect(order.shipping.ctx.shipped).equals(true);
	});
});
