/**
 * postNow — hi-priority steps before normal post from the same confirm() handler.
 *
 * confirm posts cancel (normal) but lock/capture run via postNow first.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface CheckoutCtx {
	steps: string[];
	committed: boolean;
	cancelled: boolean;
}

export interface CheckoutProtocol {
	confirm(): void;
	lockInventory(): void;
	capturePayment(): void;
	cancel(): void;
}

export class CheckoutTop extends PlaygroundTopState<CheckoutCtx, CheckoutProtocol> {
	confirm(): void {
		this.ctx.steps.push('confirm-start');
		// Extended transition: critical steps must finish before any normal follow-up
		// (including `cancel` posted from the same handler).
		this.post('cancel');
		this.postNow('lockInventory');
		this.postNow('capturePayment');
		this.ctx.steps.push('confirm-end');
		this.transition(Confirmed);
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
	return ihsm.makeHsm(CheckoutTop, {
		steps: [],
		committed: false,
		cancelled: false,
	});
}
