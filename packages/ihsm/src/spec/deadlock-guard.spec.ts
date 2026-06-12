import { expect } from 'chai';
import 'mocha';

import {
	CallTimeoutError,
	InitialState,
	Port,
	SelfCallDeadlockError,
	TopState,
	TraceLevel,
	makeOwnerActor,
	manifestFor,
	registerStateNames,
} from '../';
import type { Config, OwnerActor } from '../';

interface DeadlockCtx {
	actor?: OwnerActor<DeadlockConfig>;
}

interface DeadlockConfig extends Config {
	context: DeadlockCtx;
	services: {
		outer(): Promise<string>;
		inner(): Promise<string>;
		slow(): Promise<string>;
	};
	notifications: Record<string, never>;
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

const deadlockManifest = manifestFor<DeadlockConfig>({
	services: ['outer', 'inner', 'slow'],
	notifications: [],
	internalServices: [],
	internalNotifications: [],
});

class DeadlockTop extends TopState {
	static readonly manifest = deadlockManifest;
	declare readonly __ihsm: DeadlockConfig;
}

@InitialState
class DeadlockActive extends DeadlockTop {
	async outer(): Promise<string> {
		return this.ctx.actor!.inner();
	}

	inner(): string {
		return 'inner-ok';
	}

	async slow(): Promise<string> {
		await this.hsm.sleep(50);
		return 'slow-done';
	}
}

registerStateNames({ DeadlockTop, DeadlockActive });

describe('deadlock-guard (v2)', function (): void {
	it('throws SelfCallDeadlockError on nested service dispatch in debug builds', async () => {
		const ctx: DeadlockCtx = {};
		const actor = makeOwnerActor(DeadlockTop as never, ctx, new Port(), { traceLevel: TraceLevel.DEBUG });
		ctx.actor = actor;
		await actor.hsm.sync();
		try {
			await actor.outer();
			expect.fail('expected SelfCallDeadlockError');
		} catch (err) {
			expect(err).instanceOf(SelfCallDeadlockError);
		}
	});

	it('does not throw SelfCallDeadlockError in production trace level', async function (): void {
		this.timeout(5000);
		const ctx: DeadlockCtx = {};
		const actor = makeOwnerActor(DeadlockTop as never, ctx, new Port(), { traceLevel: TraceLevel.PRODUCTION });
		ctx.actor = actor;
		await actor.hsm.sync();
		const pending = actor.outer();
		let caught: Error | undefined;
		try {
			await Promise.race([
				pending,
				new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still blocked')), 80)),
			]);
		} catch (err) {
			caught = err as Error;
		}
		expect(caught).to.exist;
		expect(caught).not.instanceOf(SelfCallDeadlockError);
	});

	it('rejects with CallTimeoutError when timeoutMs elapses (job not cancelled)', async function (): void {
		this.timeout(5000);
		const actor = makeOwnerActor(DeadlockTop as never, {}, new Port(), { traceLevel: TraceLevel.DEBUG });
		await actor.hsm.sync();
		try {
			await actor.slow({ timeoutMs: 5 });
			expect.fail('expected CallTimeoutError');
		} catch (err) {
			expect(err).instanceOf(CallTimeoutError);
			expect((err as CallTimeoutError).method).equals('slow');
		}
		await actor.hsm.sync();
	});

	it('rejects immediately when timeoutMs is zero', async () => {
		const actor = makeOwnerActor(DeadlockTop as never, {}, new Port());
		await actor.hsm.sync();
		try {
			await actor.slow({ timeoutMs: 0 });
			expect.fail('expected CallTimeoutError');
		} catch (err) {
			expect(err).instanceOf(CallTimeoutError);
		}
	});
});
