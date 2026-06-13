import { expect } from 'chai';
import 'mocha';
import { FatalErrorState, InitialState, RuntimeError, StateClass, TopState, UnhandledEventError } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import type { ActorNotificationsOf } from '../';
import * as self from './error.unhandled.spec';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

type State = StateClass;

interface UnhandledConfig {
	context: Record<string, never>;
	notifications: {
		hello(): void;
		transitionTo(s: State): void;
	};
}

export class HsmTop extends TopState<UnhandledConfig> {

	onUnhandled<EventName extends keyof ActorNotificationsOf<UnhandledConfig>>(error: UnhandledEventError<UnhandledConfig, EventName>): Promise<void> | void {
		console.log(`${error}`);
		if (this.hsm.currentState === A) {
			this.hsm.transition(B);
		} else {
			this.hsm.transition(A);
		}

		if (this.hsm.currentState === F) {
			this.hsm.transition(E);
		}
	}

	transitionTo(s: State): void {
		this.hsm.transition(s);
	}
}

export class A extends HsmTop {
	hello(): void {
		this.hsm.unhandled();
	}
}

export class C extends HsmTop {
	onUnhandled<EventName extends keyof ActorNotificationsOf<UnhandledConfig>>(error: UnhandledEventError<UnhandledConfig, EventName>): Promise<void> | void {
		console.log(`error: ${error}`);
		throw new Error('Unhandled throws');
	}
}

export class E extends HsmTop {
	onEntry(): Promise<void> | void {
		throw new Error('Unhandled throws in a transition');
	}
}

export class F extends HsmTop {}

export class G extends HsmTop {
	onError<EventName extends keyof ActorNotificationsOf<UnhandledConfig>>(error: RuntimeError<UnhandledConfig, EventName>): Promise<void> | void {
		console.log(`error: ${error}`);
		console.log('recovered');
	}

	async onUnhandled<EventName extends keyof ActorNotificationsOf<UnhandledConfig>>(error: UnhandledEventError<UnhandledConfig, EventName>): Promise<void> {
		console.log(`error: ${error}`);
		throw new Error('Error to recover');
	}
}

export class H extends HsmTop {
	hello(): void {
		this.hsm.unhandled();
	}

	onError<EventName extends keyof ActorNotificationsOf<UnhandledConfig>>(error: RuntimeError<UnhandledConfig, EventName>): Promise<void> | void {
		console.log(`${error}`);
		throw new Error('Fail now');
	}

	onUnhandled<EventName extends keyof ActorNotificationsOf<UnhandledConfig>>(error: UnhandledEventError<UnhandledConfig, EventName>): Promise<void> | void {
		console.log(`${error}`);
		throw new Error('Error to recover');
	}
}

@InitialState
export class B extends HsmTop {}

export class EmptyTopState extends TopState<UnhandledConfig> {
}

export class WithHello extends EmptyTopState {
	hello(): void {}
}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`An unhandled event (traceLevel = ${traceLevel})`, function (): void {
		let sm: TestActor<UnhandledConfig>;
		let port: TestPort;

		beforeEach(async () => {
			clearLastError();
			port = new TestPort();
			sm = makeTestActor(HsmTop, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
		});

		it(`calls onUnhandledEvent`, async () => {
			sm.hello();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(A);
			expect(port.events).eqls(['hello']);
		});

		it(`calls onUnhandledEvent, when an event handler calls unhandled()`, async () => {
			sm.transitionTo(A);
			sm.hello();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(B);
		});

		it(`throws in an onUnhandled()`, async () => {
			sm.transitionTo(C);
			sm.hello();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});

		it(`throws in a transition after onUnhandled()`, async () => {
			sm.transitionTo(F);
			sm.hello();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});

		it(`throws and recovers`, async () => {
			sm.transitionTo(G);
			sm.hello();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(G);
			expect(getLastError()).equals(undefined);
		});

		it(`throws, and it does not recover in a user marked unhandled`, async () => {
			sm.transitionTo(H);
			sm.hello();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});

		it(`the standard onUnhandled throws`, async () => {
			const sm = makeTestActor(EmptyTopState, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			sm.hello();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});
	});
}
