import { expect } from 'chai';
import 'mocha';

import { CallTimeoutError, FatalError, FatalErrorState, InitialState, Port, SelfCallDeadlockError, TopState, TraceLevel, TransitionError, UnhandledEventError, TransitionTableError, buildProtocolIndex, defaultDispatchErrorCallback, defaultTraceWriter, makeActor, transitionTraceLines } from '../';
import type { InboundActor, HandlerHsm } from '../';
import { Machine, kMachine, isRequestingPort, isServiceCallOptions, serviceCallWithTimeout, splitServiceArgs } from '../internal/runtime';
import type { HandleOwn } from '../internal/runtime';
import { disableDispatchStorage, resetDispatchStorage, cacheProtocolIndex, protocolIndexFor } from '../test-only';
import { mock, makeTestActor, makeTestPort, TestPort } from '../testing';
import * as self from './runtime-coverage.spec';
import { clearLastError, createTestDispatchErrorCallback, getLastError, registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

interface RuntimeCoverageConfig {
	context: { n: number };
	services: {
		throwTransition(): Promise<void>;
	};
	notifications: {
		ping(): void;
		schedule(ms: number): void;
	};
	internalServices: Record<string, never>;
	internalNotifications: {
		tick(): void;
	};
}

export class RuntimeCoverageTop extends TopState<RuntimeCoverageConfig> {
	ping(): void {
		this.ctx.n += 1;
	}

	schedule(ms: number): void {
		this.hsm.port.defer(ms).ping();
	}

	tick(): void {}

	onUnhandled(): void {}

	async throwTransition(): Promise<void> {
		throw new TransitionError(this.hsm as never, new Error('transition blew up'), 'RuntimeCoverageTop', 'onEntry', 'RuntimeCoverageTop', 'RuntimeCoverageTop');
	}
}

@InitialState
export class RuntimeCoverageLeaf extends RuntimeCoverageTop {}

interface CallbackConfig {
	context: Record<string, never>;
	notifications: { signal(): void };
	services: { answer(): Promise<number> };
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

export class CallbackTop extends TopState<CallbackConfig> {
	signal(): void {}
	async answer(): Promise<number> {
		return 42;
	}
}

@InitialState
export class CallbackLeaf extends CallbackTop {}

interface UnhandledServiceConfig {
	context: Record<string, never>;
	services: { bail(): Promise<void> };
	notifications: Record<string, never>;
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

export class UnhandledTop extends TopState<UnhandledServiceConfig> {
	bail(): void {
		this.hsm.unhandled();
	}
	onUnhandled(): void {}
}

@InitialState
export class UnhandledLeaf extends UnhandledTop {}

interface FailInitConfig {
	context: Record<string, never>;
	notifications: Record<string, never>;
	services: Record<string, never>;
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

export class FailInitTop extends TopState<FailInitConfig> {}

@InitialState
export class FailInitLeaf extends FailInitTop {
	onEntry(): void {
		this.hsm.transition(FailInitTop);
	}
}

interface TransitionFailConfig {
	context: Record<string, never>;
	services: { go(): Promise<void> };
	notifications: Record<string, never>;
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

export class TransitionFailTop extends TopState<TransitionFailConfig> {
	async go(): Promise<void> {
		this.hsm.transition(Broken);
	}
}

export class Broken extends TransitionFailTop {
	onEntry(): void {
		throw new Error('onEntry failed');
	}
}

@InitialState
export class TransitionFailLeaf extends TransitionFailTop {}

interface GoConfig {
	context: Record<string, never>;
	services: { go(): Promise<void> };
	notifications: Record<string, never>;
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

export class AsyncUnhandledTop extends TopState<GoConfig> {
	async go(): Promise<void> {
		this.hsm.unhandled();
	}
	async onUnhandled(): Promise<void> {
		await new Promise<void>(resolve => setTimeout(resolve, 1));
	}
}

@InitialState
export class AsyncUnhandledLeaf extends AsyncUnhandledTop {}

export class TransitionUnhandledTop extends TopState<GoConfig> {
	async go(): Promise<void> {
		this.hsm.unhandled();
	}
	onUnhandled(): void {
		throw new TransitionError(this.hsm as never, new Error('boom'), 'T', 'onEntry', 'T', 'T');
	}
}

@InitialState
export class TransitionUnhandledLeaf extends TransitionUnhandledTop {}

export class ErrorUnhandledTop extends TopState<GoConfig> {
	async go(): Promise<void> {
		throw new UnhandledEventError(this.hsm as never);
	}
	onUnhandled(): void {
		throw new Error('onUnhandled failed');
	}
	onError(): void {
		throw new Error('onError failed');
	}
}

@InitialState
export class ErrorUnhandledLeaf extends ErrorUnhandledTop {}

interface BrokenInitConfig {
	context: Record<string, never>;
	notifications: Record<string, never>;
	services: Record<string, never>;
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

export class BrokenInitTop extends TopState<BrokenInitConfig> {}

export class BrokenTarget extends BrokenInitTop {
	onEntry(): void {
		throw new Error('broken target');
	}
}

@InitialState
export class BrokenInitLeaf extends BrokenInitTop {
	onEntry(): void {
		this.hsm.transition(BrokenTarget);
	}
}

interface PortlessConfig {
	context: Record<string, never>;
	notifications: { later(): void };
	services: Record<string, never>;
	internalServices: Record<string, never>;
	internalNotifications: Record<string, never>;
}

export class PortlessTop extends TopState<PortlessConfig> {
	later(): void {}
}

@InitialState
export class PortlessLeaf extends PortlessTop {}

registerSpecStateNames(self);
//#endregion

describe('runtime-coverage', function (): void {
	it('exports runtime error classes', () => {
		expect(new TransitionTableError('bad table').name).equals('TransitionTableError');
		expect(new SelfCallDeadlockError().message).includes('deadlock');
		expect(new CallTimeoutError('slow').method).equals('slow');
	});

	it('makeActor binds port.actor for internal protocol', async () => {
		const port = new Port<typeof RuntimeCoverageTop>();
		const ctx = { n: 0 };
		const actor = makeActor(RuntimeCoverageTop, ctx, port);
		await actor.hsm.sync();
		expect(port.actor).to.exist;
		await port.actor!.hsm.sync();
		expect(port.actor!.hsm.currentState).equals(RuntimeCoverageLeaf);
		expect(port.actor!.hsm.currentStateName).equals('RuntimeCoverageLeaf');
		expect(port.actor!.hsm.topState).equals(RuntimeCoverageTop);
		expect(port.actor!.hsm.topStateName).equals('RuntimeCoverageTop');
		expect(port.actor!.hsm.traceHeader).equals('');
		port.actor!.hsm.traceLevel = TraceLevel.VERBOSE_DEBUG;
		expect(port.actor!.hsm.traceLevel).equals(TraceLevel.VERBOSE_DEBUG);
		port.actor!.hsm.traceWriter = defaultTraceWriter;
		expect(port.actor!.hsm.traceWriter).equals(defaultTraceWriter);
		(port.actor as InboundActor<RuntimeCoverageConfig>).tick();
		actor.ping();
		await actor.hsm.sync();
		expect(ctx.n).equals(1);
	});

	it('caches and reads protocol indexes per top state', () => {
		const index = buildProtocolIndex(RuntimeCoverageTop);
		cacheProtocolIndex(RuntimeCoverageTop, index);
		expect(protocolIndexFor(RuntimeCoverageTop)).equals(index);
		expect(protocolIndexFor({})).equals(undefined);
		expect(index.get('ping')?.bucket).equals('notifications');
	});

	it('port.defer throws before actor binding', () => {
		const port = new Port<typeof RuntimeCoverageTop>();
		expect(() => port.defer(0)).to.throw(/binding/);
	});

	it('service dispatch rejects TransitionError to the client', async () => {
		const actor = makeTestActor(RuntimeCoverageTop, { n: 0 }, new Port(), {
			dispatchErrorCallback: createTestDispatchErrorCallback(true),
		});
		await actor.hsm.sync();
		try {
			await actor.throwTransition();
			expect.fail('expected throw');
		} catch (err) {
			expect(err).instanceOf(TransitionError);
		}
	});

	it('service dispatch routes unknown events through onUnhandled', async () => {
		const actor = makeTestActor(RuntimeCoverageTop, { n: 0 }, new Port(), {
			dispatchErrorCallback: createTestDispatchErrorCallback(true),
		});
		await actor.hsm.sync();
		const machine = (actor as unknown as HandleOwn)[kMachine];
		const result = await machine.dispatchService('missing', []);
		expect(result).equals(undefined);
	});

	it('transitionTraceLines filters verbose transition output', () => {
		const lines = transitionTraceLines(['ihsm: started transition from A to B', 'noise', 'trace: done: final state is B']);
		expect(lines).eqls(['started transition from A to B', 'done: final state is B']);
	});

	it('covers Machine notification and service dispatch paths', async function (this: Mocha.Context): Promise<void> {
		this.timeout(5000);
		const instance: { ctx: Record<string, never>; hsm: HandlerHsm<CallbackConfig>; portRef: Port } = {
			ctx: {},
			hsm: undefined as never,
			portRef: new Port(),
		};
		const machine = new Machine(CallbackTop, instance, buildProtocolIndex(CallbackTop), defaultTraceWriter, TraceLevel.DEBUG, defaultDispatchErrorCallback, true);
		await machine.sync();
		expect(machine.currentState).equals(CallbackLeaf);

		machine.dispatchNotification('signal', [], 'default');
		machine.dispatchNotification('signal', [], 'priority');
		instance.hsm.port.defer(0).signal();
		await machine.sync();

		const answer = await machine.dispatchService('answer', []);
		expect(answer).equals(42);

		machine.ctx = { extra: true } as never;
		expect(machine.ctx).deep.equals({ extra: true });
	});

	it('@mock without method names still marks the port class', () => {
		@mock
		class EmptyMock extends TestPort<typeof RuntimeCoverageTop> {}
		expect(() => makeTestPort(EmptyMock)).not.to.throw();
	});

	it('makeTestPort rejects classes without @mock', () => {
		class PlainPort extends TestPort<typeof RuntimeCoverageTop> {}
		expect(() => makeTestPort(PlainPort)).to.throw(/requires a class decorated with @ihsm.mock/);
	});

	it('makeActor external facade omits owner-only hsm members', async () => {
		const actor = makeActor(RuntimeCoverageTop, { n: 0 }, new Port());
		await actor.hsm.sync();
		expect(actor.hsm.traceHeader).equals('');
		expect((actor.hsm as { restore?: unknown }).restore).equals(undefined);
		expect((actor.hsm as { currentState?: unknown }).currentState).equals(undefined);
	});

	it('makeTestActor hsm facade exposes traceHeader', async () => {
		const actor = makeTestActor(RuntimeCoverageTop, { n: 0 }, new Port());
		await actor.hsm.sync();
		expect(actor.hsm.traceHeader).equals('');
	});

	it('service handler can surface UnhandledEventError through invokeHandler', async () => {
		const actor = makeTestActor(UnhandledTop, {}, new Port(), { dispatchErrorCallback: createTestDispatchErrorCallback(true) });
		await actor.hsm.sync();
		const result = await actor.bail();
		expect(result).equals(undefined);
		expect(actor.hsm.currentState).equals(UnhandledLeaf);
	});

	it('reports transition failures from executePendingTransition during init', async () => {
		const actor = makeTestActor(FailInitTop, {}, new Port(), {
			traceLevel: TraceLevel.DEBUG,
			dispatchErrorCallback: createTestDispatchErrorCallback(true),
		});
		await actor.hsm.sync();
		expect(actor.hsm.currentStateName).equals('FailInitLeaf');
	});

	it('executePendingTransition moves to FatalErrorState when a transition throws', async () => {
		const actor = makeTestActor(TransitionFailTop, {}, new Port(), { dispatchErrorCallback: createTestDispatchErrorCallback(true) });
		await actor.hsm.sync();
		try {
			await actor.go();
		} catch {
			// expected
		}
		await actor.hsm.sync();
		expect(actor.hsm.currentState).equals(FatalErrorState);
	});

	it('covers service-options helpers and timeout rejection paths', async () => {
		expect(isServiceCallOptions(null)).equals(false);
		expect(isServiceCallOptions({ timeoutMs: 'bad' })).equals(false);
		expect(isServiceCallOptions({ timeoutMs: undefined })).equals(true);
		expect(splitServiceArgs(['a', { timeoutMs: undefined }])).deep.equals({ callArgs: ['a', { timeoutMs: undefined }], timeoutMs: undefined });
		expect(splitServiceArgs(['a', { timeoutMs: 1 }])).deep.equals({ callArgs: ['a'], timeoutMs: 1 });
		try {
			await serviceCallWithTimeout(Promise.reject(new Error('nope')), 'x', 100);
			expect.fail('expected rejection');
		} catch (err) {
			expect((err as Error).message).equals('nope');
		}
	});

	it('covers port-utils and disabled dispatch storage', () => {
		expect(isRequestingPort(null)).equals(false);
		expect(isRequestingPort(Object.create(null))).equals(false);
		disableDispatchStorage();
		expect(isRequestingPort(new Port())).equals(false);
		resetDispatchStorage();
	});

	it('async onUnhandled and onUnhandled recovery errors', async () => {
		const actor = makeTestActor(AsyncUnhandledTop, {}, new Port(), { dispatchErrorCallback: createTestDispatchErrorCallback(true) });
		await actor.hsm.sync();
		await actor.go();
		expect(actor.hsm.currentState).equals(AsyncUnhandledLeaf);

		const actor2 = makeTestActor(TransitionUnhandledTop, {}, new Port(), { dispatchErrorCallback: createTestDispatchErrorCallback(true) });
		await actor2.hsm.sync();
		try {
			await actor2.go();
		} catch (err) {
			expect(err).instanceOf(TransitionError);
		}
		expect(actor2.hsm.currentState).equals(FatalErrorState);

		const actor3 = makeTestActor(ErrorUnhandledTop, {}, new Port(), { dispatchErrorCallback: createTestDispatchErrorCallback(true) });
		await actor3.hsm.sync();
		try {
			await actor3.go();
		} catch (err) {
			expect(err).instanceOf(FatalError);
		}
		expect(actor3.hsm.currentState).equals(FatalErrorState);
	});

	it('init task reports executePendingTransition failures via dispatchErrorCallback', async () => {
		clearLastError();
		const actor = makeTestActor(BrokenInitTop, {}, new Port(), {
			traceLevel: TraceLevel.DEBUG,
			dispatchErrorCallback: createTestDispatchErrorCallback(true),
		});
		await actor.hsm.sync();
		expect(getLastError()).to.exist;
	});

	it('Machine binds a default port for deferred notifications', async function (this: Mocha.Context): Promise<void> {
		this.timeout(5000);
		const port = new Port<typeof PortlessTop>();
		const instance: { ctx: Record<string, never>; hsm: HandlerHsm<PortlessConfig>; portRef: Port } = {
			ctx: {},
			hsm: undefined as never,
			portRef: port,
		};
		const machine = new Machine(PortlessTop, instance, buildProtocolIndex(PortlessTop), defaultTraceWriter, TraceLevel.DEBUG, defaultDispatchErrorCallback, true);
		expect(machine.port).to.exist;
		instance.hsm.port.defer(0).later();
		await machine.sync();
		expect(machine.currentState).equals(PortlessLeaf);
	});
});
