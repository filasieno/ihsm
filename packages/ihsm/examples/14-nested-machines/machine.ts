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

export interface PaymentConfig extends ihsm.Config {
	context: PaymentCtx;
	notifications: {
		markPaid(): void;
	};
}

const paymentManifest = ihsm.manifestFor<PaymentConfig>({
	services: [],
	notifications: ['markPaid'],
	internalServices: [],
	internalNotifications: [],
});

export class PaymentTop extends PlaygroundTopState<PaymentConfig> {
	static readonly manifest = paymentManifest;
	declare readonly __ihsm: PaymentConfig;

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

export interface ShippingConfig extends ihsm.Config {
	context: ShippingCtx;
	notifications: {
		markShipped(): void;
	};
}

const shippingManifest = ihsm.manifestFor<ShippingConfig>({
	services: [],
	notifications: ['markShipped'],
	internalServices: [],
	internalNotifications: [],
});

export class ShippingTop extends PlaygroundTopState<ShippingConfig> {
	static readonly manifest = shippingManifest;
	declare readonly __ihsm: ShippingConfig;

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
	readonly payment: ihsm.OwnerActor<PaymentConfig>;
	readonly shipping: ihsm.OwnerActor<ShippingConfig>;

	constructor() {
		this.payment = ihsm.makeOwnerActor(PaymentTop as ihsm.TopStateArg<PaymentConfig>, { paid: false }, new ihsm.Port()) as ihsm.OwnerActor<PaymentConfig>;
		this.shipping = ihsm.makeOwnerActor(ShippingTop as ihsm.TopStateArg<ShippingConfig>, { shipped: false }, new ihsm.Port()) as ihsm.OwnerActor<ShippingConfig>;
	}

	async sync(): Promise<void> {
		await this.payment.hsm.sync();
		await this.shipping.hsm.sync();
	}

	async fulfill(): Promise<void> {
		this.payment.markPaid();
		await this.payment.hsm.sync();

		this.shipping.markShipped();
		await this.shipping.hsm.sync();
	}
}

ihsm.registerStateNames(self);

export function createOrderCoordinator() {
	return new OrderCoordinator();
}
