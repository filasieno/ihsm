import { expect } from 'chai';
import 'mocha';

import { LocalDelivery, RemoteDelivery, createRouter } from './machine';

describe('Tutorial 16: then', () => {
	it('routes locally when weight is within the limit', async () => {
		const sm = createRouter(500);
		await sm.sync();

		sm.post('weigh', 200);
		await sm.sync();

		expect(sm.currentState).equals(LocalDelivery);
		expect(sm.ctx.route).equals('local');
		expect(sm.ctx.audit).to.deep.equal(['weighed', 'decide', 'local']);
	});

	it('routes remotely when weight exceeds the limit', async () => {
		const sm = createRouter(500);
		await sm.sync();

		sm.post('weigh', 800);
		await sm.sync();

		expect(sm.currentState).equals(RemoteDelivery);
		expect(sm.ctx.route).equals('remote');
		expect(sm.ctx.audit).to.deep.equal(['weighed', 'decide', 'remote']);
	});
});
