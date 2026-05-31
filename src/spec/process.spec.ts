import { expect } from 'chai';
import 'mocha';
import { Hsm, makeHsm, InitialState, TopState } from '../';
import { clearLastError, TRACE_LEVELS } from './spec.utils';

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

async function sleep(millis: number): Promise<void> {
	return new Promise((resolve: () => void) => {
		setTimeout(() => resolve(), millis);
	});
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
		let sm: Hsm;
		beforeEach(async () => {
			clearLastError();
		});

		it(`run a process`, async () => {
			const ctx = new Report();
			sm = makeHsm(HsmTop, ctx, true, traceLevel);
			await sm.sync();
			expect(sm.currentState).eq(A);
			sm.post('start');
			await sleep(700);
			await sm.sync();
			expect(sm.currentState).eq(End);
			expect(ctx.steps).eqls(['A', 'B', 'Done']);
		});
	});
}
