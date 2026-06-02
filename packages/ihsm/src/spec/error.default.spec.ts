import { expect } from 'chai';
import 'mocha';

import { Hsm, Any, Base, makeHsm, FatalErrorState, InitialState, TopState } from '../';

import { clearLastError, TRACE_LEVELS } from './spec.utils';

interface Protocol {
	executeWithError01(): void;
	switchCallback(): void;
}

class HsmTop extends TopState<Any, Protocol> implements Protocol {
	executeWithError01(): void {
		throw new Error('This will result in a fatal error');
	}

	async switchCallback(): Promise<void> {
		const defaultCallback = this.dispatchErrorCallback;
		this.dispatchErrorCallback = (hsm: Base<Any, Protocol>, msg: any): void => {
			try {
				defaultCallback(hsm, msg);
			} catch (error) {
				console.log(`Error ${(error as Error).name} has escaped`);
			}
		};
	}
}

@InitialState
class A extends HsmTop {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Error dispatch (traceLevel = ${traceLevel})`, function (): void {
		let sm: Hsm<Any, Protocol>;
		let flag = false;
		let defaultCallback: (hsm: Base<Any, Protocol>, msg: any) => void;
		let dispatchErrorCallback: (hsm: Base<Any, Protocol>, msg: any) => void;

		beforeEach(async () => {
			defaultCallback = makeHsm(HsmTop, {}, true, traceLevel).dispatchErrorCallback;
			dispatchErrorCallback = (hsm: Base<Any, Protocol>, msg: any): void => {
				try {
					defaultCallback(hsm, msg);
				} catch (error) {
					flag = true;
					console.log(`Error: ${(error as Error).name}`);
				}
			};
			clearLastError();
			flag = false;
			sm = makeHsm(HsmTop, {}, true, traceLevel, undefined, dispatchErrorCallback);
			await sm.sync();
		});

		it(`executes the error callback`, async () => {
			expect(sm.currentState).equals(A);
			sm.post('executeWithError01');
			await sm.sync();
			expect(sm.dispatchErrorCallback).equals(dispatchErrorCallback);
			expect(sm.currentState).equals(FatalErrorState);
			expect(flag).eq(true);
			sm.dispatchErrorCallback = defaultCallback;
			flag = false;

			sm.restore(A, {});
			sm.post('switchCallback');
			sm.post('executeWithError01');
			await sm.sync();
			expect(sm.currentState).equals(FatalErrorState);
			expect(flag).eq(false);
		});
	});
}
