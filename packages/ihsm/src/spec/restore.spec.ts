import { expect } from 'chai';
import 'mocha';
import { TopState, InitialState, Any, makeOwnerActor, manifestFor } from '../';
import type { Config } from '../';
import { TestPort } from '../testing';
import { clearLastError, TRACE_LEVELS, createTestDispatchErrorCallback, traceActorOnPort } from './spec.utils';

interface RestoreCtx {
	value: string;
}

interface RestoreConfig extends Config {
	context: RestoreCtx;
	notifications: {
		getValue(obj: { value: string }): void;
	};
}

const restoreManifest = manifestFor<RestoreConfig>({
	services: [],
	notifications: ['getValue'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = restoreManifest;
	declare readonly __ihsm: RestoreConfig;

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
			const hsm = makeOwnerActor(HsmTop as never, initial, port, {
				initialize: false,
				traceLevel,
				dispatchErrorCallback,
			});
			traceActorOnPort(hsm, port);
			const query: Any = { value: undefined };
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
