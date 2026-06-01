import * as ihsm from '../../src';
import * as self from './machine';

/** Payment region */
export interface PaymentCtx {
	paid: boolean;
}

export interface PaymentProtocol {
	markPaid(): void;
}

export class PaymentTop extends ihsm.TopState<PaymentCtx, PaymentProtocol> implements PaymentProtocol {
	markPaid(): void {
		this.ctx.paid = true;
		this.transition(PaymentDone);
	}
}

@ihsm.InitialState
export class PaymentPending extends PaymentTop {}

export class PaymentDone extends PaymentTop {}

/** Shipping region */
export interface ShippingCtx {
	shipped: boolean;
}

export interface ShippingProtocol {
	markShipped(): void;
}

export class ShippingTop extends ihsm.TopState<ShippingCtx, ShippingProtocol> implements ShippingProtocol {
	markShipped(): void {
		this.ctx.shipped = true;
		this.transition(ShippingDone);
	}
}

@ihsm.InitialState
export class ShippingWaiting extends ShippingTop {}

export class ShippingDone extends ShippingTop {}

/** Coordinator — not an Hsm itself; owns two actors */
export class OrderCoordinator {
	readonly payment: ihsm.Hsm<PaymentCtx, PaymentProtocol>;
	readonly shipping: ihsm.Hsm<ShippingCtx, ShippingProtocol>;

	constructor() {
		this.payment = ihsm.makeHsm(PaymentTop, { paid: false });
		this.shipping = ihsm.makeHsm(ShippingTop, { shipped: false });
	}

	async sync(): Promise<void> {
		await this.payment.sync();
		await this.shipping.sync();
	}

	async fulfill(): Promise<void> {
		this.payment.post('markPaid');
		await this.payment.sync();

		this.shipping.post('markShipped');
		await this.shipping.sync();
	}
}

ihsm.registerStateNames(self); // grabs every exported state automatically

export function createOrderCoordinator() {
	return new OrderCoordinator();
}
