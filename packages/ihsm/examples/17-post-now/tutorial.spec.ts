import { expect } from 'chai';
import 'mocha';

import { Confirmed, createCheckout } from './machine';

describe('Tutorial 17: postNow', () => {
	it('runs hi-priority steps before normal posts from the same handler', async () => {
		const sm = createCheckout();
		await sm.hsm.sync();

		sm.confirm();
		await sm.hsm.sync();
		await sm.hsm.sync();

		expect(sm.hsm.currentState).equals(Confirmed);
		expect(sm.ctx.committed).equals(true);
		expect(sm.ctx.cancelled).equals(true);
		expect(sm.ctx.steps).to.deep.equal(['confirm-start', 'confirm-end', 'lock', 'capture', 'cancel']);
	});
});
