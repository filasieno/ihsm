import { expect } from 'chai';
import 'mocha';

import { createWallet } from './machine';

describe('Tutorial 10: call services', () => {
	it('sync service resolves through call()', async () => {
		const wallet = createWallet(100);
		await wallet.hsm.sync();

		let balance = await wallet.call.getBalance();
		expect(balance).equals(100);

		wallet.notify.deposit(50);
		await wallet.hsm.sync();

		balance = await wallet.call.getBalance();
		expect(balance).equals(150);
	});

	it('async service (Promise handler) resolves through call()', async () => {
		const wallet = createWallet(42);
		await wallet.hsm.sync();

		const balance = await wallet.call.fetchBalanceDelayed(10);
		expect(balance).equals(42);
	});

	it('sync service reject() surfaces as rejected call()', async () => {
		const wallet = createWallet(30);
		await wallet.hsm.sync();

		try {
			await wallet.call.withdraw(100);
			expect.fail('expected withdraw to reject');
		} catch (error) {
			expect((error as Error).message).equals('insufficient funds');
		}

		expect(await wallet.call.getBalance()).equals(30);
	});

	it('sync service resolve() after side effects', async () => {
		const wallet = createWallet(100);
		await wallet.hsm.sync();

		const remaining = await wallet.call.withdraw(40);
		expect(remaining).equals(60);
		expect(await wallet.call.getBalance()).equals(60);
	});
});
