import { expect } from 'chai';
import 'mocha';
import { Hsm, HsmAny, HsmFactory, HsmFatalErrorState, HsmInitialState, HsmTopState, HsmTraceLevel } from '../';
import { clearLastError, createTestDispatchErrorCallback, TRACE_LEVELS } from './spec.utils';

type Cons = new () => TopState;

interface Protocol {
	transitionTo(s: Cons): void;
}

class TopState extends HsmTopState<HsmAny, Protocol> implements Protocol {
	transitionTo(s: Cons): void {
		this.transition(s);
	}
}

class A extends TopState {
	onEntry(): void {
		throw new Error('A fatal error');
	}
}

@HsmInitialState
class B extends TopState {}

class C extends TopState {
	onExit(): void {
		throw new Error('A fatal error');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`A transition that throws an error (traceLevel = ${traceLevel})`, function(): void {
		let sm: Hsm<HsmAny, Protocol>;
		const factory = new HsmFactory(TopState);

		beforeEach(async () => {
			factory.traceLevel = traceLevel;
			factory.dispatchErrorCallback = createTestDispatchErrorCallback(true);
			clearLastError();
			sm = factory.create({});
			await sm.sync();
		});

		it(`logs an error from the exit() callback and moves the state machine to the 'FatalErrorState' (traceLevel = ${traceLevel as HsmTraceLevel})`, async () => {
			expect(sm.currentState).equals(B);

			sm.post('transitionTo', C);
			await sm.sync();

			expect(sm.currentState).equals(C);
			sm.post('transitionTo', B);
			await sm.sync();

			expect(sm.currentState).equals(HsmFatalErrorState);
		});

		it(`logs an error from the entry() callback and moves the state machine to the 'FatalErrorState' (traceLevel = ${traceLevel as HsmTraceLevel})`, async () => {
			expect(sm.currentState).equals(B);

			sm.post('transitionTo', A);
			await sm.sync();

			expect(sm.currentState).equals(HsmFatalErrorState);
		});
	});
}
