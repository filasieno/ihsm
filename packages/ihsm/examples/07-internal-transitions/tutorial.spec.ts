import { expect } from 'chai';
import 'mocha';

import { On, createLamp } from './machine';

describe('Tutorial 07: internal transitions', () => {
	it('updates ctx without exit or re-entry', async () => {
		const lamp = createLamp(50);
		await lamp.hsm.sync();
		expect(lamp.hsm.currentState).equals(On);
		const entriesAfterInit = lamp.ctx.entryCount;

		lamp.dim(10);
		await lamp.hsm.sync();
		expect(lamp.ctx.brightness).equals(40);
		expect(lamp.hsm.currentState).equals(On);
		expect(lamp.ctx.entryCount).equals(entriesAfterInit);

		lamp.brighten(25);
		await lamp.hsm.sync();
		expect(lamp.ctx.brightness).equals(65);
		expect(lamp.ctx.entryCount).equals(entriesAfterInit);
	});
});
