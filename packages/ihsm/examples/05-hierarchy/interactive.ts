import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

const transitionMessages = ['tick', 'goSiblingWest', 'goParentWest', 'goAncestorWest', 'goRoot', 'goSelfWest', 'goCrossToLeafEastB', 'goCrossToBranchEast', 'goCrossToMidEast', 'goSiblingEast', 'goCrossToLeafWestB', 'goAsyncCrossEast', 'armFailExit'] as const;

export const interactive = singleSenderTutorial({
	title: 'Deep hierarchy machine',
	topState: machine.DeepTop,
	machineExports: machine,
	initialCtx: { trace: [], value: 0, failExit: false },
	messages: transitionMessages.map(id => ({ id, label: id, kind: 'notification' as const })),
	stateSummary: sm => `State: ${sm.hsm.currentStateName} · value: ${sm.ctx.value} · ctx.trace lines: ${sm.ctx.trace.length} · failExit: ${sm.ctx.failExit}`,
});
