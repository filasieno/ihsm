import { expect } from 'chai';
import 'mocha';
import { InitializationError, InitialState, TopState, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';

import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

interface InitConfig extends Config {
	context: Record<string, never>;
}

const initManifest = manifestFor<InitConfig>({
	services: [],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = initManifest;
	declare readonly __ihsm: InitConfig;
}

@InitialState
class A extends HsmTop {}

@InitialState
// eslint-disable-next-line @typescript-eslint/no-unused-vars
class B extends A {
	onEntry(): void {
		throw new Error('Error during initialization');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Initialization failure (traceLevel = ${traceLevel})`, function (): void {
		let sm: OwnerActor<InitConfig>;

		beforeEach(async () => {
			clearLastError();
			sm = makeOwnerActor(HsmTop as never, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
		});

		it(`moves the state machine to FatalErrorState`, async () => {
			const port = new TestPort();
			sm = makeOwnerActor(HsmTop as never, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
			expect(sm.hsm.currentStateName).equals('FatalErrorState');
			expect(getLastError()).instanceOf(InitializationError);
			// Initialization failed before any event was posted, so the TestPort recorded nothing.
			expect(port.count).equals(0);
		});
	});
}
