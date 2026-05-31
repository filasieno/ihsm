import { singleSenderTutorial } from '../_shared/interactive-helpers';
import { FileTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'File transfer machine',
	topState: FileTop,
	initialCtx: { sourcePath: '', destPath: '', bytesWritten: 0, steps: [] },
	messages: [
		{
			id: 'transfer',
			label: 'transfer',
			kind: 'post',
			fields: [
				{ name: 'from', label: 'Source path', type: 'string', default: '/tmp/source.txt' },
				{ name: 'to', label: 'Dest path', type: 'string', default: '/tmp/dest.txt' },
			],
		},
	],
	stateSummary: sm => `State: ${sm.currentStateName} · bytesWritten: ${sm.ctx.bytesWritten} · steps: [${sm.ctx.steps.join(', ')}]`,
});
