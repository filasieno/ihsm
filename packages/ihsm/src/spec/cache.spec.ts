import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, makeOwnerActor, manifestFor, registerStateNames } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';
import { TRACE_LEVELS, traceActorOnPort } from './spec.utils';

class Report {
	stateTrace: string[] = [];
}

interface CacheConfig extends Config {
	context: Report;
	notifications: {
		task(): void;
	};
}

const cacheManifest = manifestFor<CacheConfig>({
	services: [],
	notifications: ['task'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = cacheManifest;
	declare readonly __ihsm: CacheConfig;
}

@InitialState
class A extends HsmTop {
	onEntry(): void {
		this.ctx.stateTrace.push('A');
	}

	task(): void {
		this.hsm.transition(B);
	}
}
class B extends HsmTop {
	onEntry(): void {
		this.ctx.stateTrace.push('B');
	}

	task(): void {
		this.hsm.transition(A);
	}
}

registerStateNames({ HsmTop, A, B });

for (const traceLevel of TRACE_LEVELS) {
	describe(`Transition cache (traceLevel = ${traceLevel})`, () => {
		let sm: OwnerActor<CacheConfig>;
		it(`run a process`, async () => {
			const ctx = new Report();
			const port = new TestPort<HsmTop>();
			sm = makeOwnerActor(HsmTop as never, ctx, port, { traceLevel });
			traceActorOnPort(sm, port);
			await sm.hsm.sync();
			sm.task();
			sm.task();
			sm.task();
			await sm.hsm.sync();
			expect(ctx.stateTrace).eqls(['A', 'B', 'A', 'B']);
			expect(port.events).eqls(['task', 'task', 'task']);
		});
	});
}
