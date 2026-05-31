import { expect } from 'chai';
import 'mocha';

import { Done, Idle, createFileActor } from './machine';

describe('Tutorial 13: async handlers', () => {
	it('runs open/read/write/close in one async handler without I/O substates', async () => {
		const sm = createFileActor();
		await sm.sync();
		expect(sm.currentState).equals(Idle);

		sm.post('transfer', '/inbox/a.dat', '/archive/a.dat');
		await sm.sync();

		expect(sm.currentState).equals(Done);
		expect(sm.ctx.steps).deep.equals(['open(read)', 'read', 'close(read)', 'open(write)', 'write', 'close(write)']);
		expect(sm.ctx.bytesWritten).equals(Buffer.from('payload-bytes', 'utf8').length);
	});

	it('stays in Idle for the whole await chain — only then transitions', async () => {
		const sm = createFileActor();
		await sm.sync();

		sm.post('transfer', '/a', '/b');
		// Handler is async; sync waits until open/read/write/close finish + transition.
		await sm.sync();
		expect(sm.currentState).equals(Done);
	});
});
