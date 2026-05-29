import { expect } from 'chai';
import 'mocha';

import {
	Anonymous,
	Authenticated,
	createSession,
	resumeSession,
	resumeSessionFromDb,
	sessionDb,
	suspendSession,
	suspendSessionToDb,
} from './machine';

describe('Tutorial 11: restore', () => {
	beforeEach(() => {
		sessionDb.clear();
	});

	it('suspends to JSON, resumes on a new instance, and continues', async () => {
		const live = createSession('user-42');
		await live.sync();
		expect(live.currentState).equals(Anonymous);
		expect(live.ctx.entryLog).deep.equals(['Anonymous']);

		live.restore(Authenticated, {
			userId: 'user-42',
			lastPage: 'settings',
			entryLog: live.ctx.entryLog,
		});
		live.post('navigate', 'billing');
		await live.sync();
		expect(live.ctx.lastPage).equals('billing');

		const json = suspendSession(live);
		expect(JSON.parse(json)).deep.equals({
			stateName: 'Authenticated',
			ctx: {
				userId: 'user-42',
				lastPage: 'billing',
				entryLog: ['Anonymous'],
			},
		});

		const resumed = resumeSession(json);
		await resumed.sync();
		expect(resumed.currentState).equals(Authenticated);
		expect(resumed.ctx.userId).equals('user-42');
		expect(resumed.ctx.lastPage).equals('billing');
		expect(resumed.ctx.entryLog).deep.equals(['Anonymous']);

		resumed.post('navigate', 'profile');
		await resumed.sync();
		expect(resumed.ctx.lastPage).equals('profile');
	});

	it('suspend to db map and resume after simulated restart', async () => {
		const sessionId = 'sess-7';
		const live = createSession('user-7');
		await live.sync();

		live.restore(Authenticated, {
			userId: 'user-7',
			lastPage: 'dashboard',
			entryLog: live.ctx.entryLog,
		});
		await live.sync();

		suspendSessionToDb(sessionId, live);
		expect(sessionDb.has(sessionId)).equals(true);

		const afterRestart = resumeSessionFromDb(sessionId);
		await afterRestart.sync();
		expect(afterRestart.currentState).equals(Authenticated);
		expect(afterRestart.ctx.lastPage).equals('dashboard');
		expect(afterRestart.ctx.entryLog).deep.equals(['Anonymous']);
	});
});
