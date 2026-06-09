import { expect } from 'chai';
import 'mocha';

import * as ihsm from '../../src/testing';
import { FetchTop, Idle, Fetching, Done, Failed, freshCtx } from './machine';

/**
 * Deterministic mock network port. `request` is declared **`abstract` with the exact port
 * signature** and the class is decorated `@`{@link ihsm.mock} — no body. A test scripts what
 * `request` returns with `port.request.default(...)` (the request id and the abort `Disposable`),
 * but **no response is delivered from inside the call**. The test then settles the request *when it
 * wants* by pushing `onResponse` / `onFailure` inward via {@link ihsm.BasePort.send | send}. That
 * separation is what makes the in-flight `Fetching` state observable and the whole thing
 * timer-free — one mock serves the success, failure, and cancellation scenarios.
 */
@ihsm.mock
abstract class MockFetchPort extends ihsm.TestPort<FetchTop> {
	abstract request(url: string): ihsm.ResultWithSubscription<number>;
}

describe('Testing 02: network fetch behind a port', () => {
	// One mock per test: `beforeEach` rebuilds it fresh (no clearing needed) and arms `request`.
	let port: ihsm.Mock<MockFetchPort, FetchTop>;
	let nextId: number;

	beforeEach(() => {
		port = ihsm.makeTestPort(MockFetchPort);
		nextId = 0;
		// Hand back an id and an abort handle that records when disposed — but deliver **no** response.
		port.request.default(() => {
			const requestId = ++nextId;
			return {
				value: requestId,
				subscription: { dispose: () => port.record('abort', requestId) },
			};
		});
	});

	it('drives a successful fetch, observing the in-flight state before settling it', async () => {
		const fetcher = ihsm.makeTestActor(FetchTop, freshCtx(), port);
		await fetcher.sync();
		expect(fetcher.currentState).equals(Idle);

		fetcher.post('fetch', 'https://google.com');
		await fetcher.sync();
		// Request issued, but no response was delivered from the sync call — we control when it lands.
		expect(fetcher.currentState).equals(Fetching);
		expect(port.trace).to.deep.equal(['request:https://google.com']);
		// `request.calls` is typed exactly as the port method's parameters — `[url: string][]`.
		expect(port.request.calls).to.deep.equal([['https://google.com']]);

		port.send('onResponse', 200, '<!doctype html><title>google</title>'); // network "replies" now
		await fetcher.sync();
		expect(fetcher.currentState).equals(Done);

		const body = await fetcher.call('body');
		expect(body).to.contain('google');
	});

	it('routes a non-2xx response to Failed', async () => {
		const fetcher = ihsm.makeTestActor(FetchTop, freshCtx(), port);
		await fetcher.sync();

		fetcher.post('fetch', 'https://google.com/down');
		await fetcher.sync();
		port.send('onResponse', 503, 'unavailable');
		await fetcher.sync();

		expect(fetcher.currentState).equals(Failed);
	});

	it('routes a transport error to Failed via onFailure', async () => {
		const fetcher = ihsm.makeTestActor(FetchTop, freshCtx(), port);
		await fetcher.sync();

		fetcher.post('fetch', 'https://nope.invalid');
		await fetcher.sync();
		port.send('onFailure', 'ENOTFOUND');
		await fetcher.sync();

		expect(fetcher.currentState).equals(Failed);
		expect(fetcher.ctx.error).equals('ENOTFOUND');
	});

	it('cancel() aborts the request so a late response is never applied', async () => {
		const fetcher = ihsm.makeTestActor(FetchTop, freshCtx(), port);
		await fetcher.sync();

		fetcher.post('fetch', 'https://google.com');
		await fetcher.sync();
		expect(fetcher.currentState).equals(Fetching);

		fetcher.post('cancel');
		await fetcher.sync();
		expect(fetcher.currentState).equals(Idle);
		expect(port.trace).to.include('abort:1'); // dispose() ran when the machine cancelled

		// The source replies after the abort — Idle ignores onResponse (top-state no-op), so it is dropped.
		port.send('onResponse', 200, 'too late');
		await fetcher.sync();
		expect(fetcher.currentState).equals(Idle);
		expect(fetcher.ctx.body).equals('');
	});

	it('pins the in-flight state directly with makeTestActor (no fetch needed)', async () => {
		const test = ihsm.makeTestActor(
			Fetching, // pin the in-flight state directly
			freshCtx(), // fresh domain context
			port,
			{ initialize: false } // skip the @InitialState walk — start in Fetching
		);
		await test.sync();
		expect(test.currentState).equals(Fetching);

		// No live port needed: post the settled-response event the port would have raised.
		test.post('onResponse', 200, 'pong');
		await test.sync();
		expect(test.currentState).equals(Done);
		expect(test.ctx.body).equals('pong');
	});

	it('enforces the public surface and disjoint protocols (compile-time)', () => {
		// Validated by `tsc` (the examples project is type-checked); the body never runs. The
		// production `makeActor` surface here is what demonstrates the public/internal boundary.
		const _typeChecks = (): void => {
			const fetcher = ihsm.makeActor(FetchTop, freshCtx(), ihsm.makeTestPort(MockFetchPort));

			// @ts-expect-error 'onResponse' is internal — not callable on the public Actor surface.
			fetcher.post('onResponse', 200, 'x');
			// @ts-expect-error 'fetch' requires a url argument.
			fetcher.post('fetch');
			fetcher.post('fetch', 'https://google.com'); // valid public event

			// T2 — services are invoked with call(), plain events with post():
			// @ts-expect-error 'body' is a service (resolve/reject signature); it is not postable.
			fetcher.post('body');
			void fetcher.call('body'); // valid: 'body' is a service
			// @ts-expect-error 'fetch' is a void event; it is not callable.
			void fetcher.call('fetch', 'https://google.com');

			interface CollidingInternal {
				// Collides with FetchPublic.fetch — must be rejected by the disjointness gate.
				fetch(url: string): void;
			}
			// @ts-expect-error public and internal protocols must not share keys ('fetch').
			ihsm.makeActor<ReturnType<typeof freshCtx>, { fetch(u: string): void }, CollidingInternal>(FetchTop, freshCtx(), ihsm.makeTestPort(MockFetchPort));
		};

		expect(typeof _typeChecks).to.equal('function');
	});
});
