import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState } from '../';
import { TestPort, TestActor, makeTestActor } from '../testing';
import { clearLastError, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

class Report {
	steps: string[] = [];
}

interface Protocol {
	start(): Promise<void>;
	next(): Promise<void>;
}

class HsmTop extends TopState<Report, Protocol> {
	async next(): Promise<void> {}
}

@InitialState
class A extends HsmTop {
	async start(): Promise<void> {
		this.deferredPost(500, 'next');
	}

	async next(): Promise<void> {
		this.post('next');
		this.ctx.steps.push('A');
		this.transition(B);
	}
}
class B extends HsmTop {
	async onEntry(): Promise<void> {
		this.post('next');
	}
	async next(): Promise<void> {
		this.ctx.steps.push('B');
		this.transition(End);
	}
}
class End extends HsmTop {
	async onEntry(): Promise<void> {
		this.ctx.steps.push('Done');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Process(traceLevel = ${traceLevel})`, () => {
		let sm: TestActor<Report, Protocol, {}, TestPort<HsmTop>>;
		let clock: TestPort<HsmTop>;
		beforeEach(async () => {
			clearLastError();
		});

		it(`run a process`, async () => {
			const ctx = new Report();
			clock = new TestPort<HsmTop>();
			sm = makeTestActor(HsmTop, ctx, clock, { traceLevel });
			traceActorOnPort(sm, clock);
			await sm.sync();
			expect(sm.currentState).eq(A);
			sm.post('start'); // arms deferredPost(500, 'next')
			await sm.sync();
			clock.advance(500); // fire the deferred tick deterministically — no real waiting
			// sync() is a FIFO barrier; the tick kicks off an immediate post() cascade whose later
			// posts land after the first barrier, so drain to quiescence with a follow-up sync.
			await sm.sync();
			await sm.sync();
			expect(sm.currentState).eq(End);
			expect(ctx.steps).eqls(['A', 'B', 'Done']);
			// The TestPort observed the client `start` post that kicked off the process.
			expect(clock.events[0]).equals('start');
		});
	});
}
