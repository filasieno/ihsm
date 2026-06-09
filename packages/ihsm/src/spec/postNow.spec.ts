import { expect } from 'chai';
import 'mocha';

import { State, InitialState, TopState } from '../';
import { TestPort, TestActor, makeTestActor } from '../testing';
import { TRACE_LEVELS, traceActorOnPort } from './spec.utils';

interface Ctx {
	order: string[];
}

interface Protocol {
	run(): void;
	hi(): void;
	lo(): void;
	enqueueBoth(): void;
}

@InitialState
class HsmTop extends TopState<Ctx, Protocol> implements Protocol {
	run(): void {
		this.ctx.order.push('run');
	}
	hi(): void {
		this.ctx.order.push('hi');
	}
	lo(): void {
		this.ctx.order.push('lo');
	}
	enqueueBoth(): void {
		this.ctx.order.push('enqueue-start');
		this.post('lo');
		this.postNow('hi');
		this.ctx.order.push('enqueue-end');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`postNow (traceLevel = ${traceLevel})`, () => {
		let sm: TestActor<Ctx, Protocol, {}, TestPort>;
		let port: TestPort;

		beforeEach(async () => {
			port = new TestPort();
			sm = makeTestActor(HsmTop, { order: [] }, port, { traceLevel });
			traceActorOnPort(sm, port);
			await sm.sync();
		});

		it('dispatches hi-priority events before normal post from the same handler', async () => {
			sm.post('enqueueBoth');
			await sm.sync();
			await sm.sync();
			expect(sm.ctx.order).eqls(['enqueue-start', 'enqueue-end', 'hi', 'lo']);
			// post/postNow both notify observers in invocation order (the handler posts lo then hi).
			expect(port.events).eqls(['enqueueBoth', 'lo', 'hi']);
		});

		it('dispatches hi-priority events before already-queued normal posts from the same handler', async () => {
			sm.post('lo');
			sm.post('enqueueBoth');
			await sm.sync();
			await sm.sync();
			expect(sm.ctx.order).eqls(['lo', 'enqueue-start', 'enqueue-end', 'hi', 'lo']);
		});

		it('can be invoked on the handler view when the actor is idle', async () => {
			const handler = sm as unknown as State<Ctx, Protocol>;
			handler.postNow('run');
			await sm.sync();
			expect(sm.ctx.order).eqls(['run']);
		});
	});
}
