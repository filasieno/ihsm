import { expect } from 'chai';
import 'mocha';

import { createThermostat } from './machine';

describe('Tutorial 04: protocol typing', () => {
	it('accepts correctly typed events', async () => {
		const thermostat = createThermostat(18);
		await thermostat.sync();

		thermostat.post('setTarget', 22);
		await thermostat.sync();
		expect(thermostat.ctx.celsius).equals(22);
	});
});
