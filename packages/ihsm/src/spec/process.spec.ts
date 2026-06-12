import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, makeOwnerActor, manifestFor, registerStateNames } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';
import { clearLastError, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

class Report {
	steps: string[] = [];
}

interface ProcessConfig extends Config {
	context: Report;
	notifications: {
		start(): void;
		next(): void;
	};
}

const processManifest = manifestFor<ProcessConfig>({
	services: [],
	notifications: ['start', 'next'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = processManifest;
	declare readonly __ihsm: ProcessConfig;

	next(): void {}
}

@InitialState
class A extends HsmTop {
	start(): void {
		this.hsm.defer(500).next();
	}

	next(): void {
		this.hsm.actor.next();
		this.ctx.steps.push('A');
		this.hsm.transition(B);
	}
}
class B extends HsmTop {
	onEntry(): void {
		this.hsm.actor.next();
	}
	next(): void {
		this.ctx.steps.push('B');
		this.hsm.transition(End);
	}
}
class End extends HsmTop {
	onEntry(): void {
		this.ctx.steps.push('Done');
	}
}

registerStateNames({ HsmTop, A, B, End });

for (const traceLevel of TRACE_LEVELS) {
	describe(`Process(traceLevel = ${traceLevel})`, () => {
		let sm: OwnerActor<ProcessConfig>;
		let clock: TestPort<HsmTop>;
		beforeEach(async () => {
			clearLastError();
		});

		it(`run a process`, async () => {
			const ctx = new Report();
			clock = new TestPort<HsmTop>();
			sm = makeOwnerActor(HsmTop as never, ctx, clock, { traceLevel });
			traceActorOnPort(sm, clock);
			await sm.hsm.sync();
			expect(sm.hsm.currentState).eq(A);
			sm.start();
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
