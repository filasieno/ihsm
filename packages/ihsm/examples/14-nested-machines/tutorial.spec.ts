import { expect } from 'chai';
import 'mocha';

import { Fulfilled, Open, PaymentDone, PaymentPending, ShippingDone, ShippingWaiting, createOrder, syncOrderRegions } from './machine';

describe('Tutorial 14: nested machines', () => {
	it('coordinates payment and shipping child actors via parent events only', async () => {
		const order = createOrder();
		await syncOrderRegions(order);

		expect(order.hsm.currentState).equals(Open);
		expect(order.ctx.payment!.hsm.currentState).equals(PaymentPending);
		expect(order.ctx.shipping!.hsm.currentState).equals(ShippingWaiting);

		order.notify.fulfill();
		await syncOrderRegions(order);

		expect(order.hsm.currentState).equals(Fulfilled);
		expect(order.ctx.payment!.hsm.currentState).equals(PaymentDone);
		expect(order.ctx.shipping!.hsm.currentState).equals(ShippingDone);
		expect(order.ctx.paymentCtx!.paid).equals(true);
		expect(order.ctx.shippingCtx!.shipped).equals(true);
	});

	it('sequences fulfill through Fulfilling without cross-actor call', async () => {
		const order = createOrder();
		await syncOrderRegions(order);

		order.notify.fulfill();
		await order.ctx.payment!.hsm.sync();
		await order.hsm.sync();
		expect(order.ctx.payment!.hsm.currentState).equals(PaymentDone);

		await order.ctx.shipping!.hsm.sync();
		await order.hsm.sync();
		expect(order.hsm.currentState).equals(Fulfilled);
		expect(order.ctx.shipping!.hsm.currentState).equals(ShippingDone);
	});
});
