import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, clearCollectors, configureRunSeed, createConsoleInstrumentation, registerCollector, registerStateNames } from '../';
import type { ActorIdentity, DispatchError, EnqueueInfo, LogRecord, MacrostepEnd } from '../internal/types';
import { makeTestActor } from '../testing';
import * as self from './console-instrumentation.spec';

interface PingConfig {
	context: { pings: number };
	notifications: { ping(): void };
}

export class PingTop extends TopState<PingConfig> {
	ping(): void {
		this.ctx.pings += 1;
	}
}

@InitialState
export class Ready extends PingTop {}

registerStateNames(self);

describe('createConsoleInstrumentation', () => {
	afterEach(() => clearCollectors());

	it('prints actor, macrostep, and microstep signals through the callback seam', async () => {
		configureRunSeed('console-instrumentation-spec');
		const lines: string[] = [];
		const instrumentation = createConsoleInstrumentation({ write: l => lines.push(l), prefix: 'demo' });
		registerCollector(instrumentation);
		const actor = makeTestActor(PingTop, { pings: 0 }, { initialize: true });
		await actor.hsm.sync();
		actor.notify.ping();
		await actor.hsm.sync();

		expect(lines.some(l => l.includes('[demo]'))).equals(true);
		expect(lines.some(l => l.includes('+ actor Ping'))).equals(true);
		expect(lines.some(l => l.includes('macrostep'))).equals(true);
		expect(lines.some(l => l.includes('#'))).equals(true); // microstep line
	});

	it('omits microstep and log lines when disabled', async () => {
		configureRunSeed('console-instrumentation-spec');
		const lines: string[] = [];
		const instrumentation = createConsoleInstrumentation({ write: l => lines.push(l), microsteps: false, logs: false });
		registerCollector(instrumentation);
		const actor = makeTestActor(PingTop, { pings: 0 }, { initialize: true });
		await actor.hsm.sync();
		actor.notify.ping();
		await actor.hsm.sync();

		expect(instrumentation.onMicrostepBegin).equals(undefined);
		expect(instrumentation.onEnqueue).equals(undefined);
		expect(instrumentation.onLog).equals(undefined);
		expect(lines.every(l => !l.includes(' · #'))).equals(true);
	});

	it('defaults the sink to console.log without throwing', () => {
		const instrumentation = createConsoleInstrumentation();
		expect(typeof instrumentation.onMacrostepBegin).equals('function');
	});

	it('formats dispose, error, enqueue delay, and log attributes', () => {
		const lines: string[] = [];
		const instrumentation = createConsoleInstrumentation({ write: l => lines.push(l), prefix: 't' });
		const actor: ActorIdentity = { uuid: 'abcd', path: 'Ping', name: 'Ping', kind: 'inbound' };
		instrumentation.onActorDisposed?.(actor);
		instrumentation.onMacrostepEnd?.({
			id: '1',
			endState: 'Ready',
			steps: 1,
			transitioned: true,
			outcome: 'ok',
		} as MacrostepEnd);
		instrumentation.onError?.({
			phase: 'handler',
			errorClass: 'Error',
			error: new Error('boom'),
			recovered: true,
		} as DispatchError);
		instrumentation.onEnqueue?.({ event: 'later', queue: 'default', delayMs: 5 } as EnqueueInfo);
		instrumentation.onLog?.({
			severity: 'info',
			body: 'hello',
			attributes: { k: 1 },
			frames: [],
			source: 'user',
		} as LogRecord);

		expect(lines.some(l => l.includes('- actor Ping'))).equals(true);
		expect(lines.some(l => l.includes('macrostep 1'))).equals(true);
		expect(lines.some(l => l.includes('(recovered)'))).equals(true);
		expect(lines.some(l => l.includes('+5ms'))).equals(true);
		expect(lines.some(l => l.includes('{"k":1}'))).equals(true);
	});
});
