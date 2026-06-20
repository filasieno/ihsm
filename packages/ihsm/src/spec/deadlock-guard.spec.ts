import { expect } from 'chai';
import 'mocha';

import { CallTimeoutError, InitialState, Port, SelfCallDeadlockError, TopState, TraceLevel } from '../';
import type { TestActor } from '../testing';
import { TestPort, makeTestActor } from '../testing';
import * as self from './deadlock-guard.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

interface DeadlockCtx {
	actor?: TestActor<DeadlockConfig>;
}

interface DeadlockConfig {
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

export class DeadlockTop extends TopState<DeadlockConfig> {}

@InitialState
export class DeadlockActive extends DeadlockTop {
	async outer(): Promise<string> {
		return await (this.ctx.actor!.call.inner() as unknown as Promise<string>);
	}

	async inner(): Promise<string> {
		return 'inner-ok';
	}

	async slow(): Promise<string> {
		await new Promise<void>(resolve => setTimeout(resolve, 50));
		return 'slow-done';
	}
}

registerSpecStateNames(self);

//#endregion

describe('deadlock-guard', function (): void {
	it('throws SelfCallDeadlockError on nested service dispatch in debug builds', async () => {
		const ctx: DeadlockCtx = {};
		const actor = makeTestActor(DeadlockTop, ctx, { traceLevel: TraceLevel.DEBUG });
		ctx.actor = actor;
		await actor.hsm.sync();
		try {
			await actor.call.outer();
			expect.fail('expected SelfCallDeadlockError');
		} catch (err) {
			expect(err).instanceOf(SelfCallDeadlockError);
		}
	});

	it('does not throw SelfCallDeadlockError in production trace level', async function (this: Mocha.Context): Promise<void> {
		this.timeout(5000);
		const ctx: DeadlockCtx = {};
		const actor = makeTestActor(DeadlockTop, ctx, { traceLevel: TraceLevel.PRODUCTION });
		ctx.actor = actor;
		await actor.hsm.sync();
		const pending = actor.call.outer();
		let caught: Error | undefined;
		try {
			await Promise.race([pending, new Promise<never>((_, reject) => setTimeout(() => reject(new Error('still blocked')), 80))]);
		} catch (err) {
			caught = err as Error;
		}
		expect(caught).to.not.equal(undefined);
		expect(caught).not.instanceOf(SelfCallDeadlockError);
	});

	it('rejects with CallTimeoutError when timeoutMs elapses (job not cancelled)', async function (this: Mocha.Context): Promise<void> {
		this.timeout(5000);
		const actor = makeTestActor(DeadlockTop, {}, new Port(), { traceLevel: TraceLevel.DEBUG });
		await actor.hsm.sync();
		try {
			await actor.call.slow({ timeoutMs: 5 });
			expect.fail('expected CallTimeoutError');
		} catch (err) {
			expect(err).instanceOf(CallTimeoutError);
			expect((err as CallTimeoutError).method).equals('slow');
		}
		await actor.hsm.sync();
	});

	it('drives the service-call timeout from the TestPort virtual clock (no real waiting)', async () => {
		const port = new TestPort<typeof DeadlockTop>();
		const actor = makeTestActor(DeadlockTop, {}, port, { traceLevel: TraceLevel.DEBUG });
		await actor.hsm.sync();

		const pending = actor.call.slow({ timeoutMs: 10 });
		// The deadline is armed on the port's virtual clock — nothing fires until we advance it.
		port.advance(9);
		port.advance(1);
		try {
			await pending;
			expect.fail('expected CallTimeoutError');
		} catch (err) {
			expect(err).instanceOf(CallTimeoutError);
			expect((err as CallTimeoutError).method).equals('slow');
		}
	});

	it('rejects immediately when timeoutMs is zero', async () => {
		const actor = makeTestActor(DeadlockTop, {});
		await actor.hsm.sync();
		try {
			await actor.call.slow({ timeoutMs: 0 });
			expect.fail('expected CallTimeoutError');
		} catch (err) {
			expect(err).instanceOf(CallTimeoutError);
		}
	});
});
