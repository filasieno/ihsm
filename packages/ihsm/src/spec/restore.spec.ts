import { expect } from 'chai';
import 'mocha';
import { TopState, InitialState } from '../';
import { makeTestActor, TestPort } from '../testing';
import * as self from './restore.spec';
import { clearLastError, TRACE_LEVELS, createTestDispatchErrorCallback, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface RestoreCtx {
	value: string;
}

interface RestoreConfig {
	context: RestoreCtx;
	notifications: {
		getValue(obj: { value: string }): void;
	};
}

export class HsmTop extends TopState<RestoreConfig> {
	getValue(obj: { value: string }): void {
		obj.value = this.ctx.value;
	}
}

@InitialState
export class A extends HsmTop {}

@InitialState
export class B extends A {}

export class C extends HsmTop {}

registerSpecStateNames(self);
//#endregion

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
			const hsm = makeTestActor(HsmTop, initial, port, {
				initialize: false,
				traceLevel,
				dispatchErrorCallback,
			});
			traceActorOnPort(hsm, port);
			const query = { value: '' };
			hsm.getValue(query);
			await hsm.hsm.sync();
			expect(query.value).equals(initial.value);
			expect(hsm.hsm.currentState).equals(HsmTop);

			hsm.hsm.restore(B, first);
			hsm.getValue(query);
			await hsm.hsm.sync();
			expect(query.value).equals(first.value);
			expect(hsm.hsm.currentState).equals(B);

			hsm.hsm.restore(C, second);
			hsm.getValue(query);
			await hsm.hsm.sync();
			expect(query.value).equals(second.value);
			expect(hsm.hsm.currentState).equals(C);

			expect(port.events).eqls(['getValue', 'getValue', 'getValue']);
		});
	});
}
