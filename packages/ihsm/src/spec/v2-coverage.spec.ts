import { expect } from 'chai';
import 'mocha';

import {
	BasePort,
	CallTimeoutError,
	FatalErrorState,
	InitialState,
	Port,
	SelfCallDeadlockError,
	TopState,
	TraceLevel,
	TransitionError,
	TransitionTableError,
	buildProtocolIndex,
	defaultDispatchErrorCallback,
	defaultTraceWriter,
	makeActor,
	makeInternalActor,
	makeOwnerActor,
	manifestFor,
	transitionTraceLines,
} from '../';
import type { Config } from '../';
import { HsmObject } from '../internal/hsm';
import { kMachine } from '../v2/handles';
import type { HandleOwn } from '../v2/handles';
import { cacheProtocolIndex, protocolIndexFor } from '../v2/machine';
import { mock, makeTestPort, TestPort } from '../testing';
import { createTestDispatchErrorCallback, registerSpecStateNames } from './spec.utils';

interface V2CoverageConfig extends Config {
	context: { n: number };
	services: {
		throwTransition(): Promise<void>;
	};
	notifications: {
		ping(): void;
		schedule(ms: number): void;
	};
	internalNotifications: {
		tick(): void;
	};
}

const v2CoverageManifest = manifestFor<V2CoverageConfig>({
	services: ['throwTransition'],
	notifications: ['ping', 'schedule'],
	internalServices: [],
	internalNotifications: ['tick'],
});

class V2CoverageTop extends TopState {
	static readonly manifest = v2CoverageManifest;
	declare readonly __ihsm: V2CoverageConfig;

	ping(): void {
		this.ctx.n += 1;
	}

	schedule(ms: number): void {
		this.hsm.defer(ms).ping();
	}

	tick(): void {}

	onUnhandled(): void {}

	throwTransition(): void {
		throw new TransitionError(this.hsm as never, new Error('transition blew up'), 'V2CoverageTop', 'onEntry', 'V2CoverageTop', 'V2CoverageTop');
	}
}

@InitialState
class V2CoverageLeaf extends V2CoverageTop {}

class BareTimerPort extends BasePort<V2CoverageTop> {}

registerSpecStateNames({ V2CoverageTop, V2CoverageLeaf });

describe('v2-coverage', function (): void {
	it('exports v2 error classes', () => {
		expect(new TransitionTableError('bad table').name).equals('TransitionTableError');
		expect(new SelfCallDeadlockError().message).includes('deadlock');
		expect(new CallTimeoutError('slow').method).equals('slow');
	});

	it('throws when TopState has no static manifest', () => {
		class NoManifest extends TopState {
			static readonly manifest = undefined as unknown as typeof TopState.manifest;
		}
		expect(() => makeOwnerActor(NoManifest as never, { n: 0 }, new Port())).to.throw(/missing static readonly manifest/);
	});

	it('makeInternalActor exposes the internal hsm facade', async () => {
		const actor = makeInternalActor(V2CoverageTop as never, { n: 0 }, new Port());
		await actor.hsm.sync();
		expect(actor.hsm.currentState).equals(V2CoverageLeaf);
		expect(actor.hsm.currentStateName).equals('V2CoverageLeaf');
		expect(actor.hsm.topState).equals(V2CoverageTop);
		expect(actor.hsm.topStateName).equals('V2CoverageTop');
		expect(actor.hsm.traceHeader).equals('');
		actor.hsm.traceLevel = TraceLevel.VERBOSE_DEBUG;
		expect(actor.hsm.traceLevel).equals(TraceLevel.VERBOSE_DEBUG);
		actor.hsm.traceWriter = defaultTraceWriter;
		expect(actor.hsm.traceWriter).equals(defaultTraceWriter);
		actor.ping();
		await actor.hsm.sync();
		expect(actor.ctx.n).equals(1);
	});

	it('caches and reads protocol indexes per top state', () => {
		const index = buildProtocolIndex(V2CoverageTop, v2CoverageManifest);
		cacheProtocolIndex(V2CoverageTop, index);
		expect(protocolIndexFor(V2CoverageTop)).equals(index);
		expect(protocolIndexFor({})).equals(undefined);
		expect(index.get('ping')?.bucket).equals('notifications');
	});

	it('defer falls back to global setTimeout when the port has no timer service', async function (): void {
		this.timeout(5000);
		const actor = makeOwnerActor(V2CoverageTop as never, { n: 0 }, new BareTimerPort());
		actor.schedule(1);
		await new Promise(resolve => setTimeout(resolve, 20));
		await actor.hsm.sync();
		expect(actor.ctx.n).equals(1);
	});

	it('service dispatch rejects TransitionError to the client', async () => {
		const actor = makeOwnerActor(V2CoverageTop as never, { n: 0 }, new Port(), {
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
		const actor = makeOwnerActor(V2CoverageTop as never, { n: 0 }, new Port(), {
			dispatchErrorCallback: createTestDispatchErrorCallback(true),
		});
		await actor.hsm.sync();
		const machine = (actor as HandleOwn)[kMachine];
		const result = await machine.dispatchService('missing', []);
		expect(result).equals(undefined);
	});

	it('transitionTraceLines filters verbose transition output', () => {
		const lines = transitionTraceLines(['ihsm: started transition from A to B', 'noise', 'trace: done: final state is B']);
		expect(lines).eqls(['started transition from A to B', 'done: final state is B']);
	});

	it('covers legacy HsmObject post/postNow/deferredPost/call paths', async function (): void {
		this.timeout(5000);
		const callbackManifest = manifestFor<{ notifications: { notify(): void }; services: { answer(resolve: (n: number) => void, reject: (e: Error) => void): void } }>({
			services: ['answer'],
			notifications: ['notify'],
			internalServices: [],
			internalNotifications: [],
		});
		class CallbackTop extends TopState {
			static readonly manifest = callbackManifest;
			notify(): void {}
			answer(resolve: (n: number) => void): void {
				resolve(42);
			}
		}
		@InitialState
		class CallbackLeaf extends CallbackTop {}

		const instance = { ctx: {}, hsm: undefined as never };
		const machine = new HsmObject(CallbackTop, instance, defaultTraceWriter, TraceLevel.DEBUG, defaultDispatchErrorCallback, true);
		await machine.sync();
		expect(machine.currentState).equals(CallbackLeaf);

		machine.post('notify');
		machine.postNow('notify');
		machine.deferredPost(0, 'notify');
		await machine.sync();

		const answer = await machine.call('answer');
		expect(answer).equals(42);

		machine.ctx = { extra: true };
		expect(machine.ctx).deep.equals({ extra: true });
	});

	it('@mock without method names still marks the port class', () => {
		@mock
		class EmptyMock extends TestPort<V2CoverageTop> {}
		expect(() => makeTestPort(EmptyMock)).not.to.throw();
	});

	it('makeTestPort rejects classes without @mock', () => {
		class PlainPort extends TestPort<V2CoverageTop> {}
		expect(() => makeTestPort(PlainPort)).to.throw(/requires a class decorated with @ihsm.mock/);
	});

	it('makeActor internal facade omits owner-only hsm members', async () => {
		const actor = makeActor(V2CoverageTop as never, { n: 0 }, new Port());
		await actor.hsm.sync();
		expect(actor.hsm.traceHeader).equals('');
		expect((actor.hsm as { restore?: unknown }).restore).equals(undefined);
		expect((actor.hsm as { currentState?: unknown }).currentState).equals(undefined);
	});

	it('owner hsm facade exposes traceHeader', async () => {
		const actor = makeOwnerActor(V2CoverageTop as never, { n: 0 }, new Port());
		await actor.hsm.sync();
		expect(actor.hsm.traceHeader).equals('');
	});

	it('service handler can surface UnhandledEventError through invokeHandler', async () => {
		const unhandledManifest = manifestFor<{ services: { bail(): Promise<void> } }>({
			services: ['bail'],
			notifications: [],
			internalServices: [],
			internalNotifications: [],
		});
		class UnhandledTop extends TopState {
			static readonly manifest = unhandledManifest;
			bail(): void {
				this.hsm.unhandled();
			}
			onUnhandled(): void {}
		}
		@InitialState
		class UnhandledLeaf extends UnhandledTop {}
		const actor = makeOwnerActor(UnhandledTop as never, {}, new Port(), { dispatchErrorCallback: createTestDispatchErrorCallback(true) });
		await actor.hsm.sync();
		const result = await actor.bail();
		expect(result).equals(undefined);
		expect(actor.hsm.currentState).equals(UnhandledLeaf);
	});

	it('reports transition failures from executePendingTransition during init', async () => {
		const failManifest = manifestFor<{ notifications: Record<string, never> }>({
			services: [],
			notifications: [],
			internalServices: [],
			internalNotifications: [],
		});
		class FailInitTop extends TopState {
			static readonly manifest = failManifest;
		}
		@InitialState
		class FailInitLeaf extends FailInitTop {
			onEntry(): void {
				this.hsm.transition(FailInitTop);
			}
		}
		const actor = makeOwnerActor(FailInitTop as never, {}, new Port(), {
			traceLevel: TraceLevel.DEBUG,
			dispatchErrorCallback: createTestDispatchErrorCallback(true),
		});
		await actor.hsm.sync();
		expect(actor.hsm.currentStateName).equals('FailInitLeaf');
	});

	it('executePendingTransition moves to FatalErrorState when a transition throws', async () => {
		const transitionManifest = manifestFor<{ services: { go(): Promise<void> } }>({
			services: ['go'],
			notifications: [],
			internalServices: [],
			internalNotifications: [],
		});
		class TransitionFailTop extends TopState {
			static readonly manifest = transitionManifest;
			go(): void {
				this.hsm.transition(Broken);
			}
		}
		class Broken extends TransitionFailTop {
			onEntry(): void {
				throw new Error('onEntry failed');
			}
		}
		@InitialState
		class TransitionFailLeaf extends TransitionFailTop {}
		const actor = makeOwnerActor(TransitionFailTop as never, {}, new Port(), { dispatchErrorCallback: createTestDispatchErrorCallback(true) });
		await actor.hsm.sync();
		try {
			await actor.go();
		} catch {
			// expected
		}
		await actor.hsm.sync();
		expect(actor.hsm.currentState).equals(FatalErrorState);
	});

	it('HsmObject works without a bound port', async function (): void {
		this.timeout(5000);
		const manifest = manifestFor<{ notifications: { later(): void } }>({
			services: [],
			notifications: ['later'],
			internalServices: [],
			internalNotifications: [],
		});
		class PortlessTop extends TopState {
			static readonly manifest = manifest;
			later(): void {}
		}
		@InitialState
		class PortlessLeaf extends PortlessTop {}
		const instance = { ctx: {}, hsm: undefined as never };
		const machine = new HsmObject(PortlessTop, instance, defaultTraceWriter, TraceLevel.DEBUG, defaultDispatchErrorCallback, true);
		expect(machine.port).equals(undefined);
		machine.deferredPost(0, 'later');
		await machine.sync();
		expect(machine.currentState).equals(PortlessLeaf);
	});
});
