import { expect } from 'chai';
import 'mocha';
import { InitialState, StateClass, TopState } from '../';
import { TestPort, makeTestActor } from '../testing';

import { TRACE_LEVELS, registerSpecStateNames } from './spec.utils';

/** Context records which state class was active during each custom onEntry. */
class OnEntryPrototypeCtx {
	public readonly onEntryStates: StateClass<OnEntryPrototypeCtx, Protocol>[] = [];
}

interface Protocol {
	goStopped(): void;
}

class OnEntryPrototypeTop extends TopState<OnEntryPrototypeCtx, Protocol> {
	protected recordOnEntry(expected: StateClass<OnEntryPrototypeCtx, Protocol>): void {
		if (this.currentState !== expected) {
			throw new Error(
				`onEntry invariant: expected active state ${expected.name}, got ${this.currentState.name}`,
			);
		}
		this.ctx.onEntryStates.push(expected);
	}

	onEntry(): void {
		this.recordOnEntry(OnEntryPrototypeTop);
	}
}

@InitialState
class Active extends OnEntryPrototypeTop {
	onEntry(): void {
		this.recordOnEntry(Active);
	}
}

@InitialState
class Running extends Active {
	onEntry(): void {
		this.recordOnEntry(Running);
	}

	goStopped(): void {
		this.transition(Stopped);
	}
}

class Stopped extends OnEntryPrototypeTop {
	onEntry(): void {
		this.recordOnEntry(Stopped);
	}
}

registerSpecStateNames({
	OnEntryPrototypeTop,
	Active,
	Running,
	Stopped,
});

for (const traceLevel of TRACE_LEVELS) {
	describe(`onEntry active prototype (traceLevel = ${traceLevel})`, function (): void {
		it('sets the entering state prototype before each onEntry during a transition', async () => {
			const ctx = new OnEntryPrototypeCtx();
			const sm = makeTestActor(OnEntryPrototypeTop, ctx, new TestPort(), {
				traceLevel,
				initialize: false,
			});
			sm.restore(Running, ctx);

			sm.post('goStopped');
			await sm.sync();

			expect(sm.currentState).equals(Stopped);
			expect(ctx.onEntryStates).deep.equals([Stopped]);
		});

		it('sets the entering state prototype before each onEntry during initialization', async () => {
			const ctx = new OnEntryPrototypeCtx();
			const sm = makeTestActor(OnEntryPrototypeTop, ctx, new TestPort(), { traceLevel });
			await sm.sync();

			expect(sm.currentState).equals(Running);
			expect(ctx.onEntryStates).deep.equals([OnEntryPrototypeTop, Active, Running]);
		});
	});
}
