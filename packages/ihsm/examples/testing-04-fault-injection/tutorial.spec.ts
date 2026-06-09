import { expect } from 'chai';
import 'mocha';

import * as ihsm from '../../src/testing';
import { WorkerTop, Working, Succeeded, Failed, freshCtx } from './machine';

/**
 * Tiny seeded PRNG (mulberry32). Pure and deterministic — the whole point of DST is that the
 * randomness is reproducible, so it must never come from `Math.random()` or the clock.
 */
function mulberry32(seed: number): () => number {
	let state = seed >>> 0;
	return () => {
		state = (state + 0x6d2b79f5) | 0;
		let t = Math.imul(state ^ (state >>> 15), 1 | state);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/**
 * Mock for the flaky operation. `attempt` is declared **`abstract` with the exact port signature**
 * and the class is decorated `@`{@link ihsm.mock}; the call is auto-recorded (the golden trace of
 * which attempts ran). One mock serves every scenario: the test scripts each `attempt` with
 * `port.attempt.default(...)` — either a seeded fault injector that pushes `onResult` inward, or a
 * no-op so the test can drive `onResult` by hand.
 */
@ihsm.mock
abstract class FaultMock extends ihsm.TestPort<WorkerTop> {
	abstract attempt(n: number): void;
}

/** Drive the actor until it reaches a terminal state (bounded so a bug can't hang the suite). */
async function runToCompletion(sm: { sync(): Promise<void>; currentState: unknown }, budget = 50): Promise<void> {
	for (let i = 0; i < budget; i++) {
		await sm.sync();
		if (sm.currentState === Succeeded || sm.currentState === Failed) {
			return;
		}
	}
	throw new Error('worker did not settle within budget');
}

describe('Testing 04: fault injection & seeded DST', () => {
	it('is reproducible: the same seed replays the exact fault sequence and outcome', async () => {
		const runOnce = async (): Promise<{ state: unknown; calls: string[]; log: string[] }> => {
			const port = ihsm.makeTestPort(FaultMock);
			const rng = mulberry32(0x1234abcd);
			const failRate = 0.5;
			for (let i = 0; i < 20; i++) {
				port.feedRandom(rng()); // script TestPort.random() — never Math.random() at decision time
			}
			port.attempt.default(() => port.send('onResult', port.random() >= failRate));

			const worker = ihsm.makeTestActor(WorkerTop, freshCtx(5), port);
			await worker.sync();
			worker.post('run');
			await runToCompletion(worker);
			return { state: worker.currentState, calls: [...port.trace], log: worker.ctx.log };
		};

		const a = await runOnce();
		const b = await runOnce();

		expect(b.calls).to.deep.equal(a.calls); // identical sequence of attempt() calls
		expect(b.state).to.equal(a.state); // identical outcome
		expect(b.log).to.deep.equal(a.log); // identical per-attempt pass/fail log
	});

	it('exhausts the retry budget and Fails when every attempt faults (failRate = 1)', async () => {
		const port = ihsm.makeTestPort(FaultMock);
		port.attempt.default(() => port.send('onResult', false)); // always fail

		const worker = ihsm.makeTestActor(WorkerTop, freshCtx(3), port);
		await worker.sync();
		worker.post('run');
		await runToCompletion(worker);

		expect(worker.currentState).equals(Failed);
		expect(worker.ctx.attempts).equals(3);
		expect(port.trace).to.deep.equal(['attempt:1', 'attempt:2', 'attempt:3']);
		expect(worker.ctx.log).to.deep.equal(['attempt 1: fail', 'attempt 2: fail', 'attempt 3: fail']);
	});

	it('succeeds on the first attempt when no fault is injected (failRate = 0)', async () => {
		const port = ihsm.makeTestPort(FaultMock);
		port.attempt.default(() => port.send('onResult', true)); // always succeed

		const worker = ihsm.makeTestActor(WorkerTop, freshCtx(3), port);
		await worker.sync();
		worker.post('run');
		await runToCompletion(worker);

		expect(worker.currentState).equals(Succeeded);
		expect(worker.ctx.attempts).equals(1);
	});

	it('injects faults by hand: a no-op script records the retries, the test settles them', async () => {
		const port = ihsm.makeTestPort(FaultMock);
		port.attempt.default(() => {}); // record the call (automatic), but report nothing — the test drives onResult

		const test = ihsm.makeTestActor(WorkerTop, freshCtx(2), port);
		await test.sync();

		test.post('run');
		await test.sync();
		expect(test.currentState).equals(Working);

		test.post('onResult', false); // inject a fault → retry
		await test.sync();
		expect(test.currentState).equals(Working);
		expect(test.ctx.attempts).equals(2);

		test.post('onResult', false); // fault again → budget exhausted
		await test.sync();
		expect(test.currentState).equals(Failed);
		expect(port.trace).to.deep.equal(['attempt:1', 'attempt:2']); // the recorded retries
		// `attempt.calls` is typed `[n: number][]` — the exact arguments of each retry.
		expect(port.attempt.calls).to.deep.equal([[1], [2]]);
		expect(test.ctx.log).to.deep.equal(['attempt 1: fail', 'attempt 2: fail']);
	});

	it('enforces the public surface and disjoint protocols (compile-time)', () => {
		// Validated by `tsc` (the examples project is type-checked); the body never runs. The
		// production `makeActor` surface here is what demonstrates the public/internal boundary.
		const _typeChecks = (): void => {
			const worker = ihsm.makeActor(WorkerTop, freshCtx(), ihsm.makeTestPort(FaultMock));

			// @ts-expect-error 'onResult' is internal — not callable on the public Actor surface.
			worker.post('onResult', true);
			worker.post('run'); // valid public event

			interface CollidingInternal {
				// Collides with WorkerPublic.run — must be rejected by the disjointness gate.
				run(): void;
			}
			// @ts-expect-error public and internal protocols must not share keys ('run').
			ihsm.makeActor<ReturnType<typeof freshCtx>, { run(): void }, CollidingInternal>(WorkerTop, freshCtx(), ihsm.makeTestPort(FaultMock));
		};

		expect(typeof _typeChecks).to.equal('function');
	});
});
