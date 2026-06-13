import { expect } from 'chai';
import 'mocha';

import type { DispatchErrorCallback } from '../';
import { FatalErrorState, InitialState, TopState } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './error.default.spec';
import { clearLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface ErrorDefaultConfig {
	context: Record<string, never>;
	notifications: {
		executeWithError01(): void;
		switchCallback(): void;
	};
}

export class HsmTop extends TopState<ErrorDefaultConfig> {
	executeWithError01(): void {
		throw new Error('This will result in a fatal error');
	}

	async switchCallback(): Promise<void> {
		const defaultCallback = this.hsm.dispatchErrorCallback;
		this.hsm.dispatchErrorCallback = (hsm, msg): void => {
			try {
				defaultCallback(hsm, msg);
			} catch (error) {
				console.log(`Error ${(error as Error).name} has escaped`);
			}
		};
	}
}

@InitialState
export class A extends HsmTop {}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`Error dispatch (traceLevel = ${traceLevel})`, function (): void {
		let sm: TestActor<ErrorDefaultConfig>;
		let port: TestPort;
		let flag = false;
		let defaultCallback: DispatchErrorCallback<ErrorDefaultConfig>;
		let dispatchErrorCallback: DispatchErrorCallback<ErrorDefaultConfig>;

		beforeEach(async () => {
			defaultCallback = makeTestActor(HsmTop, {}, new TestPort(), { traceLevel }).hsm.dispatchErrorCallback;
			dispatchErrorCallback = (hsm, msg): void => {
				try {
					defaultCallback(hsm, msg);
				} catch (error) {
					flag = true;
					console.log(`Error: ${(error as Error).name}`);
				}
			};
			clearLastError();
			flag = false;
			port = new TestPort();
			sm = makeTestActor(HsmTop, {}, port, { traceLevel, dispatchErrorCallback });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
		});

		it(`executes the error callback`, async () => {
			expect(sm.hsm.currentState).equals(A);
			sm.executeWithError01();
			await sm.hsm.sync();
			expect(port.events).to.include('executeWithError01');
			expect(sm.hsm.dispatchErrorCallback).equals(dispatchErrorCallback);
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(flag).eq(true);
			sm.hsm.dispatchErrorCallback = defaultCallback;
			flag = false;

			sm.hsm.restore(A, {});
			sm.switchCallback();
			sm.executeWithError01();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(FatalErrorState);
			expect(flag).eq(false);
		});
	});
}
