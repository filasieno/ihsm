import { makeHsm, HsmInitialState, HsmRejectCallback, HsmResolveCallback, HsmTopState } from '../../src';

export interface WalletCtx {
	balance: number;
}

export interface WalletProtocol {
	deposit(amount: number): void;
	getBalance(resolve: HsmResolveCallback<number>, reject: HsmRejectCallback): void;
	fetchBalanceDelayed(resolve: HsmResolveCallback<number>, reject: HsmRejectCallback, delayMs: number): Promise<void>;
	withdraw(resolve: HsmResolveCallback<number>, reject: HsmRejectCallback, amount: number): void;
}

export class WalletTop extends HsmTopState<WalletCtx, WalletProtocol> implements WalletProtocol {
	deposit(amount: number): void {
		this.ctx.balance += amount;
	}

	/** Sync service — call resolve (or reject) before the handler returns. */
	getBalance(resolve: HsmResolveCallback<number>, _reject: HsmRejectCallback): void {
		resolve(this.ctx.balance);
	}

	/** Async service — return a Promise; call resolve/reject after await. */
	async fetchBalanceDelayed(resolve: HsmResolveCallback<number>, _reject: HsmRejectCallback, delayMs: number): Promise<void> {
		await this.sleep(delayMs);
		resolve(this.ctx.balance);
	}

	/** Sync service with reject — caller's Promise becomes a rejection. */
	withdraw(resolve: HsmResolveCallback<number>, reject: HsmRejectCallback, amount: number): void {
		if (amount > this.ctx.balance) {
			reject(new Error('insufficient funds'));
			return;
		}
		this.ctx.balance -= amount;
		resolve(this.ctx.balance);
	}
}

@HsmInitialState
export class Open extends WalletTop {}

export function createWallet(initialBalance: number) {
	return makeHsm(WalletTop, { balance: initialBalance });
}
