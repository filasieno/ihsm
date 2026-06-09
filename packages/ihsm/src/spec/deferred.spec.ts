import { expect } from 'chai';
import 'mocha';

import { Any, InitialState, TopState } from '../';
import { TestPort, TestActor, makeTestActor } from '../testing';

import { TRACE_LEVELS, traceActorOnPort } from './spec.utils';

interface Protocol {
	schedule(millis: number, value: string, object: Any): void;
	setValue(value: string, object: Any): Promise<void>;
}

class HsmTop extends TopState<Any, Protocol> implements Protocol {
	// deferredPost is handler-only; clients post `schedule` and the handler arms the timer.
	schedule(millis: number, value: string, object: Any): void {
		this.deferredPost(millis, 'setValue', value, object);
	}

	async setValue(value: string, object: Any): Promise<void> {
		object.value = value;
	}
}

@InitialState
class A extends HsmTop {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Deferred post (traceLevel = ${traceLevel})`, function (): void {
		// The deferred timer is backed by a TestPort, so the test advances virtual time by hand
		// — no `setTimeout`, no `sleep`, no flakiness. subscribe → TestPort.record traces the event stream.
		let sm: TestActor<Any, Protocol, {}, TestPort<HsmTop>>;
		let clock: TestPort<HsmTop>;

		beforeEach(async () => {
			clock = new TestPort<HsmTop>();
			sm = makeTestActor(HsmTop, {}, clock, { traceLevel });
			traceActorOnPort(sm, clock);
			await sm.sync();
		});

		it(`fires deferred posts in deadline order when the virtual clock advances`, async () => {
			expect(sm.currentState).equals(A);
			const obj: Any = { value: '' };
			sm.post('schedule', 600, 'first', obj);
			sm.post('schedule', 10, 'second', obj);
			await sm.sync();

			// Both timers are armed but virtual time has not moved: nothing has fired yet.
			expect(clock.pending).equals(2);
			expect(obj.value).equals('');

			// Advancing past both deadlines fires them in deadline order (10 then 600), so the last
			// write wins: `first` (deadline 600) lands after `second` (deadline 10).
			clock.advance(600);
			await sm.sync();
			expect(clock.pending).equals(0);
			expect(obj.value).equals('first');

			// The TestPort observed both client posts that armed the timers.
			expect(clock.events).to.eql(['schedule', 'schedule']);
		});

		it(`does not fire a deferred post before its deadline is reached`, async () => {
			const obj: Any = { value: 'untouched' };
			sm.post('schedule', 1000, 'late', obj);
			await sm.sync();

			clock.advance(999); // one tick short of the deadline
			await sm.sync();
			expect(obj.value).equals('untouched');

			clock.advance(1); // now the deadline is met
			await sm.sync();
			expect(obj.value).equals('late');
		});
	});
}
