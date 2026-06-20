import { TraceLevel } from '../../src';
import { makeTestActor } from '../../src/testing';
import type { TutorialInteractiveMeta } from '../shared/interactive-types';
import { CollectingTraceWriter } from '../shared/trace';
import { registerStateNamesFromExports } from '../shared/state-names';
import * as machine from './machine';
import { OrderTop, createOrder, syncOrderRegions } from './machine';

registerStateNamesFromExports(machine);

export const interactive: TutorialInteractiveMeta = {
	title: 'Order parent actor',
	senders: [{ id: 'order', label: 'Order parent' }],
	messagesBySender: {
		order: [{ id: 'fulfill', label: 'fulfill', kind: 'notification' }],
	},
	afterDispatch: async runtime => {
		await syncOrderRegions(runtime.sm as ReturnType<typeof createOrder>);
	},
	createRuntime: () => {
		const writer = new CollectingTraceWriter();
		const sm = makeTestActor(
			OrderTop,
			{},
			{
				traceLevel: TraceLevel.VERBOSE_DEBUG,
				traceWriter: writer,
			}
		);
		return { kind: 'single', sm, writer };
	},
	stateSummary: runtime => {
		const order = runtime.sm;
		const payment = order.ctx.payment;
		const shipping = order.ctx.shipping;
		const paymentPart = payment ? ` · payment: ${payment.hsm.currentStateName} (paid=${order.ctx.paymentCtx?.paid})` : '';
		const shippingPart = shipping ? ` · shipping: ${shipping.hsm.currentStateName} (shipped=${order.ctx.shippingCtx?.shipped})` : '';
		return `Order: ${order.hsm.currentStateName}${paymentPart}${shippingPart}`;
	},
	extraActions: [
		{
			id: 'syncRegions',
			label: 'Sync parent + children',
			run: async runtime => {
				runtime.writer.lines.push('↳ syncOrderRegions()');
				await syncOrderRegions(runtime.sm as ReturnType<typeof createOrder>);
			},
		},
	],
};
