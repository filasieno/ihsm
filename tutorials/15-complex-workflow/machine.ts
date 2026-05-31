import { makeHsm, HsmInitialState, HsmRejectCallback, HsmResolveCallback, HsmTopState } from '../../src';

export type OrderPhase = 'draft' | 'validating' | 'approved' | 'rejected' | 'completed';

export interface CheckoutCtx {
	orderId: string;
	amount: number;
	limit: number;
	phase: OrderPhase;
	validationNotes: string[];
}

export interface CheckoutProtocol {
	submit(): Promise<void>;
	approve(): Promise<void>;
	reject(reason: string): void;
	getStatus(resolve: HsmResolveCallback<OrderPhase>, reject: HsmRejectCallback): void;
}

export class CheckoutTop extends HsmTopState<CheckoutCtx, CheckoutProtocol> {
	getStatus(resolve: HsmResolveCallback<OrderPhase>, _reject: HsmRejectCallback): void {
		resolve(this.ctx.phase);
	}

	reject(_reason: string): void {
		/* terminal Rejected state — optional manual reason already recorded */
	}
}

@HsmInitialState
export class Draft extends CheckoutTop {
	async submit(): Promise<void> {
		this.ctx.phase = 'validating';
		await this.sleep(10);
		this.ctx.validationNotes.push('fraud-check-ok');
		this.transition(Validating);
	}
}

/** Decision pseudo state — guard runs in `then()` after async validation. */
export class Validating extends CheckoutTop {
	then(): void {
		if (this.ctx.amount <= this.ctx.limit) {
			this.transition(Approved);
		} else {
			this.ctx.phase = 'rejected';
			this.ctx.validationNotes.push('over-limit');
			this.transition(Rejected);
		}
	}
}

export class Approved extends CheckoutTop {
	async approve(): Promise<void> {
		this.ctx.phase = 'approved';
		this.transition(Completing);
	}
}

export class Rejected extends CheckoutTop {}

export class Completing extends CheckoutTop {
	async onEntry(): Promise<void> {
		await this.sleep(10);
		this.ctx.phase = 'completed';
	}
}

export function createCheckout(orderId: string, amount: number, limit: number) {
	return makeHsm(CheckoutTop, {
		orderId,
		amount,
		limit,
		phase: 'draft',
		validationNotes: [],
	});
}
