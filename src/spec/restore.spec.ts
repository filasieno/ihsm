import { expect } from 'chai';
import 'mocha';
import { makeHsm, TopState, InitialState, Any } from '../';
import { clearLastError, TRACE_LEVELS, createTestDispatchErrorCallback } from './spec.utils';

class HsmTop extends TopState {
	getValue(obj: { value: string }): void {
		obj.value = this.ctx.value;
	}
}
@InitialState
class A extends HsmTop {}
@InitialState
class B extends A {}

class C extends HsmTop {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Restore (traceLevel = ${traceLevel})`, () => {
		const dispatchErrorCallback = createTestDispatchErrorCallback(true);

		beforeEach(async () => {
			clearLastError();
		});

		it(`sets the current state and the current context`, async () => {
			const initial = { value: 'initial' };
			const first = { value: 'first' };
			const second = { value: 'second' };

			const hsm = makeHsm(HsmTop, initial, false, traceLevel, undefined, dispatchErrorCallback);
			const query: Any = { value: undefined };
			hsm.post('getValue', query);
			await hsm.sync();
			expect(query.value).equals(initial.value);
			expect(hsm.currentState).equals(HsmTop);

			hsm.restore(B, first);
			hsm.post('getValue', query);
			await hsm.sync();
			expect(query.value).equals(first.value);
			expect(hsm.currentState).equals(B);

			hsm.restore(C, second);
			hsm.post('getValue', query);
			await hsm.sync();
			expect(query.value).equals(second.value);
			expect(hsm.currentState).equals(C);
		});
	});
}
