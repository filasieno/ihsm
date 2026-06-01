import { expect } from 'chai';
import 'mocha';

import { PaymentDone, PaymentPending, ShippingDone, ShippingWaiting, createOrderCoordinator } from './machine';

describe('Tutorial 14: nested machines', () => {
	it('coordinates orthogonal payment and shipping actors', async () => {
		const order = createOrderCoordinator();
		await order.sync();

		expect(order.payment.currentState).equals(PaymentPending);
		expect(order.shipping.currentState).equals(ShippingWaiting);

		await order.fulfill();

		expect(order.payment.currentState).equals(PaymentDone);
		expect(order.shipping.currentState).equals(ShippingDone);
		expect(order.payment.ctx.paid).equals(true);
		expect(order.shipping.ctx.shipped).equals(true);
	});
});
