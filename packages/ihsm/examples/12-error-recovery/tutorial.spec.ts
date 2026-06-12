import { expect } from 'chai';
import 'mocha';

import { Working, createWorker } from './machine';

describe('Tutorial 12: error recovery', () => {
	it('recovers from handler errors via onError', async () => {
		const worker = createWorker();
		await worker.hsm.sync();

		worker.risky();
		await worker.hsm.sync();
		expect(worker.hsm.currentState).equals(Working);
		expect(worker.ctx.recovered).equals(1);
		expect(worker.ctx.failures).equals(1);
	});

	it('handles unknown events via onUnhandled', async () => {
		const worker = createWorker();
		await worker.hsm.sync();

		worker.unknown();
		await worker.hsm.sync();
		expect(worker.ctx.failures).equals(1);
	});
});
