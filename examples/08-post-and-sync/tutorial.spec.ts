import { expect } from 'chai';
import 'mocha';

import { createQueueMachine } from './machine';

describe('Tutorial 08: post and sync', () => {
	it('drains multiple external posts with a single sync', async () => {
		const sm = createQueueMachine();
		await sm.sync();

		sm.post('tick');
		sm.post('tick');
		sm.post('done');
		await sm.sync(); // one sync for the whole batch

		expect(sm.ctx.events).to.deep.equal(['tick', 'tick', 'done']);
	});

	it('processes posted events in FIFO order after handler completes', async () => {
		const sm = createQueueMachine();
		await sm.sync();

		sm.post('start');
		await sm.sync(); // handler finishes; chained posts are queued
		await sm.sync(); // drain tick, tick, done

		expect(sm.ctx.events).to.deep.equal(['start', 'tick', 'tick', 'done']);
	});
});
