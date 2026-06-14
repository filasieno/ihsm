import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './process.spec';
import { clearLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

class Report {
	steps: string[] = [];
}

interface ProcessConfig {
	context: Report;
	notifications: {
		start(): void;
		next(): void;
	};
}

export class HsmTop extends TopState<ProcessConfig> {
	next(): void {}
}

@InitialState
export class A extends HsmTop {
	start(): void {
		this.hsm.port.defer(500).next();
	}

	next(): void {
		this.notify.next();
		this.ctx.steps.push('A');
		this.hsm.transition(B);
	}
}

export class B extends HsmTop {
	onEntry(): void {
		this.notify.next();
	}
	next(): void {
		this.ctx.steps.push('B');
		this.hsm.transition(End);
	}
}

export class End extends HsmTop {
	onEntry(): void {
		this.ctx.steps.push('Done');
	}
}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`Process(traceLevel = ${traceLevel})`, () => {
		let sm: TestActor<ProcessConfig>;
		let clock: TestPort<typeof HsmTop>;
		beforeEach(async () => {
			clearLastError();
		});

		it(`run a process`, async () => {
			const ctx = new Report();
			clock = new TestPort<typeof HsmTop>();
			sm = makeTestActor(HsmTop, ctx, clock, { traceLevel });
			traceActorOnPort(sm, clock);
			await sm.hsm.sync();
			expect(sm.hsm.currentState).eq(A);
			sm.notify.start();
			await sm.hsm.sync();
			clock.advance(500);
			await sm.hsm.sync();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).eq(End);
			expect(ctx.steps).eqls(['A', 'B', 'Done']);
			expect(clock.events[0]).equals('start');
		});
	});
}
