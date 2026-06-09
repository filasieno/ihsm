import { expect } from 'chai';
import 'mocha';
import { TopState, InitialState, Any } from '../';
import { TestPort, makeTestActor } from '../testing';
import { clearLastError, TRACE_LEVELS, createTestDispatchErrorCallback, traceActorOnPort } from './spec.utils';

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

			const port = new TestPort();
			const hsm = makeTestActor(HsmTop, initial, port, { initialize: false, traceLevel, dispatchErrorCallback });
			traceActorOnPort(hsm, port);
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

			// The TestPort observed every getValue post across the restores.
			expect(port.events).eqls(['getValue', 'getValue', 'getValue']);
		});
	});
}
