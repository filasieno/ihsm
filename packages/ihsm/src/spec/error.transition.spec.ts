import { expect } from 'chai';
import 'mocha';
import { FatalErrorState, InitialState, StateClass, TopState, TraceLevel, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';
import { clearLastError, createTestDispatchErrorCallback, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

type Cons = StateClass<Record<string, never>, Record<string, unknown>>;

interface ErrorTransitionConfig extends Config {
	context: Record<string, never>;
	notifications: {
		transitionTo(s: Cons): void;
	};
}

const errorTransitionManifest = manifestFor<ErrorTransitionConfig>({
	services: [],
	notifications: ['transitionTo'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = errorTransitionManifest;
	declare readonly __ihsm: ErrorTransitionConfig;

	transitionTo(s: Cons): void {
		this.hsm.transition(s);
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
		let sm: OwnerActor<ErrorTransitionConfig>;
		let port: TestPort;

		beforeEach(async () => {
			clearLastError();
			port = new TestPort();
			sm = makeOwnerActor(HsmTop as never, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
		});

		it(`logs an error from the exit() callback and moves the state machine to the 'FatalErrorState' (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			expect(sm.hsm.currentState).equals(B);

			sm.transitionTo(C);
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(C);
			expect(port.events).to.include('transitionTo');
			sm.transitionTo(B);
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(FatalErrorState);
		});

		it(`logs an error from the entry() callback and moves the state machine to the 'FatalErrorState' (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			expect(sm.hsm.currentState).equals(B);

			sm.transitionTo(A);
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(FatalErrorState);
		});
	});
}
