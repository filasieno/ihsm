import { expect } from 'chai';
import 'mocha';

import { createCounter } from './machine';

describe('Tutorial 03: context', () => {
	it('mutates ctx across events without changing state', async () => {
		const counter = createCounter(10, 5);
		await counter.sync();

		counter.post('increment');
		await counter.sync();
		expect(counter.ctx.value).equals(15);

		counter.post('decrement');
		await counter.sync();
		expect(counter.ctx.value).equals(10);

		counter.post('reset');
		await counter.sync();
		expect(counter.ctx.value).equals(0);
	});
});
