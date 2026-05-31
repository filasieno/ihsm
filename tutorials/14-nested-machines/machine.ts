import { Hsm, makeHsm, HsmInitialState, HsmTopState } from '../../src';

/** Payment region */
export interface PaymentCtx {
	paid: boolean;
}

export interface PaymentProtocol {
	markPaid(): void;
}

export class PaymentTop extends HsmTopState<PaymentCtx, PaymentProtocol> implements PaymentProtocol {
	markPaid(): void {
		this.ctx.paid = true;
		this.transition(PaymentDone);
	}
}

@HsmInitialState
export class PaymentPending extends PaymentTop {}

export class PaymentDone extends PaymentTop {}

/** Shipping region */
export interface ShippingCtx {
	shipped: boolean;
}

export interface ShippingProtocol {
	markShipped(): void;
}

export class ShippingTop extends HsmTopState<ShippingCtx, ShippingProtocol> implements ShippingProtocol {
	markShipped(): void {
		this.ctx.shipped = true;
		this.transition(ShippingDone);
	}
}

@HsmInitialState
export class ShippingWaiting extends ShippingTop {}

export class ShippingDone extends ShippingTop {}

/** Coordinator — not an Hsm itself; owns two actors */
export class OrderCoordinator {
	readonly payment: Hsm<PaymentCtx, PaymentProtocol>;
	readonly shipping: Hsm<ShippingCtx, ShippingProtocol>;

	constructor() {
		this.payment = makeHsm(PaymentTop, { paid: false });
		this.shipping = makeHsm(ShippingTop, { shipped: false });
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

export function createOrderCoordinator() {
	return new OrderCoordinator();
}
