import type { TutorialInteractiveMeta } from '../shared/interactive-types';
import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';
import { resumeSessionFromDb, suspendSessionToDb } from './machine';

const SESSION_ID = 'interactive-demo';

const base = singleSenderTutorial({
	title: 'Session machine',
	topState: machine.SessionTop,
	machineExports: machine,
	initialCtx: { userId: 'guest', lastPage: 'home', entryLog: [] },
	messages: [
		{
			id: 'navigate',
			label: 'navigate',
			kind: 'post',
			fields: [{ name: 'page', label: 'Page', type: 'string', default: '/dashboard' }],
		},
	],
	stateSummary: sm => `State: ${sm.currentStateName} · user: ${sm.ctx.userId} · page: ${sm.ctx.lastPage} · entryLog: [${sm.ctx.entryLog.join(', ')}]`,
});

export const interactive: TutorialInteractiveMeta = {
	...base,
	extraActions: [
		{
			id: 'suspend',
			label: 'Suspend session',
			run: async runtime => {
				if (runtime.kind !== 'single') {
					return;
				}
				suspendSessionToDb(SESSION_ID, runtime.sm);
				runtime.writer.lines.push(`↳ suspended session ${SESSION_ID}`);
			},
		},
		{
			id: 'resume',
			label: 'Resume session',
			run: async runtime => {
				if (runtime.kind !== 'single') {
					return;
				}
				const restored = resumeSessionFromDb(SESSION_ID);
				restored.traceWriter = runtime.writer;
				runtime.sm = restored;
				runtime.writer.lines.push(`↳ resumed session ${SESSION_ID} at ${restored.currentStateName}`);
				await restored.sync();
			},
		},
	],
};
