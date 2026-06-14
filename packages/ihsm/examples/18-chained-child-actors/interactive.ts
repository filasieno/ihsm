import { singleSenderTutorial } from '../shared/interactive-helpers';
import * as machine from './machine';

export const interactive = singleSenderTutorial({
	title: 'Gateway + owned link child',
	topState: machine.GatewayTop,
	machineExports: machine,
	initialCtx: { host: '', delivered: 0 },
	messages: [
		{ id: 'activate', label: 'activate', kind: 'notification', fields: [{ name: 'host', label: 'host', type: 'string', default: 'edge.example' }] },
		{ id: 'deactivate', label: 'deactivate', kind: 'notification' },
		{ id: 'relay', label: 'relay', kind: 'service', fields: [{ name: 'payload', label: 'payload', type: 'string', default: 'ping' }] },
	],
	stateSummary: sm => {
		const child = sm.ctx.link;
		const linkCtx = sm.ctx.linkCtx;
		const childPart = child && linkCtx ? ` · link: ${child.hsm.currentStateName} (up=${linkCtx.linkUp}, last="${linkCtx.lastPayload}")` : ' · link: (none)';
		return `Gateway state: ${sm.hsm.currentStateName}${childPart} · delivered=${sm.ctx.delivered}`;
	},
});
