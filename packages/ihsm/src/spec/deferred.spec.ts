import { expect } from 'chai';
import 'mocha';

import { Any, InitialState, TopState, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';

import { TRACE_LEVELS, traceActorOnPort } from './spec.utils';

interface DeferredConfig extends Config {
	notifications: {
		schedule(millis: number, value: string, object: Any): void;
		setValue(value: string, object: Any): void;
	};
}

const deferredManifest = manifestFor<DeferredConfig>({
	services: [],
	notifications: ['schedule', 'setValue'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = deferredManifest;
	declare readonly __ihsm: DeferredConfig;

	schedule(millis: number, value: string, object: Any): void {
		this.hsm.defer(millis).setValue(value, object);
	}

	setValue(value: string, object: Any): void {
		object.value = value;
	}
}

@InitialState
class A extends HsmTop {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Deferred post (traceLevel = ${traceLevel})`, function (): void {
		let sm: OwnerActor<DeferredConfig>;
		let clock: TestPort<HsmTop>;

		beforeEach(async () => {
			clock = new TestPort<HsmTop>();
			sm = makeOwnerActor(HsmTop as never, {}, clock, { traceLevel });
			traceActorOnPort(sm, clock);
			await sm.hsm.sync();
		});

		it(`fires deferred posts in deadline order when the virtual clock advances`, async () => {
			expect(sm.hsm.currentState).equals(A);
			const obj: Any = { value: '' };
			sm.schedule(600, 'first', obj);
			sm.schedule(10, 'second', obj);
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
			sm.schedule(1000, 'late', obj);
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
