/**
 * call services — sync and async handlers returning Promise directly.
 *
 * Client: await wallet.getBalance() — no resolve/reject in handler signatures.
 */
import * as ihsm from '../../src';
import { makeTestActor } from '../../src/testing';
import { PlaygroundTopState } from '../shared/playground-top';
import * as self from './machine';

export interface WalletCtx {
	balance: number;
}

export interface WalletConfig {
	context: WalletCtx;
notifications: {
		deposit(amount: number): void;
	};
	services: {
		getBalance(): Promise<number>;
		fetchBalanceDelayed(delayMs: number): Promise<number>;
		withdraw(amount: number): Promise<number>;
	};
}


export class WalletTop extends PlaygroundTopState<WalletConfig> {

	deposit(amount: number): void {
		this.ctx.balance += amount;
	}

	getBalance(): number {
		return this.ctx.balance;
	}

	async fetchBalanceDelayed(delayMs: number): Promise<number> {
		await new Promise<void>(resolve => (this.hsm.port as unknown as ihsm.Port).setTimeout(resolve, delayMs));
		return this.ctx.balance;
	}

	withdraw(amount: number): number {
		if (amount > this.ctx.balance) {
			throw new Error('insufficient funds');
		}
		this.ctx.balance -= amount;
		return this.ctx.balance;
	}
}

@ihsm.InitialState
export class Open extends WalletTop {}

ihsm.registerStateNames(self);

export function createWallet(initialBalance: number) {
	return makeTestActor(WalletTop, { balance: initialBalance }, new ihsm.Port());
}
