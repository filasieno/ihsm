import { expect } from 'chai';
import 'mocha';
import { FatalErrorState, InitialState, StateClass, TopState, TraceLevel } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './error.transition.spec';
import { clearLastError, createTestDispatchErrorCallback, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

type Cons = StateClass;

interface ErrorTransitionConfig {
	context: Record<string, never>;
	notifications: {
		transitionTo(s: Cons): void;
	};
}

//#region ThisTestSpec
export class HsmTop extends TopState<ErrorTransitionConfig> {
	transitionTo(s: Cons): void {
		this.hsm.transition(s);
	}
}

export class A extends HsmTop {
	onEntry(): void {
		throw new Error('A fatal error');
	}
}

@InitialState
export class B extends HsmTop {}

export class C extends HsmTop {
	onExit(): void {
		throw new Error('A fatal error');
	}
}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`A transition that throws an error (traceLevel = ${traceLevel})`, function (): void {
		let sm: TestActor<ErrorTransitionConfig>;
		let port: TestPort;

		beforeEach(async () => {
			clearLastError();
			port = new TestPort();
			sm = makeTestActor(HsmTop, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
		});

		it(`logs an error from the exit() callback and moves the state machine to the 'FatalErrorState' (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			expect(sm.hsm.currentState).equals(B);

			sm.notify.transitionTo(C);
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(C);
			expect(port.events).to.include('transitionTo');
			sm.notify.transitionTo(B);
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(FatalErrorState);
		});

		it(`logs an error from the entry() callback and moves the state machine to the 'FatalErrorState' (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			expect(sm.hsm.currentState).equals(B);

			sm.notify.transitionTo(A);
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(FatalErrorState);
		});
	});
}
