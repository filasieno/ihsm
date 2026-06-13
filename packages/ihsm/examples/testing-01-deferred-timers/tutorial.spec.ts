import { expect } from 'chai';
import 'mocha';

import * as ihsm from '../../src/testing';
import { HeartbeatTop, Stopped, Running, HeartbeatCtx, HeartbeatPublic, HOUR_MS } from './machine';

/**
 * Testing 01 — deferred timers & simulated time.
 *
 * This first example establishes the two test surfaces you will use throughout the chapter:
 *
 * - **Test actor** ({@link ihsm.makeTestActor}): the machine handle for white-box tests. It
 *   exposes the **merged** protocol (so you can post internal events like `onTick` directly, with
 *   no live timer), grants typed access to the machine's `port`, and adds a `subscribe()` channel
 *   that observes every event. (A production {@link ihsm.Actor} from {@link makeTestActor} exposes
 *   only the public protocol and none of those test affordances.)
 *
 * - **Test port** ({@link ihsm.TestPort}): a port test double that
 *   *records* what flows through it (`messages` / `events` / `trace`) and can `send` internal
 *   events inward. Here we also use {@link ihsm.TestPort} — a port whose virtual clock the
 *   test advances by hand — to fire the machine's hourly `deferredPost` deterministically.
 *
 * Note we never wrap {@link makeTestActor} in a helper and never pass `undefined` placeholders:
 * the factories take a single **named-parameters** object, so each test reads as its own setup.
 */
describe('Testing 01: deferred timers & simulated time', () => {
	it('simulates 48 hours of an hourly timer in microseconds (makeTestActor + TestPort)', async () => {
		// The hourly `deferredPost` is backed by the port timer service. Swap the real clock for a
		// manually-advanced one so "every hour" becomes "whenever the test says so".
		const clock = new ihsm.TestPort<HeartbeatTop>();
		// No traceLevel given → makeTestActor defaults to VERBOSE_DEBUG, so a failing run is fully readable.
		const sm = ihsm.makeTestActor(HeartbeatTop, new HeartbeatCtx(), clock);
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Stopped);

		sm.start();
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Running);
		expect(clock.pending).equals(1); // the first hourly tick is armed, not yet fired

		// Drive 48 hours: advance the virtual clock one hour, drain pending events, repeat.
		for (let hour = 1; hour <= 48; hour++) {
			clock.advance(HOUR_MS);
			await sm.hsm.sync();
		}

		expect(sm.ctx.ticks).equals(48);
		expect(clock.now).equals(48 * HOUR_MS);
		expect(clock.pending).equals(1); // hour 49 is already armed — the heartbeat keeps recurring

		// Stopping leaves the stray armed tick harmless: Stopped ignores onTick (top-state no-op).
		sm.stop();
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Stopped);
		clock.advance(HOUR_MS);
		await sm.hsm.sync();
		expect(sm.ctx.ticks).equals(48); // no further ticks counted after stop
	});

	it('drives the internal onTick directly with makeTestActor (the test actor exposes the merged protocol)', async () => {
		const test = ihsm.makeTestActor(HeartbeatTop, new HeartbeatCtx(), new ihsm.TestPort<HeartbeatTop>());
		await test.hsm.sync();

		test.start();
		await test.hsm.sync();
		expect(test.hsm.currentState).equals(Running);

		// No clock, no timer: a test actor can post the internal `onTick` itself.
		test.onTick();
		test.onTick();
		test.onTick();
		await test.hsm.sync();
		expect(test.ctx.ticks).equals(3);

		// The test actor also exposes the typed port and a subscribe() channel — neither exists on
		// the public Actor surface.
		expect(test.hsm.port).to.be.instanceOf(ihsm.TestPort);
		expect(typeof test.hsm.subscribe).to.equal('function');
	});

	it('traces every event via subscribe → TestPort.record (unique to the test actor)', async () => {
		const port = new ihsm.TestPort<HeartbeatTop>();
		const test = ihsm.makeTestActor(HeartbeatTop, new HeartbeatCtx(), port);
		const sub = test.hsm.subscribe(m => port.record(m.event, ...m.payload));
		await test.hsm.sync();

		test.start();
		await test.hsm.sync();
		test.onTick();
		await test.hsm.sync();

		expect(port.events).to.deep.equal(['start', 'onTick']);
		expect(port.last?.event).to.equal('onTick');

		port.clear();
		expect(port.count).to.equal(0);
		sub.dispose();
		test.stop();
		await test.hsm.sync();
		expect(port.count).to.equal(0);
	});

	it('keeps internal events out of the public surface and enforces disjoint protocols (compile-time)', () => {
		// These checks are validated by `tsc` (the examples project is type-checked). They run
		// under ts-node transpile-only at test time, so the body must stay side-effect free:
		// it is declared but never invoked.
		const _typeChecks = (): void => {
			// Inferred production surface: makeActor exposes only the public protocol.
			const sm = makeTestActor(HeartbeatTop, new HeartbeatCtx(), new ihsm.TestPort<HeartbeatTop>());

			// @ts-expect-error 'onTick' is internal — not callable on the public Actor surface.
			sm.onTick();
			// @ts-expect-error 'start' takes no arguments.
			sm.start(1);
			sm.start(); // valid public event

			interface CollidingInternal {
				// Collides with HeartbeatPublic.start — must be rejected by the disjointness gate.
				start(): void;
			}
			// @ts-expect-error public and internal protocols must not share keys ('start').
			makeTestActor<HeartbeatCtx, HeartbeatPublic, CollidingInternal>(HeartbeatTop, new HeartbeatCtx(), new ihsm.TestPort<HeartbeatTop>());
		};

		expect(typeof _typeChecks).to.equal('function');
	});
});
