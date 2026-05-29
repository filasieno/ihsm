import { expect } from 'chai';
import 'mocha';

import { createReminder } from './machine';

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

describe('Tutorial 09: deferred post', () => {
	it('delivers a message after a delay', async () => {
		const sm = createReminder();
		await sm.sync();

		sm.post('scheduleReminder', 'hello later');
		await sleep(100);
		await sm.sync();

		expect(sm.ctx.message).equals('hello later');
	});
});
