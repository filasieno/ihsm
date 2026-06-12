import { expect } from 'chai';
import 'mocha';

import { Closed, Open, createDoor } from './machine';

describe('Tutorial 01: hello state machine', () => {
	it('opens and closes via post', async () => {
		const door = createDoor();
		await door.hsm.sync();

		expect(door.hsm.currentState).equals(Closed);

		door.open();
		await door.hsm.sync();
		expect(door.hsm.currentState).equals(Open);
		expect(door.ctx.openCount).equals(1);

		door.close();
		await door.hsm.sync();
		expect(door.hsm.currentState).equals(Closed);
	});
});
