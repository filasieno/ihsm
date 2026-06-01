import { expect } from 'chai';
import 'mocha';

import { Working, createWorker } from './machine';

describe('Tutorial 12: error recovery', () => {
	it('recovers from handler errors via onError', async () => {
		const worker = createWorker();
		await worker.sync();

		worker.post('risky');
		await worker.sync();
		expect(worker.currentState).equals(Working);
		expect(worker.ctx.recovered).equals(1);
		expect(worker.ctx.failures).equals(1);
	});

	it('handles unknown events via onUnhandled', async () => {
		const worker = createWorker();
		await worker.sync();

		worker.post('unknown');
		await worker.sync();
		expect(worker.ctx.failures).equals(1);
	});
});
