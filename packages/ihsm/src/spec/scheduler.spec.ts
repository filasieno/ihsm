import { expect } from 'chai';
import 'mocha';

import { YIELD_TASK_BUDGET, YIELD_TIME_BUDGET_MS, nowMs, yieldToMacrotask } from '../internal/scheduler';

describe('scheduler', () => {
	it('nowMs returns a non-negative number', () => {
		expect(nowMs()).to.be.a('number').and.at.least(0);
	});

	it('exports cooperative yield budgets', () => {
		expect(YIELD_TASK_BUDGET).equals(64);
		expect(YIELD_TIME_BUDGET_MS).equals(5);
	});

	it('yieldToMacrotask invokes the callback asynchronously', async () => {
		let ran = false;
		await new Promise<void>(resolve => {
			yieldToMacrotask(() => {
				ran = true;
				resolve();
			});
		});
		expect(ran).equals(true);
	});
});
