import { expect } from 'chai';
import 'mocha';
import { Any, FatalErrorState, InitialState, StateClass, TopState, TraceLevel } from '../';
import { TestPort, TestActor, makeTestActor } from '../testing';
import { clearLastError, createTestDispatchErrorCallback, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

type Cons = StateClass<Any, Protocol>;

interface Protocol {
	transitionTo(s: Cons): void;
}

class HsmTop extends TopState<Any, Protocol> implements Protocol {
	transitionTo(s: Cons): void {
		this.transition(s);
	}
}

class A extends HsmTop {
	onEntry(): void {
		throw new Error('A fatal error');
	}
}

@InitialState
class B extends HsmTop {}

class C extends HsmTop {
	onExit(): void {
		throw new Error('A fatal error');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`A transition that throws an error (traceLevel = ${traceLevel})`, function (): void {
		let sm: TestActor<Any, Protocol, {}, TestPort>;
		let port: TestPort;

		beforeEach(async () => {
			clearLastError();
			port = new TestPort();
			sm = makeTestActor(HsmTop, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.sync();
		});

		it(`logs an error from the exit() callback and moves the state machine to the 'FatalErrorState' (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			expect(sm.currentState).equals(B);

			sm.post('transitionTo', C);
			await sm.sync();

			expect(sm.currentState).equals(C);
			expect(port.events).to.include('transitionTo');
			sm.post('transitionTo', B);
			await sm.sync();

			expect(sm.currentState).equals(FatalErrorState);
		});

		it(`logs an error from the entry() callback and moves the state machine to the 'FatalErrorState' (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			expect(sm.currentState).equals(B);

			sm.post('transitionTo', A);
			await sm.sync();

			expect(sm.currentState).equals(FatalErrorState);
		});
	});
}
