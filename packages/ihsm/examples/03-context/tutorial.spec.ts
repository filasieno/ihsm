import { expect } from 'chai';
import 'mocha';

import { createCounter } from './machine';

describe('Tutorial 03: context', () => {
	it('mutates ctx across events without changing state', async () => {
		const counter = createCounter(10, 5);
		await counter.hsm.sync();

		counter.increment();
		await counter.hsm.sync();
		expect(counter.ctx.value).equals(15);

		counter.decrement();
		await counter.hsm.sync();
		expect(counter.ctx.value).equals(10);

		counter.reset();
		await counter.hsm.sync();
		expect(counter.ctx.value).equals(0);
	});
});
