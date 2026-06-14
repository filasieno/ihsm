/**
 * Orthogonal regions — two Hsm actors (payment + shipping) coordinated by OrderCoordinator.
 */
import * as ihsm from '../../src';
import { makeTestActor, type TestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

/** Payment region — own run-to-completion dispatch and transition cache. */
export interface PaymentCtx {
	paid: boolean;
}

export interface PaymentConfig {
	context: PaymentCtx;
	notifications: {
		markPaid(): void;
	};
}

export class PaymentTop extends PlaygroundTopState<PaymentConfig> {
	markPaid(): void {
		this.ctx.paid = true;
		this.hsm.transition(PaymentDone);
	}
}

@ihsm.InitialState
export class PaymentPending extends PaymentTop {}

export class PaymentDone extends PaymentTop {}

/** Shipping region — independent lifecycle from payment. */
export interface ShippingCtx {
	shipped: boolean;
}

export interface ShippingConfig {
	context: ShippingCtx;
	notifications: {
		markShipped(): void;
	};
}

export class ShippingTop extends PlaygroundTopState<ShippingConfig> {
	markShipped(): void {
		this.ctx.shipped = true;
		this.hsm.transition(ShippingDone);
	}
}

@ihsm.InitialState
export class ShippingWaiting extends ShippingTop {}

export class ShippingDone extends ShippingTop {}

/** Coordinator — not an Hsm; owns two actors and sequences notifications/sync between them. */
export class OrderCoordinator {
	readonly payment: TestActor<PaymentConfig>;
	readonly shipping: TestActor<ShippingConfig>;

	constructor() {
		this.payment = makeTestActor(PaymentTop as ihsm.TopStateArg<PaymentConfig>, { paid: false }, new ihsm.Port());
		this.shipping = makeTestActor(ShippingTop as ihsm.TopStateArg<ShippingConfig>, { shipped: false }, new ihsm.Port());
	}

	async sync(): Promise<void> {
		await this.payment.hsm.sync();
		await this.shipping.hsm.sync();
	}

	async fulfill(): Promise<void> {
		this.payment.notify.markPaid();
		await this.payment.hsm.sync();

		this.shipping.notify.markShipped();
		await this.shipping.hsm.sync();
	}
}

ihsm.registerStateNames(self);

export function createOrderCoordinator() {
	return new OrderCoordinator();
}
