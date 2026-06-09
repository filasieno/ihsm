import { expect } from 'chai';
import 'mocha';

import * as ihsm from '../../src/testing';
import { MouseTop, Idle, Listening, Point, freshCtx } from './machine';

/**
 * Deterministic mock stream source. `subscribe` is declared **`abstract` with the exact port
 * signature** and the class is decorated `@`{@link ihsm.mock}; the test scripts what it returns with
 * `port.subscribe.default(...)`.
 *
 * The decisive design point: **the pointer's real position lives in the mock, not in the actor** —
 * and it is held in **public** fields the test reads and drives directly. The OS owns the cursor and
 * keeps moving it whether or not your app is subscribed, so the mock models that device state
 * (`cursor`, `live`) and exposes drive commands (`moveTo` / `moveBy` / `path`). The actor only ever
 * stores the moves it *observed while listening*; the two can legitimately diverge. Nothing is
 * emitted from `subscribe`; a move is delivered inward only while the subscription is live.
 */
@ihsm.mock
abstract class MockMouseStream extends ihsm.TestPort<MouseTop> {
	abstract subscribe(): ihsm.ResultWithSubscription<number>;

	/** The simulated OS pointer — device state owned by the mock, not the actor's business. */
	cursor: Point = { x: 0, y: 0 };
	/** Whether the stream is currently subscribed (toggled by the scripted subscribe/dispose). */
	live = false;

	/** Move the simulated pointer to an absolute position; delivered only while listening. */
	moveTo(x: number, y: number): void {
		this.cursor = { x, y };
		this.deliver();
	}

	/** Nudge the simulated pointer relative to its stored position; delivered only while listening. */
	moveBy(dx: number, dy: number): void {
		this.cursor = { x: this.cursor.x + dx, y: this.cursor.y + dy };
		this.deliver();
	}

	/** Replay a gesture: a sequence of absolute points, one delivered move each. */
	path(points: Point[]): void {
		for (const point of points) {
			this.moveTo(point.x, point.y);
		}
	}

	// The device always moves; only a live subscription delivers the event inward to the machine.
	private deliver(): void {
		if (this.live) {
			this.send('onMouseMove', this.cursor.x, this.cursor.y);
		} else {
			this.record('drop', this.cursor.x, this.cursor.y); // moved while unsubscribed — not delivered
		}
	}
}

describe('Testing 03: event streaming (mouse)', () => {
	// One mock stream per test: `beforeEach` rebuilds it fresh (so device state starts clean) and
	// arms `subscribe`.
	let stream: ihsm.Mock<MockMouseStream, MouseTop>;
	let nextId: number;

	beforeEach(() => {
		stream = ihsm.makeTestPort(MockMouseStream);
		nextId = 0;
		// Script `subscribe` so it opens the stream (`live = true`) and closes it on dispose.
		stream.subscribe.default(() => {
			const streamId = ++nextId;
			stream.live = true;
			return {
				value: streamId,
				subscription: {
					dispose: () => {
						stream.live = false;
						stream.record('unsubscribe', streamId);
					},
				},
			};
		});
	});

	it('streams mouse moves only while listening, and stops on stopListening', async () => {
		const sm = ihsm.makeTestActor(MouseTop, freshCtx(), stream);
		await sm.sync();
		expect(sm.currentState).equals(Idle);

		// The source is closed before "listen": the pointer moves but nothing is delivered.
		stream.moveTo(1, 1);
		await sm.sync();
		expect(sm.ctx.moves).to.deep.equal([]);
		expect(stream.trace).to.include('drop:1,1');

		// Press "listen" → the machine subscribes through the port (running the scripted subscribe).
		sm.post('listen');
		await sm.sync();
		expect(sm.currentState).equals(Listening);
		expect(sm.ctx.listening).equals(true);
		expect(stream.trace).to.include('subscribe');
		expect(stream.live).equals(true);

		// Now the source streams; replay a gesture from the mock's stored device state.
		stream.path([
			{ x: 10, y: 20 },
			{ x: 11, y: 22 },
			{ x: 12, y: 24 },
		]);
		await sm.sync();
		expect(sm.ctx.moves).to.deep.equal([
			{ x: 10, y: 20 },
			{ x: 11, y: 22 },
			{ x: 12, y: 24 },
		]);

		// Press "stop listening" → subscription disposed, source goes quiet.
		sm.post('stopListening');
		await sm.sync();
		expect(sm.currentState).equals(Idle);
		expect(sm.ctx.listening).equals(false);
		expect(stream.trace).to.include('unsubscribe:1');
		expect(stream.live).equals(false);

		// Moves after stopping are dropped again — count is unchanged.
		stream.moveTo(99, 99);
		await sm.sync();
		expect(sm.ctx.moves).to.have.length(3);
	});

	it('keeps the pointer position in the mock, not the actor (device state vs. observed state)', async () => {
		const sm = ihsm.makeTestActor(MouseTop, freshCtx(), stream);
		await sm.sync();

		// The OS moves the pointer before we ever listen: the *device* position advances in the mock,
		// but the actor observed nothing — its state owns only what arrived while subscribed.
		stream.moveBy(5, 0);
		stream.moveBy(0, 5);
		await sm.sync();
		expect(stream.cursor).to.deep.equal({ x: 5, y: 5 }); // device state lives in the mock
		expect(sm.ctx.moves).to.deep.equal([]); // actor saw nothing

		// Subscribe, then nudge relative to where the device actually is — not where the actor "left off".
		sm.post('listen');
		await sm.sync();
		stream.moveBy(10, 10);
		await sm.sync();
		expect(stream.cursor).to.deep.equal({ x: 15, y: 15 });
		expect(sm.ctx.moves).to.deep.equal([{ x: 15, y: 15 }]);

		// Stop listening; the device keeps moving (mock position advances) while the actor stays put.
		sm.post('stopListening');
		await sm.sync();
		stream.moveBy(100, 100);
		await sm.sync();
		expect(stream.cursor).to.deep.equal({ x: 115, y: 115 }); // device moved on
		expect(sm.ctx.moves).to.deep.equal([{ x: 15, y: 15 }]); // actor unchanged
	});

	it('drives the stream directly with makeTestActor (post internal events, no device needed)', async () => {
		const test = ihsm.makeTestActor(MouseTop, freshCtx(), stream);
		await test.sync();

		expect(test.port.hsm()).to.not.equal(undefined);

		test.post('listen');
		await test.sync();
		expect(test.currentState).equals(Listening);

		// Internal events posted directly on the full test surface.
		test.post('onMouseMove', 5, 6);
		test.post('onMouseMove', 7, 8);
		await test.sync();
		expect(test.ctx.moves).to.deep.equal([
			{ x: 5, y: 6 },
			{ x: 7, y: 8 },
		]);

		// A move while idle is ignored by the machine (top-state no-op).
		test.post('stopListening');
		await test.sync();
		test.post('onMouseMove', 1, 1);
		await test.sync();
		expect(test.ctx.moves).to.have.length(2);
	});
});
