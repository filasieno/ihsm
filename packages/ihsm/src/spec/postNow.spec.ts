import { expect } from 'chai';
import 'mocha';

import { InitialState, TopState } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './postNow.spec';
import { TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface Ctx {
	order: string[];
}

interface PostNowConfig {
	context: Ctx;
	notifications: {
		run(): void;
		hi(): void;
		lo(): void;
		enqueueBoth(): void;
		kickImmediate(): void;
	};
}

@InitialState
export class HsmTop extends TopState<PostNowConfig> {
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
		this.hsm.actor.lo();
		this.hsm.immediate.hi();
		this.ctx.order.push('enqueue-end');
	}

	kickImmediate(): void {
		this.hsm.immediate.run();
	}
}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`postNow (traceLevel = ${traceLevel})`, () => {
		let sm: TestActor<PostNowConfig>;
		let port: TestPort;
		let ctx: Ctx;

		beforeEach(async () => {
			port = new TestPort();
			ctx = { order: [] };
			sm = makeTestActor(HsmTop, ctx, port, { traceLevel });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
		});

		it('dispatches hi-priority events before normal post from the same handler', async () => {
			sm.enqueueBoth();
			await sm.hsm.sync();
			await sm.hsm.sync();
			expect(ctx.order).eqls(['enqueue-start', 'enqueue-end', 'hi', 'lo']);
			expect(port.events).eqls(['enqueueBoth', 'lo', 'hi']);
		});

		it('dispatches hi-priority events before already-queued normal posts from the same handler', async () => {
			sm.lo();
			sm.enqueueBoth();
			await sm.hsm.sync();
			await sm.hsm.sync();
			expect(ctx.order).eqls(['lo', 'enqueue-start', 'enqueue-end', 'hi', 'lo']);
		});

		it('dispatches hi-priority run via immediate from a handler', async () => {
			sm.kickImmediate();
			await sm.hsm.sync();
			expect(ctx.order).eqls(['run']);
		});
	});
}
