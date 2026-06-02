/**
 * call services — sync and async handlers with resolve/reject injected by runtime.
 *
 * Client: await wallet.call('getBalance') — no resolve/reject in the call arguments.
 */
import * as ihsm from '../../src';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface WalletCtx {
	balance: number;
}

export interface WalletProtocol {
	deposit(amount: number): void;
	getBalance(resolve: ihsm.ResolveCallback<number>, reject: ihsm.RejectCallback): void;
	fetchBalanceDelayed(resolve: ihsm.ResolveCallback<number>, reject: ihsm.RejectCallback, delayMs: number): Promise<void>;
	withdraw(resolve: ihsm.ResolveCallback<number>, reject: ihsm.RejectCallback, amount: number): void;
}

export class WalletTop extends PlaygroundTopState<WalletCtx, WalletProtocol> {
	deposit(amount: number): void {
		this.ctx.balance += amount;
	}

	/** Sync service — call resolve (or reject) before the handler returns. */
	getBalance(resolve: ihsm.ResolveCallback<number>, _reject: ihsm.RejectCallback): void {
		resolve(this.ctx.balance);
	}

	/** Async service — return a Promise; call resolve/reject after await. */
	async fetchBalanceDelayed(resolve: ihsm.ResolveCallback<number>, _reject: ihsm.RejectCallback, delayMs: number): Promise<void> {
		await this.sleep(delayMs);
		resolve(this.ctx.balance);
	}

	/** Sync service with reject — caller's Promise becomes a rejection. */
	withdraw(resolve: ihsm.ResolveCallback<number>, reject: ihsm.RejectCallback, amount: number): void {
		if (amount > this.ctx.balance) {
			reject(new Error('insufficient funds'));
			return;
		}
		this.ctx.balance -= amount;
		resolve(this.ctx.balance);
	}
}

@ihsm.InitialState
export class Open extends WalletTop {}

ihsm.registerStateNames(self);

export function createWallet(initialBalance: number) {
	return ihsm.makeHsm(WalletTop, { balance: initialBalance });
}
