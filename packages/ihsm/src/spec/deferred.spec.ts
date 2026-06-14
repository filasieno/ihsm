import { expect } from 'chai';
import 'mocha';

import { Any, InitialState, TopState } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './deferred.spec';
import { TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface DeferredConfig {
	context: Record<string, never>;
	notifications: {
		schedule(millis: number, value: string, object: Any): void;
		setValue(value: string, object: Any): void;
	};
}

export class HsmTop extends TopState<DeferredConfig> {
	schedule(millis: number, value: string, object: Any): void {
		this.hsm.port.defer(millis).setValue(value, object);
	}

	setValue(value: string, object: Any): void {
		object.value = value;
	}
}

@InitialState
export class A extends HsmTop {}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`Deferred post (traceLevel = ${traceLevel})`, function (): void {
		let sm: TestActor<DeferredConfig>;
		let clock: TestPort<typeof HsmTop>;

		beforeEach(async () => {
			clock = new TestPort<typeof HsmTop>();
			sm = makeTestActor(HsmTop, {}, clock, { traceLevel });
			traceActorOnPort(sm, clock);
			await sm.hsm.sync();
		});

		it(`fires deferred posts in deadline order when the virtual clock advances`, async () => {
			expect(sm.hsm.currentState).equals(A);
			const obj: Any = { value: '' };
			sm.notify.schedule(600, 'first', obj);
			sm.notify.schedule(10, 'second', obj);
			await sm.hsm.sync();

			expect(clock.pending).equals(2);
			expect(obj.value).equals('');

			clock.advance(600);
			await sm.hsm.sync();
			expect(clock.pending).equals(0);
			expect(obj.value).equals('first');

			expect(clock.events).to.eql(['schedule', 'schedule', 'setValue', 'setValue']);
		});

		it(`does not fire a deferred post before its deadline is reached`, async () => {
			const obj: Any = { value: 'untouched' };
			sm.notify.schedule(1000, 'late', obj);
			await sm.hsm.sync();

			clock.advance(999);
			await sm.hsm.sync();
			expect(obj.value).equals('untouched');

			clock.advance(1);
			await sm.hsm.sync();
			expect(obj.value).equals('late');
		});
	});
}
