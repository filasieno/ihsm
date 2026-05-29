import { expect } from 'chai';
import 'mocha';

import { Hsm, HsmAny, HsmBase, HsmFactory, HsmFatalErrorState, HsmInitialState, HsmTopState } from '../';

import { clearLastError, TRACE_LEVELS } from './spec.utils';

interface Protocol {
	executeWithError01(): void;
	switchCallback(): void;
}

class TopState extends HsmTopState<HsmAny, Protocol> implements Protocol {
	executeWithError01(): void {
		throw new Error('This will result in a fatal error');
	}

	async switchCallback(): Promise<void> {
		const defaultCallback = this.dispatchErrorCallback;
		this.dispatchErrorCallback = (hsm: HsmBase<HsmAny, Protocol>, msg: any): void => {
			try {
				defaultCallback(hsm, msg);
			} catch (error) {
				console.log(`Error ${error.name} has escaped`);
			}
		};
	}
}

@HsmInitialState
class A extends TopState {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Error dispatch (traceLevel = ${traceLevel})`, function(): void {
		let sm: Hsm<HsmAny, Protocol>;
		const factory = new HsmFactory(TopState);
		let flag = false;
		let defaultCallback: (hsm: HsmBase<HsmAny, Protocol>, msg: any) => void;

		beforeEach(async () => {
			factory.traceLevel = traceLevel;
			defaultCallback = factory.dispatchErrorCallback;
			factory.dispatchErrorCallback = (hsm: HsmBase<HsmAny, Protocol>, msg: any): void => {
				try {
					defaultCallback(hsm, msg);
				} catch (error) {
					flag = true;
					console.log(`Error: ${error.name}`);
				}
			};
			clearLastError();
			sm = factory.create({});
			await sm.sync();
		});

		it(`executes the error callback`, async () => {
			expect(sm.currentState).equals(A);
			sm.post('executeWithError01');
			await sm.sync();
			expect(sm.dispatchErrorCallback).equals(factory.dispatchErrorCallback);
			expect(sm.currentState).equals(HsmFatalErrorState);
			expect(flag).eq(true);
			sm.dispatchErrorCallback = defaultCallback;
			flag = false;

			sm.restore(A, {});
			sm.post('switchCallback');
			sm.post('executeWithError01');
			await sm.sync();
			expect(sm.currentState).equals(HsmFatalErrorState);
			expect(flag).eq(false);
		});
	});
}
