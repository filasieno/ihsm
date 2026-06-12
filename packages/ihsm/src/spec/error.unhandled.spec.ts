import { expect } from 'chai';
import 'mocha';
import { FatalErrorState, InitialState, RuntimeError, StateClass, TopState, UnhandledEventError, makeOwnerActor, manifestFor, registerStateNames } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

type State = StateClass<Record<string, never>, Record<string, unknown>>;

interface UnhandledConfig extends Config {
	context: Record<string, never>;
	notifications: {
		hello(): void;
		transitionTo(s: State): void;
	};
}

const unhandledManifest = manifestFor<UnhandledConfig>({
	services: [],
	notifications: ['hello', 'transitionTo'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = unhandledManifest;
	declare readonly __ihsm: UnhandledConfig;

	onUnhandled<EventName extends keyof UnhandledConfig['notifications']>(error: UnhandledEventError<Record<string, never>, UnhandledConfig['notifications'], EventName>): Promise<void> | void {
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

class A extends HsmTop {
	hello(): void {
		this.hsm.unhandled();
	}
}

class C extends HsmTop {
	onUnhandled<EventName extends keyof UnhandledConfig['notifications']>(error: UnhandledEventError<Record<string, never>, UnhandledConfig['notifications'], EventName>): Promise<void> | void {
		console.log(`error: ${error}`);
		throw new Error('Unhandled throws');
	}
}

class E extends HsmTop {
	onEntry(): Promise<void> | void {
		throw new Error('Unhandled throws in a transition');
	}
}

class F extends HsmTop {}

class G extends HsmTop {
	onError<EventName extends keyof UnhandledConfig['notifications']>(error: RuntimeError<Record<string, never>, UnhandledConfig['notifications'], EventName>): Promise<void> | void {
		console.log(`error: ${error}`);
		console.log('recovered');
	}

	async onUnhandled<EventName extends keyof UnhandledConfig['notifications']>(error: UnhandledEventError<Record<string, never>, UnhandledConfig['notifications'], EventName>): Promise<void> {
		console.log(`error: ${error}`);
		throw new Error('Error to recover');
	}
}

class H extends HsmTop {
	hello(): void {
		this.hsm.unhandled();
	}

	onError<EventName extends keyof UnhandledConfig['notifications']>(error: RuntimeError<Record<string, never>, UnhandledConfig['notifications'], EventName>): Promise<void> | void {
		console.log(`${error}`);
		throw new Error('Fail now');
	}

	onUnhandled<EventName extends keyof UnhandledConfig['notifications']>(error: UnhandledEventError<Record<string, never>, UnhandledConfig['notifications'], EventName>): Promise<void> | void {
		console.log(`${error}`);
		throw new Error('Error to recover');
	}
}

@InitialState
class B extends HsmTop {}

const emptyTopManifest = manifestFor<{ notifications: { hello(): void } }>({
	services: [],
	notifications: ['hello'],
	internalServices: [],
	internalNotifications: [],
});

class EmptyTopState extends TopState {
	static readonly manifest = emptyTopManifest;
	declare readonly __ihsm: { notifications: { hello(): void } };
}

class WithHello extends EmptyTopState {
	hello(): void {}
}

registerStateNames({ HsmTop, A, B, C, E, F, G, H, EmptyTopState, WithHello });

for (const traceLevel of TRACE_LEVELS) {
	describe(`An unhandled event (traceLevel = ${traceLevel})`, function (): void {
		let sm: OwnerActor<UnhandledConfig>;
		let port: TestPort;

		beforeEach(async () => {
			clearLastError();
			port = new TestPort();
			sm = makeOwnerActor(HsmTop as never, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
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
			const sm = makeOwnerActor(EmptyTopState as never, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			sm.hello();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(getLastError()).instanceOf(RuntimeError);
		});
	});
}
