import { expect } from 'chai';
import 'mocha';
import { Hsm, HsmFactory, HsmInitialState, HsmTopState, HsmTraceLevel } from '../';
import { TRACE_LEVELS } from './spec.utils';

class Report {
	stateTrace: string[] = [];
}

interface Protocol {
	task(): void;
}

class TopState extends HsmTopState<Report, Protocol> {}

@HsmInitialState
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class A extends TopState {
	onEntry(): void {
		this.ctx.stateTrace.push('A');
	}

	task(): void {
		this.transition(B);
	}
}
class B extends TopState {
	onEntry(): void {
		this.ctx.stateTrace.push('B');
	}

	task(): void {
		this.transition(A);
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Transition cache (traceLevel = ${traceLevel})`, () => {
		let sm: Hsm;
		const factory = new HsmFactory(TopState);
		factory.traceLevel = traceLevel;

		it(`run a process`, async () => {
			const ctx = new Report();
			sm = factory.create(ctx);
			await sm.sync();
			sm.post('task');
			sm.post('task');
			sm.post('task');
			await sm.sync();
			expect(ctx.stateTrace).eqls(['A', 'B', 'A', 'B']);
		});
	});
}
