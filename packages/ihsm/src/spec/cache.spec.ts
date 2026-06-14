import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './cache.spec';
import { TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec
class Report {
	stateTrace: string[] = [];
}

interface CacheConfig {
	context: Report;
	notifications: {
		task(): void;
	};
}

export class HsmTop extends TopState<CacheConfig> {}

@InitialState
export class A extends HsmTop {
	onEntry(): void {
		this.ctx.stateTrace.push('A');
	}

	task(): void {
		this.hsm.transition(B);
	}
}

export class B extends HsmTop {
	onEntry(): void {
		this.ctx.stateTrace.push('B');
	}

	task(): void {
		this.hsm.transition(A);
	}
}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`Transition cache (traceLevel = ${traceLevel})`, () => {
		let sm: TestActor<CacheConfig>;
		it(`run a process`, async () => {
			const ctx = new Report();
			const port = new TestPort<typeof HsmTop>();
			sm = makeTestActor(HsmTop, ctx, port, { traceLevel });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
			sm.notify.task();
			sm.notify.task();
			sm.notify.task();
			await sm.hsm.sync();
			expect(ctx.stateTrace).eqls(['A', 'B', 'A', 'B']);
			expect(port.events).eqls(['task', 'task', 'task']);
		});
	});
}
