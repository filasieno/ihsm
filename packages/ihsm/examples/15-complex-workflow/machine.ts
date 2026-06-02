/**
 * Complex workflow — async submit, Validating + postNow guard, terminal states.
 *
 * Teaches: postNow from onEntry; transition() cleared if only scheduled from onExit/onEntry.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

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
	applyValidation(): void;
	approve(): Promise<void>;
	reject(reason: string): void;
	getStatus(resolve: ihsm.ResolveCallback<OrderPhase>, reject: ihsm.RejectCallback): void;
}

export class CheckoutTop extends PlaygroundTopState<CheckoutCtx, CheckoutProtocol> {
	getStatus(resolve: ihsm.ResolveCallback<OrderPhase>, _reject: ihsm.RejectCallback): void {
		resolve(this.ctx.phase);
	}

	reject(_reason: string): void {
		/* terminal Rejected state — optional manual reason already recorded */
	}
}

@ihsm.InitialState
export class Draft extends CheckoutTop {
	async submit(): Promise<void> {
		this.ctx.phase = 'validating';
		await this.sleep(10);
		this.ctx.validationNotes.push('fraud-check-ok');
		this.transition(Validating);
	}
}

/** Decision pseudo state — guard runs via postNow after entry (hi-priority before normal post). */
export class Validating extends CheckoutTop {
	onEntry(): void {
		this.postNow('applyValidation');
	}

	applyValidation(): void {
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

ihsm.registerStateNames(self);

export function createCheckout(orderId: string, amount: number, limit: number) {
	return ihsm.makeHsm(CheckoutTop, {
		orderId,
		amount,
		limit,
		phase: 'draft',
		validationNotes: [],
	});
}
