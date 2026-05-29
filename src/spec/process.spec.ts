import { expect } from 'chai';
import 'mocha';
import { Hsm, HsmFactory, HsmInitialState, HsmStateClass, HsmTopState, HsmTraceLevel, HsmTraceWriter } from '../';
import { clearLastError, TRACE_LEVELS } from './spec.utils';

type State = HsmStateClass<Report>;

class Report {
	steps: string[] = [];
}

interface Protocol {
	start(): Promise<void>;
	next(): Promise<void>;
}

class TopState extends HsmTopState<Report, Protocol> {
	// eslint-disable-next-line @typescript-eslint/no-empty-function
	async next(): Promise<void> {}
}

async function sleep(millis: number): Promise<void> {
	return new Promise((resolve: () => void) => {
		setTimeout(() => resolve(), millis);
	});
}

@HsmInitialState
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class A extends TopState {
	async start(): Promise<void> {
		this.deferredPost(500, 'next');
	}

	async next(): Promise<void> {
		this.post('next');
		this.ctx.steps.push('A');
		this.transition(B);
	}
}
class B extends TopState {
	async onEntry(): Promise<void> {
		this.post('next');
	}
	async next(): Promise<void> {
		this.ctx.steps.push('B');
		this.transition(End);
	}
}
class End extends TopState {
	async onEntry(): Promise<void> {
		this.ctx.steps.push('Done');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Process(traceLevel = ${traceLevel})`, () => {
		let sm: Hsm;
		const factory = new HsmFactory(TopState);
		factory.traceLevel = traceLevel;

		beforeEach(async () => {
			clearLastError();
		});

		it(`run a process`, async () => {
			const ctx = new Report();
			sm = factory.create(ctx);
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
