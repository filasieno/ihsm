import { expect } from 'chai';
import 'mocha';
import { Hsm, makeHsm, InitialState, TopState } from '../';
import { TRACE_LEVELS } from './spec.utils';

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
		let sm: Hsm;
		it(`run a process`, async () => {
			const ctx = new Report();
			sm = makeHsm(HsmTop, ctx, true, traceLevel);
			await sm.sync();
			sm.post('task');
			sm.post('task');
			sm.post('task');
			await sm.sync();
			expect(ctx.stateTrace).eqls(['A', 'B', 'A', 'B']);
		});
	});
}
