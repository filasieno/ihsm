import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState } from '../';
import { TestPort, TestActor, makeTestActor } from '../testing';
import { TRACE_LEVELS, traceActorOnPort } from './spec.utils';

class Report {
	stateTrace: string[] = [];
}

interface Protocol {
	task(): void;
}

class HsmTop extends TopState<Report, Protocol> {}

@InitialState
class A extends HsmTop {
	onEntry(): void {
		this.ctx.stateTrace.push('A');
	}

	task(): void {
		this.transition(B);
	}
}
class B extends HsmTop {
	onEntry(): void {
		this.ctx.stateTrace.push('B');
	}

	task(): void {
		this.transition(A);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Transition cache (traceLevel = ${traceLevel})`, () => {
		let sm: TestActor<Report, Protocol, {}, TestPort<HsmTop>>;
		it(`run a process`, async () => {
			const ctx = new Report();
			const port = new TestPort<HsmTop>();
			sm = makeTestActor(HsmTop, ctx, port, { traceLevel });
			traceActorOnPort(sm, port);
			await sm.sync();
			sm.post('task');
			sm.post('task');
			sm.post('task');
			await sm.sync();
			expect(ctx.stateTrace).eqls(['A', 'B', 'A', 'B']);
			expect(port.events).eqls(['task', 'task', 'task']);
		});
	});
}
