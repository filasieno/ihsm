import { expect } from 'chai';
import 'mocha';
import { InitializationError, InitialState, TopState } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './error.initialization.spec';
import { clearLastError, createTestDispatchErrorCallback, getLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface InitConfig {
	context: Record<string, never>;
}

export class HsmTop extends TopState<InitConfig> {}

@InitialState
export class A extends HsmTop {}

@InitialState
export class B extends A {
	onEntry(): void {
		throw new Error('Error during initialization');
	}
}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`Initialization failure (traceLevel = ${traceLevel})`, function (): void {
		let sm: TestActor<InitConfig>;

		beforeEach(async () => {
			clearLastError();
			sm = makeTestActor(HsmTop, {}, new TestPort(), { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			await sm.hsm.sync();
		});

		it(`moves the state machine to FatalErrorState`, async () => {
			const port = new TestPort();
			sm = makeTestActor(HsmTop, {}, port, { traceLevel, dispatchErrorCallback: createTestDispatchErrorCallback(true) });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
			expect(sm.hsm.currentStateName).equals('FatalErrorState');
			expect(getLastError()).instanceOf(InitializationError);
			expect(port.count).equals(0);
		});
	});
}
