import { expect } from 'chai';
import 'mocha';

import { AlphaDone, BetaDone, createRequestManager, syncRequestManager } from './machine';

describe('Tutorial 19: request manager', () => {
	it('tracks alpha and beta commands to completion via events only', async () => {
		const manager = createRequestManager();
		await syncRequestManager(manager);

		manager.notify.submit('alpha');
		manager.notify.submit('beta');
		await syncRequestManager(manager);

		const alpha = manager.ctx.children[1]!;
		const beta = manager.ctx.children[2]!;
		await manager.ctx.childPorts[1].advance(50);
		await manager.ctx.childPorts[2].advance(50);
		await syncRequestManager(manager);

		expect(manager.ctx.table[1]).to.deep.equal({ kind: 'alpha', status: 'done' });
		expect(manager.ctx.table[2]).to.deep.equal({ kind: 'beta', status: 'done' });
		expect(alpha.hsm.currentState).equals(AlphaDone);
		expect(beta.hsm.currentState).equals(BetaDone);
		expect(Object.keys(manager.ctx.children)).to.have.length(0);
	});

	it('cancels a running request before the deferred complete fires', async () => {
		const manager = createRequestManager();
		manager.notify.submit('alpha');
		await syncRequestManager(manager);

		const port = manager.ctx.childPorts[1];
		expect(manager.ctx.table[1].status).equals('running');

		manager.notify.cancel(1);
		await syncRequestManager(manager);

		expect(manager.ctx.table[1].status).equals('cancelled');
		expect(Object.keys(manager.ctx.children)).to.have.length(0);

		await port.advance(50);
		await syncRequestManager(manager);
		expect(manager.ctx.table[1].status).equals('cancelled');
	});
});
