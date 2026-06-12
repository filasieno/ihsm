/**
 * Complex workflow — async submit, Validating + immediate guard, terminal states.
 *
 * Teaches: hsm.immediate from onEntry; transition() cleared if only scheduled from onExit/onEntry.
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

export interface CheckoutConfig extends ihsm.Config {
	context: CheckoutCtx;
	notifications: {
		submit(): Promise<void>;
		applyValidation(): void;
		approve(): Promise<void>;
		reject(reason: string): void;
	};
	services: {
		getStatus(): Promise<OrderPhase>;
	};
}

const checkoutManifest = ihsm.manifestFor<CheckoutConfig>({
	services: ['getStatus'],
	notifications: ['submit', 'applyValidation', 'approve', 'reject'],
	internalServices: [],
	internalNotifications: [],
});

export class CheckoutTop extends PlaygroundTopState<CheckoutConfig> {
	static readonly manifest = checkoutManifest;
	declare readonly __ihsm: CheckoutConfig;

	getStatus(): OrderPhase {
		return this.ctx.phase;
	}

	reject(_reason: string): void {
		/* terminal Rejected state — optional manual reason already recorded */
	}
}

@ihsm.InitialState
export class Draft extends CheckoutTop {
	async submit(): Promise<void> {
		this.ctx.phase = 'validating';
		await this.hsm.sleep(10);
		this.ctx.validationNotes.push('fraud-check-ok');
		this.hsm.transition(Validating);
	}
}

/** Decision pseudo state — guard runs via immediate after entry (hi-priority before normal post). */
export class Validating extends CheckoutTop {
	onEntry(): void {
		this.hsm.immediate.applyValidation();
	}

	applyValidation(): void {
		if (this.ctx.amount <= this.ctx.limit) {
			this.hsm.transition(Approved);
		} else {
			this.ctx.phase = 'rejected';
			this.ctx.validationNotes.push('over-limit');
			this.hsm.transition(Rejected);
		}
	}
}

export class Approved extends CheckoutTop {
	async approve(): Promise<void> {
		this.ctx.phase = 'approved';
		this.hsm.transition(Completing);
	}
}

export class Rejected extends CheckoutTop {}

export class Completing extends CheckoutTop {
	async onEntry(): Promise<void> {
		await this.hsm.sleep(10);
		this.ctx.phase = 'completed';
	}
}

ihsm.registerStateNames(self);

export function createCheckout(orderId: string, amount: number, limit: number) {
	return ihsm.makeOwnerActor(
		CheckoutTop,
		{
			orderId,
			amount,
			limit,
			phase: 'draft',
			validationNotes: [],
		},
		new ihsm.Port(),
	);
}
