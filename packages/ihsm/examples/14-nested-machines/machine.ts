/**
 * Orthogonal regions — two Hsm actors (payment + shipping) coordinated by OrderCoordinator.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

/** Payment region — own run-to-completion dispatch and transition cache. */
export interface PaymentCtx {
	paid: boolean;
}

export interface PaymentProtocol {
	markPaid(): void;
}

export class PaymentTop extends PlaygroundTopState<PaymentCtx, PaymentProtocol> {
	markPaid(): void {
		this.ctx.paid = true;
		this.transition(PaymentDone);
	}
}

@ihsm.InitialState
export class PaymentPending extends PaymentTop {}

export class PaymentDone extends PaymentTop {}

/** Shipping region — independent lifecycle from payment. */
export interface ShippingCtx {
	shipped: boolean;
}

export interface ShippingProtocol {
	markShipped(): void;
}

export class ShippingTop extends PlaygroundTopState<ShippingCtx, ShippingProtocol> {
	markShipped(): void {
		this.ctx.shipped = true;
		this.transition(ShippingDone);
	}
}

@ihsm.InitialState
export class ShippingWaiting extends ShippingTop {}

export class ShippingDone extends ShippingTop {}

/** Coordinator — not an Hsm; owns two actors and sequences post/sync between them. */
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

ihsm.registerStateNames(self);

export function createOrderCoordinator() {
	return new OrderCoordinator();
}
