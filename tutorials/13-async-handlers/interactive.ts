import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'File transfer machine',
	topState: machine.FileTop,
	machineExports: machine,
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
