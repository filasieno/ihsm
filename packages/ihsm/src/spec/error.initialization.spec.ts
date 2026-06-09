import { expect } from 'chai';
import 'mocha';
import { Any, InitializationError, InitialState, TopState } from '../';
import { TestPort, TestActor, makeTestActor } from '../testing';

import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, traceActorOnPort } from './spec.utils';

class HsmTop extends TopState {}
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
		let sm: TestActor<Any, undefined, {}, TestPort>;

		beforeEach(async () => {
			clearLastError();
			sm = makeTestActor(HsmTop, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.sync();
		});

		it(`moves the state machine to FatalErrorState`, async () => {
			const port = new TestPort();
			sm = makeTestActor(HsmTop, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.sync();
			expect(sm.currentStateName).equals('FatalErrorState');
			expect(getLastError()).instanceOf(InitializationError);
			// Initialization failed before any event was posted, so the TestPort recorded nothing.
			expect(port.count).equals(0);
		});
	});
}
