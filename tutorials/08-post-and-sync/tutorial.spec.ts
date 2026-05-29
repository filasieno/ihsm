import { expect } from 'chai';
import 'mocha';

import { createQueueMachine } from './machine';

describe('Tutorial 08: post and sync', () => {
	it('processes posted events in FIFO order after handler completes', async () => {
		const sm = createQueueMachine();
		await sm.sync();

		sm.post('start');
		await sm.sync(); // handler finishes; chained posts are queued
		await sm.sync(); // drain tick, tick, done

		expect(sm.ctx.events).to.deep.equal(['start', 'tick', 'tick', 'done']);
	});
});
