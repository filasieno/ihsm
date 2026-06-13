import { expect } from 'chai';
import 'mocha';
import { EventHandlerError, FatalErrorState, InitialState, StateClass, TopState} from '../';
import type { ActorNotificationsOf } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './error.event.spec';
import { clearLastError, createTestDispatchErrorCallback, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

type State = StateClass;

interface ErrorEventConfig {
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

export class HsmTop extends TopState<ErrorEventConfig> {

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

export class NoRecovery extends HsmTop {}

@InitialState
export class Recovery extends HsmTop {
	async onError<EventName extends keyof ActorNotificationsOf<ErrorEventConfig>>(err: EventHandlerError<ErrorEventConfig, EventName>): Promise<void> {
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
		await new Promise<void>(resolve => setTimeout(resolve, 1000));
	}
}

export class B extends Recovery {}

export class C extends Recovery {
	onEntry(): Promise<void> | void {
		throw new Error('Create a transition error during error recovery');
	}
}

export class D extends Recovery {
	onExit(): Promise<void> | void {
		throw new Error('Transition failed while going to fatal error state');
	}
}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`Error event (traceLevel = ${traceLevel})`, function (): void {
		let sm: TestActor<ErrorEventConfig>;
		let port: TestPort;

		beforeEach(async () => {
			clearLastError();
			port = new TestPort();
			sm = makeTestActor(HsmTop, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
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
