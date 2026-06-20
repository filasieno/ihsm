/**
 * Parallel regions — Order parent actor owns payment and shipping child actors.
 * Parent/child coordination uses notifications only (no cross-actor call/await).
 */
import * as ihsm from '../../src';
import type { ChildActor } from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

/** Events children fire back to the order parent (wired at spawn). */
export interface OrderRegionEvents {
	paymentDone(): void;
	shippingDone(): void;
}

/** Payment child — own queue and transition cache. */
export interface PaymentCtx {
	paid: boolean;
	orderEvents?: OrderRegionEvents;
}

export interface PaymentConfig {
	context: PaymentCtx;
	internalNotifications: {
		markPaid(): void;
	};
}

export class PaymentTop extends PlaygroundTopState<PaymentConfig> {
	markPaid(): void {
		this.ctx.paid = true;
		this.hsm.transition(PaymentDone);
		this.ctx.orderEvents?.paymentDone();
	}
}

@ihsm.InitialState
export class PaymentPending extends PaymentTop {}

export class PaymentDone extends PaymentTop {}

/** Shipping child — independent lifecycle from payment. */
export interface ShippingCtx {
	shipped: boolean;
	orderEvents?: OrderRegionEvents;
}

export interface ShippingConfig {
	context: ShippingCtx;
	internalNotifications: {
		markShipped(): void;
	};
}

export class ShippingTop extends PlaygroundTopState<ShippingConfig> {
	markShipped(): void {
		this.ctx.shipped = true;
		this.hsm.transition(ShippingDone);
		this.ctx.orderEvents?.shippingDone();
	}
}

@ihsm.InitialState
export class ShippingWaiting extends ShippingTop {}

export class ShippingDone extends ShippingTop {}

/** Order parent — spawns region children and sequences fulfill via events. */
export interface OrderCtx {
	payment?: ChildActor<PaymentConfig>;
	paymentCtx?: PaymentCtx;
	shipping?: ChildActor<ShippingConfig>;
	shippingCtx?: ShippingCtx;
}

export interface OrderConfig {
	context: OrderCtx;
	notifications: {
		fulfill(): void;
	};
	internalNotifications: {
		beginPayment(): void;
		paymentDone(): void;
		beginShipping(): void;
		shippingDone(): void;
	};
}

export class OrderTop extends PlaygroundTopState<OrderConfig> {
	fulfill(): void {
		this.hsm.transition(Fulfilling);
	}

	beginPayment(): void {
		this.ctx.payment!.notify.markPaid();
	}

	paymentDone(): void {
		this.notifyNow.beginShipping();
	}

	beginShipping(): void {
		this.ctx.shipping!.notify.markShipped();
	}

	shippingDone(): void {
		this.hsm.transition(Fulfilled);
	}

	protected spawnRegions(): void {
		if (this.ctx.payment) {
			return;
		}
		const orderEvents: OrderRegionEvents = {
			paymentDone: () => this.notifyNow.paymentDone(),
			shippingDone: () => this.notifyNow.shippingDone(),
		};
		const paymentCtx: PaymentCtx = { paid: false, orderEvents };
		const shippingCtx: ShippingCtx = { shipped: false, orderEvents };
		this.ctx.paymentCtx = paymentCtx;
		this.ctx.shippingCtx = shippingCtx;
		this.ctx.payment = ihsm.makeChildActor(ihsm.asParentActor(this), PaymentTop, paymentCtx);
		this.ctx.shipping = ihsm.makeChildActor(ihsm.asParentActor(this), ShippingTop, shippingCtx);
	}
}

@ihsm.InitialState
export class Open extends OrderTop {
	onEntry(): void {
		this.spawnRegions();
	}
}

export class Fulfilling extends OrderTop {
	onEntry(): void {
		this.notifyNow.beginPayment();
	}
}

export class Fulfilled extends OrderTop {}

ihsm.registerStateNames(self);

export function createOrder() {
	return makeTestActor(OrderTop, {});
}

/** Drain parent and both region queues (tests / playground). */
export async function syncOrderRegions(order: ReturnType<typeof createOrder>): Promise<void> {
	await order.hsm.sync();
	if (order.ctx.payment) {
		await order.ctx.payment.hsm.sync();
	}
	if (order.ctx.shipping) {
		await order.ctx.shipping.hsm.sync();
	}
	await order.hsm.sync();
}
