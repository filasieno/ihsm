import { expect } from 'chai';
import 'mocha';
import { HsmFactory, HsmTopState, HsmInitialState, HsmAny } from '../';
import { clearLastError, TRACE_LEVELS, createTestDispatchErrorCallback } from './spec.utils';

class TopState extends HsmTopState {
	getValue(obj: { value: string }): void {
		obj.value = this.ctx.value;
	}
}
@HsmInitialState
class A extends TopState {}
@HsmInitialState
class B extends A {}

class C extends TopState {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Restore (traceLevel = ${traceLevel})`, () => {
		const factory = new HsmFactory(TopState);
		factory.traceLevel = traceLevel;
		factory.dispatchErrorCallback = createTestDispatchErrorCallback(true);

		beforeEach(async () => {
			clearLastError();
		});

		it(`sets the current state and the current context`, async () => {
			const initial = { value: 'initial' };
			const first = { value: 'first' };
			const second = { value: 'second' };

			const hsm = factory.create(initial, false);
			const query: HsmAny = { value: undefined };
			hsm.post('getValue', query);
			await hsm.sync();
			expect(query.value).equals(initial.value);
			expect(hsm.currentState).equals(TopState);

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
