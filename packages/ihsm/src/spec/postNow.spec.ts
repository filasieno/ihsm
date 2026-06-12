import { expect } from 'chai';
import 'mocha';

import { InitialState, TopState, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';
import { TRACE_LEVELS, traceActorOnPort } from './spec.utils';

interface Ctx {
	order: string[];
}

interface PostNowConfig extends Config {
	context: Ctx;
	notifications: {
		run(): void;
		hi(): void;
		lo(): void;
		enqueueBoth(): void;
		kickImmediate(): void;
	};
}

const postNowManifest = manifestFor<PostNowConfig>({
	services: [],
	notifications: ['run', 'hi', 'lo', 'enqueueBoth', 'kickImmediate'],
	internalServices: [],
	internalNotifications: [],
});

@InitialState
class HsmTop extends TopState {
	static readonly manifest = postNowManifest;
	declare readonly __ihsm: PostNowConfig;

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

for (const traceLevel of TRACE_LEVELS) {
	describe(`postNow (traceLevel = ${traceLevel})`, () => {
		let sm: OwnerActor<PostNowConfig>;
		let port: TestPort;

		beforeEach(async () => {
			port = new TestPort();
			sm = makeOwnerActor(HsmTop as never, { order: [] }, port, { traceLevel });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
		});

		it('dispatches hi-priority events before normal post from the same handler', async () => {
			sm.enqueueBoth();
			await sm.hsm.sync();
			await sm.hsm.sync();
			expect(sm.ctx.order).eqls(['enqueue-start', 'enqueue-end', 'hi', 'lo']);
			expect(port.events).eqls(['enqueueBoth', 'lo', 'hi']);
		});

		it('dispatches hi-priority events before already-queued normal posts from the same handler', async () => {
			sm.lo();
			sm.enqueueBoth();
			await sm.hsm.sync();
			await sm.hsm.sync();
			expect(sm.ctx.order).eqls(['lo', 'enqueue-start', 'enqueue-end', 'hi', 'lo']);
		});

		it('dispatches hi-priority run via immediate from a handler', async () => {
			sm.kickImmediate();
			await sm.hsm.sync();
			expect(sm.ctx.order).eqls(['run']);
		});
	});
}
