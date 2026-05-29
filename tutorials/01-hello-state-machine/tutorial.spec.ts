import { expect } from 'chai';
import 'mocha';

import { Closed, Open, createDoor } from './machine';

describe('Tutorial 01: hello state machine', () => {
	it('opens and closes via post', async () => {
		const door = createDoor();
		await door.sync();

		expect(door.currentState).equals(Closed);

		door.post('open');
		await door.sync();
		expect(door.currentState).equals(Open);
		expect(door.ctx.openCount).equals(1);

		door.post('close');
		await door.sync();
		expect(door.currentState).equals(Closed);
	});
});
