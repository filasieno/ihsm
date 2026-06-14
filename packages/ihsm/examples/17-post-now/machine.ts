/**
 * immediate — hi-priority steps before normal actor notifications from the same confirm() handler.
 *
 * confirm schedules cancel (normal) but lock/capture run via immediate first.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface CheckoutCtx {
	steps: string[];
	committed: boolean;
	cancelled: boolean;
}

export interface CheckoutConfig {
	context: CheckoutCtx;
	notifications: {
		confirm(): void;
		lockInventory(): void;
		capturePayment(): void;
		cancel(): void;
	};
}

export class CheckoutTop extends PlaygroundTopState<CheckoutConfig> {
	confirm(): void {
		this.ctx.steps.push('confirm-start');
		// Extended transition: critical steps must finish before any normal follow-up
		// (including `cancel` posted from the same handler).
		this.notify.cancel();
		this.notifyNow.lockInventory();
		this.notifyNow.capturePayment();
		this.ctx.steps.push('confirm-end');
		this.hsm.transition(Confirmed);
	}

	lockInventory(): void {
		this.ctx.steps.push('lock');
	}

	capturePayment(): void {
		this.ctx.steps.push('capture');
		this.ctx.committed = true;
	}

	cancel(): void {
		this.ctx.steps.push('cancel');
		this.ctx.cancelled = true;
	}
}

export class Confirmed extends CheckoutTop {}

@ihsm.InitialState
export class Draft extends CheckoutTop {}

ihsm.registerStateNames(self);

export function createCheckout() {
	return makeTestActor(
		CheckoutTop,
		{
			steps: [],
			committed: false,
			cancelled: false,
		},
		new ihsm.Port()
	);
}
