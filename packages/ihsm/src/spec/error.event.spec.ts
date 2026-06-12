import { expect } from 'chai';
import 'mocha';
import { EventHandlerError, FatalErrorState, InitialState, StateClass, TopState, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';

import { clearLastError, createTestDispatchErrorCallback, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

type State = StateClass<Record<string, never>, Record<string, unknown>>;

interface ErrorEventConfig extends Config {
	context: Record<string, never>;
	notifications: {
		executeWithError01(): void;
		executeWithError02(): void;
		executeWithError03(): void;
		executeWithError04(): void;
		executeWithError05(): void;
		transitionTo(s: State): void;
	};
}

const errorEventManifest = manifestFor<ErrorEventConfig>({
	services: [],
	notifications: ['executeWithError01', 'executeWithError02', 'executeWithError03', 'executeWithError04', 'executeWithError05', 'transitionTo'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = errorEventManifest;
	declare readonly __ihsm: ErrorEventConfig;

	transitionTo(s: State): void {
		this.hsm.transition(s);
	}

	executeWithError01(): void {
		throw new Error('error 01');
	}

	executeWithError02(): void {
		throw new Error('error 02');
	}

	executeWithError03(): void {
		throw new Error('error 03');
	}

	executeWithError04(): void {
		throw new Error('error 04');
	}

	executeWithError05(): void {
		throw new Error('error 05');
	}
}

class NoRecovery extends HsmTop {}

@InitialState
class Recovery extends HsmTop {
	async onError<EventName extends keyof ErrorEventConfig['notifications']>(err: EventHandlerError<Record<string, never>, ErrorEventConfig['notifications'], EventName>): Promise<void> {
		switch (err.eventName) {
			case 'executeWithError01':
				return;
			case 'executeWithError02':
				this.hsm.transition(B);
				return;
			case 'executeWithError03':
				throw new Error('Error in onError()');
			case 'executeWithError04':
				this.hsm.transition(C);
				break;
			case 'executeWithError05':
				throw new Error('Error in onError()');
		}
		await this.hsm.sleep(1000);
	}
}

class B extends Recovery {}

class C extends Recovery {
	onEntry(): Promise<void> | void {
		throw new Error('Create a transition error during error recovery');
	}
}

class D extends Recovery {
	onExit(): Promise<void> | void {
		throw new Error('Transition failed while going to fatal error state');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Error event (traceLevel = ${traceLevel})`, function (): void {
		let sm: OwnerActor<ErrorEventConfig>;
		let port: TestPort;

		beforeEach(async () => {
			clearLastError();
			port = new TestPort();
			sm = makeOwnerActor(HsmTop as never, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
		});

		it(`recovers a number error`, async () => {
			expect(sm.hsm.currentState).equals(Recovery);
			sm.executeWithError01();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(Recovery);
			expect(port.events).to.include('executeWithError01');

			sm.executeWithError02();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(B);
		});

		it(`it does not recover`, async () => {
			expect(sm.hsm.currentState).equals(Recovery);
			sm.transitionTo(NoRecovery);
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(NoRecovery);
			sm.executeWithError01();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
		});

		it(`it does not recover: Error in onError()`, async () => {
			expect(sm.hsm.currentState).equals(Recovery);
			sm.executeWithError03();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
		});

		it(`it does not recover: Error in a transition following onError()`, async () => {
			expect(sm.hsm.currentState).equals(Recovery);
			sm.executeWithError04();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
		});

		it(`it does not recover: another error is thrown while going to the FatalErrorState`, async () => {
			expect(sm.hsm.currentState).equals(Recovery);
			sm.transitionTo(D);
			sm.executeWithError05();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
		});
	});
}
