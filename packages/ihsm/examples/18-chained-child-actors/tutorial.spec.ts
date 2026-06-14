import { expect } from 'chai';
import 'mocha';

import { Active, Failed, Idle, Up, createGateway } from './machine';

describe('Tutorial 18: chained child actors', () => {
	it('spawns a child on activate, relays through child.call, and tears down on deactivate', async () => {
		const gateway = createGateway();
		await gateway.hsm.sync();

		expect(gateway.hsm.currentState).equals(Idle);
		expect(gateway.ctx.link).equals(undefined);

		gateway.notify.activate('edge.example');
		await gateway.hsm.sync();
		await gateway.ctx.link!.hsm.sync();

		expect(gateway.hsm.currentState).equals(Active);
		expect(gateway.ctx.link).to.not.equal(undefined);
		expect(gateway.ctx.link!.hsm.currentState).equals(Up);
		expect(gateway.ctx.linkCtx!.linkUp).equals(true);

		const ok = await gateway.call.relay('ping');
		expect(ok).equals(true);
		expect(gateway.ctx.delivered).equals(1);
		expect(gateway.ctx.linkCtx!.lastPayload).equals('ping');

		gateway.notify.deactivate();
		await gateway.hsm.sync();

		expect(gateway.hsm.currentState).equals(Idle);
		expect(gateway.ctx.link).equals(undefined);
	});

	it('child dial can fail until attempts exceed threshold', async () => {
		const gateway = createGateway();
		gateway.notify.activate('flaky');
		await gateway.hsm.sync();
		await gateway.ctx.link!.hsm.sync();

		const link = gateway.ctx.link!;
		expect(link.hsm.currentState).equals(Up);

		link.notify.open('flaky');
		await link.hsm.sync();
		expect(link.hsm.currentState).equals(Up);

		link.notify.open('flaky');
		await link.hsm.sync();
		expect(link.hsm.currentState).equals(Failed);
		expect(gateway.ctx.linkCtx!.linkUp).equals(false);

		const dropped = await gateway.call.relay('lost');
		expect(dropped).equals(false);
		expect(gateway.ctx.delivered).equals(0);
	});
});
