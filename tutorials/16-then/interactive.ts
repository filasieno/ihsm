import { singleSenderTutorial } from '../shared/interactive-helpers';
import { RouteTop } from './machine';

export const interactive = singleSenderTutorial({
	title: 'Parcel router',
	topState: RouteTop,
	initialCtx: { grams: 0, localLimitGrams: 500, route: '', audit: [] },
	messages: [
		{
			id: 'weigh',
			label: 'weigh',
			kind: 'post',
			fields: [{ name: 'grams', label: 'Weight (g)', type: 'number', default: 300 }],
		},
	],
	stateSummary: sm => `State: ${sm.currentStateName} · grams: ${sm.ctx.grams} · route: ${sm.ctx.route || '(none)'} · audit: [${sm.ctx.audit.join(', ')}]`,
});
