import { expect } from 'chai';
import 'mocha';

import { createConn } from './machine';

describe('Tutorial 00: Config and generated handles', () => {
	it('uses flat notification and service methods on the actor', async () => {
		const conn = createConn();
		await conn.hsm.sync();
		expect(conn.hsm.currentStateName).equals('Closed');

		conn.open('example.com');
		await conn.hsm.sync();
		expect(conn.hsm.currentStateName).equals('Open');
		expect(conn.ctx.host).equals('example.com');

		const frames = await conn.fetchFrames(10);
		expect(frames).equals(0);

		conn.close();
		await conn.hsm.sync();
		expect(conn.ctx.host).equals('');
	});
});
