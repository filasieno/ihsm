import { expect } from 'chai';
import 'mocha';

import * as ihsm from '../../src/testing';
import { WatcherTop, Idle, Watching, WatcherCtx } from './machine';

/**
 * Mock watch source. Each method is declared **`abstract` with the exact port signature** and the
 * class is decorated `@`{@link ihsm.mock}; there are no bodies. A test scripts what `watch` returns
 * per call with `port.watch.default(...)` / `port.watch.once(...)` — including the
 * `Disposable`, so the test controls teardown. Pushing `onChange` / `onClosed` *inward* is the
 * separate, explicit {@link ihsm.BasePort.send | send} channel. One mock, many tests.
 */
@ihsm.mock('watch')
abstract class WatcherMock extends ihsm.TestPort<WatcherTop> {
	abstract watch(path: string): ihsm.ResultWithSubscription<number>;
}

describe('Testing 05: subscriptions & disposables', () => {
	it('owns the Disposable and disposes it exactly once on stop (DST + golden trace)', async () => {
		const port = ihsm.makeTestPort(WatcherMock);

		// Script the watch result: a tracked, IDEMPOTENT Disposable — exactly what a real one must be.
		let disposeCount = 0;
		let disposed = false;
		port.watch.default(path => ({
			value: 7,
			subscription: {
				dispose: (): void => {
					if (disposed) {
						return; // idempotent: a second dispose() is a harmless no-op
					}
					disposed = true;
					disposeCount += 1;
					port.record(`dispose watch ${path}`); // record teardown into the golden trace
				},
			},
		}));

		const sm = ihsm.makeTestActor(WatcherTop, new WatcherCtx(), port);
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Idle);

		sm.start('/etc/hosts');
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Watching);
		expect(sm.ctx.watchId).equals(7); // the value the test scripted

		// The source pushes changes inward — explicit, on the test's command (the `send` channel).
		port.send('onChange', 1);
		port.send('onChange', 2);
		await sm.hsm.sync();
		expect(sm.ctx.changes).to.deep.equal([1, 2]);

		sm.stop();
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Idle);
		expect(disposeCount).equals(1); // disposed exactly once — no leak, no double-free
		expect(sm.ctx.subscription).equals(undefined); // the machine released its handle

		// Golden trace: an exact, ordered transcript of every outbound interaction.
		expect(port.trace).to.deep.equal(['watch:/etc/hosts', 'dispose watch /etc/hosts']);
	});

	it('drops a change that arrives after teardown — the source has gone quiet', async () => {
		const port = ihsm.makeTestPort(WatcherMock);
		port.watch.default(() => ({ value: 1, subscription: { dispose: () => port.record('dispose') } }));

		const sm = ihsm.makeTestActor(WatcherTop, new WatcherCtx(), port);
		await sm.hsm.sync();
		sm.start('/var/log');
		await sm.hsm.sync();
		port.send('onChange', 10);
		await sm.hsm.sync();
		sm.stop();
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Idle);

		// A late change after dispose: a real source would not send it, but the machine must not
		// corrupt Idle even if one slips through. Top-state `onChange` is a no-op.
		port.send('onChange', 99);
		await sm.hsm.sync();
		expect(sm.ctx.changes).to.deep.equal([10]); // unchanged
	});

	it('releases the subscription on a source-initiated close (onClosed)', async () => {
		const port = ihsm.makeTestPort(WatcherMock);
		let disposed = false;
		port.watch.default(() => ({
			value: 3,
			subscription: {
				dispose: (): void => {
					disposed = true;
					port.record('dispose');
				},
			},
		}));

		const sm = ihsm.makeTestActor(WatcherTop, new WatcherCtx(), port);
		await sm.hsm.sync();
		sm.start('/tmp');
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Watching);

		// The source closes itself (e.g. the watched file was deleted) — it pushes onClosed inward.
		port.send('onClosed');
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Idle);
		expect(disposed).equals(true); // dispose() is idempotent, so releasing again is safe
		expect(sm.ctx.subscription).equals(undefined);
	});

	it('is reproducible: the same script replays a byte-identical golden trace', async () => {
		const runOnce = async (): Promise<readonly string[]> => {
			const port = ihsm.makeTestPort(WatcherMock);
			port.watch.default(() => ({ value: 1, subscription: { dispose: () => port.record('dispose') } }));
			const sm = ihsm.makeTestActor(WatcherTop, new WatcherCtx(), port);
			await sm.hsm.sync();
			sm.start('/p');
			await sm.hsm.sync();
			port.send('onChange', 1);
			port.send('onChange', 2);
			await sm.hsm.sync();
			sm.stop();
			await sm.hsm.sync();
			return [...port.trace];
		};

		const a = await runOnce();
		const b = await runOnce();
		expect(b).to.deep.equal(a);
		expect(a).to.deep.equal(['watch:/p', 'dispose']);
	});

	it('an unscripted abstract method throws PreloadError that names the method', () => {
		const port = ihsm.makeTestPort(WatcherMock);
		// Nothing was scripted: calling watch() throws, and the call is still recorded for diagnostics.
		expect(() => port.watch('/x')).to.throw(ihsm.PreloadError, "'watch()'");
		expect(port.trace).to.deep.equal(['watch:/x']);
	});

	it('once() queues one-shot results consumed in order; default() is the persistent fallback', () => {
		const port = ihsm.makeTestPort(WatcherMock);
		port.watch.once(() => ({ value: 1, subscription: { dispose: () => {} } }));
		port.watch.once(() => ({ value: 2, subscription: { dispose: () => {} } }));
		port.watch.default(() => ({ value: 9, subscription: { dispose: () => {} } })); // persistent fallback

		expect(port.watch('/a').value).equals(1); // first one-shot
		expect(port.watch('/b').value).equals(2); // second one-shot
		expect(port.watch('/c').value).equals(9); // queue exhausted → persistent fallback
		expect(port.watch('/d').value).equals(9); // fallback again

		// `calls` is the typed transcript of every invocation — `[path: string][]`.
		expect(port.watch.calls).to.deep.equal([['/a'], ['/b'], ['/c'], ['/d']]);

		// `reset()` clears queued/persistent scripts AND the recorded calls, so the same mock is reusable.
		port.watch.reset();
		expect(port.watch.calls).to.deep.equal([]);
		expect(() => port.watch('/e')).to.throw(ihsm.PreloadError); // back to unscripted
	});

	it('enforces preload result types and protocol disjointness (compile-time)', () => {
		// Validated by `tsc` (the examples project is type-checked); the body never runs.
		const _typeChecks = (): void => {
			const port = ihsm.makeTestPort(WatcherMock);

			// @ts-expect-error a stub must return the method's type (ResultWithSubscription<number>).
			port.watch.default(() => 123);
			port.watch.default(() => ({ value: 1, subscription: { dispose: () => {} } })); // ok

			interface CollidingInternal {
				// Collides with WatcherPublic.start — must be rejected by the disjointness gate.
				start(path: string): void;
			}
			// @ts-expect-error public and internal protocols must not share keys ('start').
			makeTestActor<WatcherCtx, { start(p: string): void }, CollidingInternal>(WatcherTop, new WatcherCtx(), port);
		};

		expect(typeof _typeChecks).to.equal('function');
	});
});
