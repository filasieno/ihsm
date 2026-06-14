import { expect } from 'chai';
import 'mocha';

import { Disposable, InitialState, ResultWithSubscription, TopState, TraceLevel, defaultTraceWriter, makeActor } from '../';
import type { TestActor } from '../testing';
import { Mock, Port, PreloadError, TestPort, makeTestActor, makeTestPort, mock } from '../testing';
import * as self from './testing.spec';
import { clearLastError, createTestDispatchErrorCallback, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface DeviceCtx {
	target: string;
	handle: number;
	opened: boolean;
	pokes: number;
	subscription?: Disposable;
}

interface DeviceConfig {
	context: DeviceCtx;
	services: {
		lastHandle(): Promise<number>;
	};
	notifications: {
		open(target: string): void;
		poke(): void;
		cancel(): void;
	};
	internalServices: Record<string, never>;
	internalNotifications: {
		onOpened(handle: number): void;
		scheduleOnOpened(ms: number, handle: number): void;
	};
	port: {
		connect(target: string): ResultWithSubscription<number>;
		noop(): void;
	};
}

export class DeviceTop extends TopState<DeviceConfig> {
	open(target: string): void {
		this.ctx.target = target;
		const { value, subscription } = this.hsm.port.connect(target);
		this.ctx.handle = value;
		this.ctx.subscription = subscription;
		this.hsm.transition(Connecting);
	}

	poke(): void {
		this.ctx.pokes += 1;
		this.hsm.port.noop();
	}

	cancel(): void {}

	onOpened(_handle: number): void {}

	lastHandle(): number {
		return this.ctx.handle;
	}

	scheduleOnOpened(ms: number, handle: number): void {
		this.hsm.port.defer(ms).onOpened(handle);
	}
}

@InitialState
export class Idle extends DeviceTop {}

export class Connecting extends DeviceTop {
	onOpened(handle: number): void {
		this.ctx.handle = handle;
		this.ctx.opened = true;
		this.hsm.transition(Open);
	}

	cancel(): void {
		this.ctx.subscription?.dispose();
		this.hsm.transition(Idle);
	}
}

export class Open extends DeviceTop {}

registerSpecStateNames(self);
//#endregion

function freshCtx(): DeviceCtx {
	return { target: '', handle: 0, opened: false, pokes: 0 };
}

@mock('connect', 'noop')
abstract class MockDevicePort extends TestPort<typeof DeviceTop> {
	abstract connect(target: string): ResultWithSubscription<number>;
	abstract noop(): void;
}

// A TestPort subclass that is NOT decorated — makeTestPort must reject it.
abstract class UndecoratedPort extends TestPort<typeof DeviceTop> {
	abstract connect(target: string): ResultWithSubscription<number>;
}

describe('ihsm/testing', () => {
	beforeEach(() => clearLastError());

	describe('mock ports and Stubbed methods', () => {
		let port: Mock<MockDevicePort, DeviceConfig>;
		let nextId: number;

		beforeEach(() => {
			port = makeTestPort(MockDevicePort);
			nextId = 0;
			port.connect.default(() => {
				const id = ++nextId;
				return { value: id, subscription: { dispose: () => port.record('abort', id) } };
			});
		});

		it('makeTestPort rejects undecorated port classes', () => {
			expect(() => makeTestPort(UndecoratedPort)).to.throw(/makeTestPort requires a class decorated with @ihsm\.mock/);
		});

		it('drives a port-mediated open and settles it inward with onOpened()', async () => {
			const sm = makeTestActor(DeviceTop, freshCtx(), port);
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(Idle);
			expect(sm.hsm.port).equals(port);

			expect(port.actor).to.not.equal(undefined);

			sm.notify.open('tty0');
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(Connecting);
			expect(port.trace).eqls(['connect:tty0']);
			expect(port.connect.calls).eqls([['tty0']]);

			port.actor!.notify.onOpened(42);
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(Open);
			expect(await sm.call.lastHandle()).equals(42);
		});

		it('records messages and exposes last/count/clear', async () => {
			const sm = makeTestActor(DeviceTop, freshCtx(), port);
			await sm.hsm.sync();
			sm.notify.open('tty1');
			await sm.hsm.sync();
			expect(port.count).equals(1);
			expect(port.last).to.deep.include({ event: 'connect' });
			expect(port.messages.map(m => m.event)).eqls(['connect']);
			port.clear();
			expect(port.count).equals(0);
			expect(port.last).equals(undefined);
		});

		it('consumes once() stubs before default() and tracks calls', async () => {
			const sm = makeTestActor(DeviceTop, freshCtx(), port);
			await sm.hsm.sync();
			const seen: string[] = [];
			port.noop.default(() => void seen.push('default'));
			port.noop.once(() => void seen.push('once'));

			sm.notify.poke();
			sm.notify.poke();
			await sm.hsm.sync();

			expect(seen).eqls(['once', 'default']);
			expect(port.noop.calls.length).equals(2);
			expect(sm.ctx.pokes).equals(2);
			expect(port.trace).eqls(['noop', 'noop']);
		});

		it('reset() clears queued/persistent stubs and recorded calls', () => {
			port.noop.default(() => undefined);
			port.noop();
			expect(port.noop.calls.length).equals(1);
			port.noop.reset();
			expect(port.noop.calls.length).equals(0);
			expect(() => port.noop()).to.throw(PreloadError, /not stubbed/);
		});

		it('throws PreloadError when an unstubbed method is invoked', () => {
			expect(() => port.noop()).to.throw(PreloadError);
			expect(() => port.noop()).to.throw(/port\.noop\.default/);
		});
	});

	it('port.actor throws when the actor has not been bound yet', () => {
		const port = makeTestPort(MockDevicePort);
		expect(() => port.actor!.notify.onOpened(1)).to.throw();
	});

	it('subscribe → TestPort.record traces events until the subscription is disposed', async () => {
		const port = makeTestPort(MockDevicePort);
		port.connect.default(() => ({ value: 1, subscription: { dispose: () => undefined } }));
		const sm = makeTestActor(DeviceTop, freshCtx(), port);
		const trace = new TestPort<typeof DeviceTop>();
		const sub = traceActorOnPort(sm, trace);
		await sm.hsm.sync();

		sm.notify.open('a');
		await sm.hsm.sync();
		expect(trace.events).eqls(['open']);
		expect(trace.trace).eqls(['open:a']);

		sub.dispose();
		sm.notify.cancel();
		await sm.hsm.sync();
		expect(trace.events).eqls(['open']);
	});

	describe('TestPort', () => {
		it('advances virtual time and fires due timers in deadline order', () => {
			const clock = new TestPort<typeof DeviceTop>();
			const fired: string[] = [];
			clock.setTimeout(() => fired.push('b'), 200);
			clock.setTimeout(() => fired.push('a'), 100);
			expect(clock.pending).equals(2);
			expect(clock.now).equals(0);

			clock.advance(150);
			expect(fired).eqls(['a']);
			expect(clock.pending).equals(1);
			expect(clock.now).equals(150);

			clock.advance(100);
			expect(fired).eqls(['a', 'b']);
			expect(clock.pending).equals(0);
			expect(clock.now).equals(250);
		});

		it('breaks deadline ties by insertion order (sequence id)', () => {
			const clock = new TestPort();
			const fired: number[] = [];
			clock.setTimeout(() => fired.push(1), 100);
			clock.setTimeout(() => fired.push(2), 100);
			clock.advance(100);
			expect(fired).eqls([1, 2]);
		});

		it('defaults omitted delay to zero', () => {
			const clock = new TestPort();
			let fired = false;
			clock.setTimeout(() => {
				fired = true;
			});
			clock.advance(0);
			expect(fired).equals(true);
		});

		it('clamps negative advances to zero', () => {
			const clock = new TestPort();
			clock.setTimeout(() => undefined, 0);
			clock.advance(-100);
			expect(clock.now).equals(0);
			expect(clock.pending).equals(0);
		});

		it('clearTimeout() removes a pending timer before it fires', () => {
			const clock = new TestPort();
			let fired = false;
			const handle = clock.setTimeout(() => {
				fired = true;
			}, 100);
			expect(clock.pending).equals(1);
			clock.clearTimeout(handle);
			expect(clock.pending).equals(0);
			clock.clearTimeout(undefined);
			clock.clearTimeout(handle);
			clock.advance(1000);
			expect(fired).equals(false);
		});

		it('setInterval() re-arms on each advance until clearInterval()', () => {
			const clock = new TestPort();
			let ticks = 0;
			const immediate = clock.setInterval(() => {
				ticks += 1;
			});
			clock.advance(0);
			expect(ticks).equals(1);
			clock.clearInterval(immediate);
			const handle = clock.setInterval(() => {
				ticks += 1;
			}, 50);
			clock.advance(50);
			expect(ticks).equals(2);
			clock.advance(50);
			expect(ticks).equals(3);
			clock.clearInterval(handle);
			clock.advance(200);
			expect(ticks).equals(3);
			clock.clearInterval(undefined);
		});
	});

	it('Port exposes its (unbound) actor and schedules real timers', async () => {
		const port = new Port();
		expect(port.actor).equals(undefined);

		let firedEarly = false;
		const early = port.setTimeout(() => {
			firedEarly = true;
		}, 50);
		port.clearTimeout(early);
		port.clearTimeout(undefined);

		await new Promise<void>(resolve => {
			port.setTimeout(() => resolve());
		});
		expect(firedEarly).equals(false);
	});

	it('Port setInterval, clearInterval, and random services delegate to globals', async () => {
		const port = new Port();
		let intervalTicks = 0;
		const noop = port.setInterval(() => undefined);
		port.clearInterval(noop);
		const interval = port.setInterval(() => {
			intervalTicks += 1;
		}, 10);
		await new Promise<void>(resolve => port.setTimeout(() => resolve(), 25));
		port.clearInterval(interval);
		port.clearInterval(undefined);
		expect(intervalTicks).greaterThan(0);

		expect(port.random()).greaterThanOrEqual(0);
		expect(port.random()).lessThan(1);
		expect(port.randomUUID()).matches(/^[0-9a-f-]{36}$/i);
		const bytes = new Uint8Array(4);
		port.getRandomValues(bytes);
		expect(bytes.some(b => b !== 0)).equals(true);
	});

	it('Port<T> is branded by the root state constructor', () => {
		const port = new Port<typeof DeviceTop>();
		expect(port).to.be.instanceOf(Port);
	});

	it('defer falls back to global setTimeout when the port omits setTimeout', async () => {
		class BarePort extends Port<typeof DeviceTop> {}
		const port = new BarePort();
		const sm = makeTestActor(Connecting, freshCtx(), port, { initialize: false });
		await sm.hsm.sync();
		sm.notify.scheduleOnOpened(0, 5);
		await new Promise(resolve => setTimeout(resolve, 20));
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Open);
		expect(sm.ctx.handle).equals(5);
	});

	it('defer uses the test port virtual clock', async () => {
		const port = makeTestPort(MockDevicePort);
		port.connect.default(() => ({ value: 7, subscription: { dispose: () => undefined } }));
		const sm = makeTestActor(Connecting, freshCtx(), port, { initialize: false });
		await sm.hsm.sync();
		sm.notify.scheduleOnOpened(0, 5);
		await sm.hsm.sync();
		port.advance(0);
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Open);
		expect(sm.ctx.handle).equals(5);
	});

	it('TestPort mocks all RandomService methods without calling globals', () => {
		const port = new TestPort();
		port.feedRandom(0.25, 0.75);
		port.feedCryptoRandom(0.1, 0.9);
		port.feedUUID('11111111-1111-4111-8111-111111111111');
		port.feedRandomBytes(1, 2, 3);

		const mathRandom = Math.random;
		const cryptoRandomUUID = globalThis.crypto.randomUUID;
		const cryptoGetRandomValues = globalThis.crypto.getRandomValues;
		let mathCalled = false;
		Math.random = (): number => {
			mathCalled = true;
			return 0.99;
		};
		globalThis.crypto.randomUUID = (() => {
			throw new Error('TestPort must not call crypto.randomUUID');
		}) as typeof globalThis.crypto.randomUUID;
		globalThis.crypto.getRandomValues = (<T extends ArrayBufferView>(_array: T): T => {
			throw new Error('TestPort must not call crypto.getRandomValues');
		}) as typeof globalThis.crypto.getRandomValues;

		try {
			expect(port.random()).equals(0.25);
			expect(port.random()).equals(0.75);
			expect(port.cryptoRandom()).equals(0.1);
			expect(port.cryptoRandom()).equals(0.9);
			expect(port.randomUUID()).equals('11111111-1111-4111-8111-111111111111');
			const bytes = new Uint8Array(3);
			port.getRandomValues(bytes);
			expect([...bytes]).eqls([1, 2, 3]);
			expect(mathCalled).equals(false);

			port.resetRandom();
			expect(port.random()).equals(0);
			expect(port.cryptoRandom()).equals(0);
			expect(port.randomUUID()).equals('00000000-0000-0000-0000-000000000000');
			const zeros = new Uint8Array(2);
			port.getRandomValues(zeros);
			expect([...zeros]).eqls([0, 0]);
		} finally {
			Math.random = mathRandom;
			globalThis.crypto.randomUUID = cryptoRandomUUID;
			globalThis.crypto.getRandomValues = cryptoGetRandomValues;
		}
	});

	it('Port cryptoRandom delegates to crypto.random when available', () => {
		const port = new Port();
		const crypto = globalThis.crypto as Crypto & { random?: () => number };
		const original = crypto.random;
		crypto.random = (): number => 0.77;
		try {
			expect(port.cryptoRandom()).equals(0.77);
		} finally {
			crypto.random = original;
		}
	});

	it('Port cryptoRandom falls back to Math.random when crypto.random is unavailable', () => {
		const port = new Port();
		const crypto = globalThis.crypto as Crypto & { random?: () => number };
		const original = crypto.random;
		crypto.random = undefined;
		const mathRandom = Math.random;
		Math.random = (): number => 0.42;
		try {
			expect(port.cryptoRandom()).equals(0.42);
		} finally {
			crypto.random = original;
			Math.random = mathRandom;
		}
	});

	describe('makeTestActor public facade', () => {
		it('exposes owner protocol and hsm test machinery', async () => {
			const port = makeTestPort(MockDevicePort);
			port.connect.default(() => ({ value: 9, subscription: { dispose: () => undefined } }));
			const cb = createTestDispatchErrorCallback(true);
			const sm: TestActor<DeviceConfig> = makeTestActor(DeviceTop, freshCtx(), port, {
				traceLevel: TraceLevel.PRODUCTION,
				dispatchErrorCallback: cb,
			});
			await sm.hsm.sync();

			expect(sm.ctx.target).equals('');
			expect(sm.hsm.currentState).equals(Idle);
			expect(sm.hsm.currentStateName).equals('Idle');
			expect(sm.hsm.topState).equals(DeviceTop);
			expect(sm.hsm.topStateName).equals('DeviceTop');
			expect(sm.hsm.port).equals(port);
			expect(sm.hsm.subscribe).to.be.a('function');
			const events: string[] = [];
			const sub = sm.hsm.subscribe(msg => events.push(msg.event));
			sm.notify.open('usb0');
			await sm.hsm.sync();
			sub.dispose();
			expect(events).includes('open');
			expect(sm.hsm.traceLevel).equals(TraceLevel.PRODUCTION);
			sm.hsm.traceLevel = TraceLevel.DEBUG;
			expect(sm.hsm.traceLevel).equals(TraceLevel.DEBUG);
			expect(sm.hsm.traceWriter).equals(defaultTraceWriter);
			sm.hsm.traceWriter = defaultTraceWriter;
			expect(sm.hsm.dispatchErrorCallback).equals(cb);
			sm.hsm.dispatchErrorCallback = cb;

			sm.notify.open('usb0');
			await sm.hsm.sync();
			expect(sm.hsm.currentStateName).equals('Connecting');
			sm.hsm.restore(Idle, freshCtx());
			await sm.hsm.sync();
			sm.notify.open('usb1');
			await sm.hsm.sync();
			expect(sm.ctx.target).equals('usb1');
			expect(await sm.call.lastHandle()).equals(9);
		});

		it('applies option defaults when options are omitted, and honours all provided options', async () => {
			const port = makeTestPort(MockDevicePort);
			port.connect.default(() => ({ value: 1, subscription: { dispose: () => undefined } }));

			const a = makeTestActor(DeviceTop, freshCtx(), port);
			await a.hsm.sync();
			expect(a.hsm.currentState).equals(Idle);

			const port2 = makeTestPort(MockDevicePort);
			port2.connect.default(() => ({ value: 2, subscription: { dispose: () => undefined } }));
			const cb = createTestDispatchErrorCallback(true);
			const b = makeTestActor(DeviceTop, freshCtx(), port2, {
				initialize: false,
				traceLevel: TraceLevel.VERBOSE_DEBUG,
				traceWriter: defaultTraceWriter,
				dispatchErrorCallback: cb,
			});
			await b.hsm.sync();
			expect(b.hsm.currentState).equals(DeviceTop);
			expect(b.hsm.dispatchErrorCallback).equals(cb);
		});
	});

	describe('makeActor public facade', () => {
		it('exposes only the public surface and forwards every member', async () => {
			const port = makeTestPort(MockDevicePort);
			port.connect.default(() => ({ value: 9, subscription: { dispose: () => undefined } }));
			const cb = createTestDispatchErrorCallback(true);
			const actor = makeActor(DeviceTop, freshCtx(), port, {
				traceLevel: TraceLevel.PRODUCTION,
				dispatchErrorCallback: cb,
			});
			await actor.hsm.sync();

			expect((actor as { ctx?: unknown }).ctx).equals(undefined);
			expect(actor.hsm.currentStateName).equals('Idle');
			expect(actor.hsm.topStateName).equals('DeviceTop');
			expect(actor.hsm.traceLevel).equals(TraceLevel.PRODUCTION);
			actor.hsm.traceLevel = TraceLevel.DEBUG;
			expect(actor.hsm.traceLevel).equals(TraceLevel.DEBUG);
			expect(actor.hsm.traceWriter).equals(defaultTraceWriter);
			actor.hsm.traceWriter = defaultTraceWriter;

			actor.notify.open('usb0');
			await actor.hsm.sync();
			expect(actor.hsm.currentStateName).equals('Connecting');
			expect(await actor.call.lastHandle()).equals(9);
		});
	});
});
