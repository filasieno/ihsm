import { singleSenderTutorial } from '../_shared/interactive-helpers';
import { DeepTop } from './machine';

const transitionMessages = ['tick', 'goSiblingWest', 'goParentWest', 'goAncestorWest', 'goRoot', 'goSelfWest', 'goCrossToLeafEastB', 'goCrossToBranchEast', 'goCrossToMidEast', 'goSiblingEast', 'goCrossToLeafWestB', 'goAsyncCrossEast', 'armFailExit'] as const;

export const interactive = singleSenderTutorial({
	title: 'Deep hierarchy machine',
	topState: DeepTop,
	initialCtx: { trace: [], value: 0, failExit: false },
	messages: transitionMessages.map(id => ({ id, label: id, kind: 'post' as const })),
	stateSummary: sm => `State: ${sm.currentStateName} · value: ${sm.ctx.value} · ctx.trace lines: ${sm.ctx.trace.length} · failExit: ${sm.ctx.failExit}`,
});
