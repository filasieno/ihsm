import { expect } from 'chai';
import 'mocha';
import { InitializationError } from '../src/defs';
import * as ihsm from '../src/index';
import { createTestDispatchErrorCallback, getLastError, TRACE_LEVELS } from './spec.utils';

class TopState extends ihsm.BaseTopState {}
@ihsm.initialState
class A extends TopState {}
@ihsm.initialState
class B extends A {
	onEntry(): void {
		throw new Error('Error during initialization');
	}
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Initialization failure (traceLevel = ${traceLevel})`, function(): void {
		let sm: ihsm.Hsm;

		beforeEach(async () => {
			console.log(`Current trace level: ${traceLevel as ihsm.TraceLevel}`);
			ihsm.configureTraceLevel(traceLevel as ihsm.TraceLevel);
			ihsm.configureDispatchErrorCallback(createTestDispatchErrorCallback(true));
		});

		it(`moves the state machine to FatalErrorState`, async () => {
			sm = ihsm.create(TopState, {});
			await sm.sync();
			expect(sm.currentStateName).equals('FatalErrorState');
			expect(getLastError()).instanceOf(InitializationError);
		});
	});
}
