import { expect } from 'chai';
import 'mocha';

import { actorNameFromTopState, childActorPath, configureRunSeed, getRunNamespace, getRunSeed, mintActorIdentity, rootActorPath } from '../internal/identity';
import { clearCollectors, getActiveInstrumentation, getCollectorCount, getTaskMeta, invokeInstrumentation, notifyActorCreated, notifyActorSpawned, notifyEnqueue, notifyError, notifyLog, notifyMacrostepBegin, notifyMacrostepEnd, notifyMicrostepBegin, notifyMicrostepEnd, notifyOutboundCallBegin, notifyOutboundCallEnd, notifyPortCallBegin, notifyPortCallEnd, registerCollector, setTaskMeta } from '../internal/instrumentation';
import type { Instrumentation, Task } from '../internal/types';

const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('internal/identity (CORE-A)', () => {
	let originalSeed: string;

	before(() => {
		originalSeed = getRunSeed();
	});

	after(() => {
		configureRunSeed(originalSeed);
	});

	it('mints deterministic UUIDv5 identities per run seed', () => {
		configureRunSeed('fixed-seed');
		expect(getRunSeed()).to.equal('fixed-seed');
		const ns = getRunNamespace();
		expect(ns).to.match(UUID_V5);
		expect(getRunNamespace()).to.equal(ns); // cached

		const a = mintActorIdentity('inbound', 'RootSupervisor');
		const b = mintActorIdentity('inbound', 'RootSupervisor');
		expect(a.uuid).to.equal(b.uuid);
		expect(a.uuid).to.match(UUID_V5);
		expect(a.name).to.equal('RootSupervisor');
		expect(a.parentUuid).to.equal(undefined);

		const child = mintActorIdentity('inbound', childActorPath('RootSupervisor', 'WorkerTop', 0), a.uuid);
		expect(child.parentUuid).to.equal(a.uuid);
		expect(child.name).to.equal('Worker');
		expect(child.path).to.equal('RootSupervisor/Worker[0]');
	});

	it('recomputes the namespace when the run seed changes', () => {
		configureRunSeed('seed-one');
		const first = mintActorIdentity('inbound', 'RootSupervisor').uuid;
		configureRunSeed('seed-two');
		expect(getRunSeed()).to.equal('seed-two');
		expect(mintActorIdentity('inbound', 'RootSupervisor').uuid).to.not.equal(first);
	});

	it('derives actor names and child paths', () => {
		expect(actorNameFromTopState('DeviceTop')).to.equal('Device');
		expect(actorNameFromTopState('PlainName')).to.equal('PlainName');
		expect(rootActorPath('DeviceTop')).to.equal('Device');
		expect(childActorPath('Device', 'WorkerTop', 3)).to.equal('Device/Worker[3]');
	});

	it('reads the run seed from IHSM_RUN_SEED on fresh module load', () => {
		const key = require.resolve('../internal/identity');
		const prevEnv = process.env.IHSM_RUN_SEED;
		const cached = require.cache[key];
		try {
			delete require.cache[key];
			process.env.IHSM_RUN_SEED = 'seed-from-env';
			// eslint-disable-next-line @typescript-eslint/no-require-imports
			const fresh = require('../internal/identity') as typeof import('../internal/identity');
			expect(fresh.getRunSeed()).to.equal('seed-from-env');
		} finally {
			if (prevEnv === undefined) delete process.env.IHSM_RUN_SEED;
			else process.env.IHSM_RUN_SEED = prevEnv;
			delete require.cache[key];
			if (cached !== undefined) require.cache[key] = cached;
		}
	});
});

describe('internal/instrumentation (CORE-B)', () => {
	it('stores and reads task metadata', () => {
		const task: Task = (done): void => done();
		expect(getTaskMeta(task)).to.equal(undefined);
		setTaskMeta(task, { event: 'ping', internal: true });
		expect(getTaskMeta(task)?.event).to.equal('ping');
	});

	it('invokeInstrumentation swallows observer errors', () => {
		expect(() =>
			invokeInstrumentation(() => {
				throw new Error('observer boom');
			})
		).to.not.throw();
	});

	it('forwards to defined hooks and short-circuits undefined ones', () => {
		const seen: string[] = [];
		const full: Instrumentation = {
			onActorCreated: () => seen.push('actor'),
			onActorSpawned: () => seen.push('spawn'),
			onMacrostepBegin: () => seen.push('macro.begin'),
			onMacrostepEnd: () => seen.push('macro.end'),
			onMicrostepBegin: () => seen.push('micro.begin'),
			onMicrostepEnd: () => seen.push('micro.end'),
			onPortCallBegin: () => seen.push('port.begin'),
			onPortCallEnd: () => seen.push('port.end'),
			onOutboundCallBegin: () => seen.push('outbound.begin'),
			onOutboundCallEnd: () => seen.push('outbound.end'),
			onEnqueue: () => seen.push('enqueue'),
			onError: () => seen.push('error'),
			onLog: () => seen.push('log'),
		};
		const info = {} as never;
		notifyActorCreated(full, info);
		notifyActorSpawned(full, info);
		notifyMacrostepBegin(full, info);
		notifyMacrostepEnd(full, info);
		notifyMicrostepBegin(full, info);
		notifyMicrostepEnd(full, info);
		notifyPortCallBegin(full, info);
		notifyPortCallEnd(full, info);
		notifyOutboundCallBegin(full, info);
		notifyOutboundCallEnd(full, info);
		notifyEnqueue(full, info);
		notifyError(full, info);
		notifyLog(full, info);
		expect(seen).eqls(['actor', 'spawn', 'macro.begin', 'macro.end', 'micro.begin', 'micro.end', 'port.begin', 'port.end', 'outbound.begin', 'outbound.end', 'enqueue', 'error', 'log']);

		// undefined instrumentation and empty instrumentation must both be no-ops.
		const empty: Instrumentation = {};
		for (const inst of [undefined, empty]) {
			notifyActorCreated(inst, info);
			notifyActorSpawned(inst, info);
			notifyMacrostepBegin(inst, info);
			notifyMacrostepEnd(inst, info);
			notifyMicrostepBegin(inst, info);
			notifyMicrostepEnd(inst, info);
			notifyPortCallBegin(inst, info);
			notifyPortCallEnd(inst, info);
			notifyOutboundCallBegin(inst, info);
			notifyOutboundCallEnd(inst, info);
			notifyEnqueue(inst, info);
			notifyError(inst, info);
			notifyLog(inst, info);
		}
		expect(seen.length).to.equal(13);
	});

	it('isolates a throwing hook so actor dispatch is never disturbed', () => {
		const boom: Instrumentation = {
			onMacrostepBegin: () => {
				throw new Error('hook boom');
			},
		};
		expect(() => notifyMacrostepBegin(boom, {} as never)).to.not.throw();
	});
});

describe('internal/instrumentation global collector registry (cross-cutting tracing)', () => {
	afterEach(() => clearCollectors());

	it('has no active instrumentation until a collector is registered', () => {
		expect(getActiveInstrumentation()).to.equal(undefined);
		expect(getCollectorCount()).to.equal(0);
	});

	it('a single collector is adopted directly (no aggregation overhead)', () => {
		const c: Instrumentation = { onMacrostepBegin: () => undefined };
		registerCollector(c);
		expect(getCollectorCount()).to.equal(1);
		expect(getActiveInstrumentation()).to.equal(c);
	});

	it('fans every callback out to each collector in registration order', () => {
		const seen: string[] = [];
		registerCollector({ onMacrostepBegin: () => seen.push('a'), onLog: () => seen.push('a.log') });
		registerCollector({
			onMacrostepBegin: () => seen.push('b'),
			onMacrostepEnd: () => seen.push('b.macro.end'),
			onMicrostepEnd: () => seen.push('b.micro.end'),
			onError: () => seen.push('b.error'),
		});
		const agg = getActiveInstrumentation()!;
		expect(agg).to.not.equal(undefined);
		notifyMacrostepBegin(agg, {} as never);
		notifyMacrostepEnd(agg, {} as never);
		notifyMicrostepEnd(agg, {} as never);
		notifyError(agg, {} as never);
		notifyLog(agg, {} as never); // only the first collector implements onLog
		expect(seen).eqls(['a', 'b', 'b.macro.end', 'b.micro.end', 'b.error', 'a.log']);
	});

	it('isolates a throwing collector so the others still observe', () => {
		const seen: string[] = [];
		registerCollector({
			onMacrostepBegin: () => {
				throw new Error('boom');
			},
		});
		registerCollector({ onMacrostepBegin: () => seen.push('survived') });
		notifyMacrostepBegin(getActiveInstrumentation()!, {} as never);
		expect(seen).eqls(['survived']);
	});

	it('unregister is idempotent and rebuilds the active instrumentation', () => {
		const a: Instrumentation = { onMacrostepBegin: () => undefined };
		const b: Instrumentation = { onMacrostepBegin: () => undefined };
		const offA = registerCollector(a);
		registerCollector(b);
		expect(getCollectorCount()).to.equal(2);
		offA();
		offA(); // idempotent
		expect(getCollectorCount()).to.equal(1);
		expect(getActiveInstrumentation()).to.equal(b);
	});

	it('clearCollectors removes everything', () => {
		registerCollector({ onMacrostepBegin: () => undefined });
		registerCollector({ onMacrostepBegin: () => undefined });
		clearCollectors();
		expect(getCollectorCount()).to.equal(0);
		expect(getActiveInstrumentation()).to.equal(undefined);
	});

	it('fans transition tracers and spawn/dispose/port/outbound across collectors', () => {
		const seen: string[] = [];
		registerCollector({
			onActorSpawned: () => seen.push('a.spawn'),
			onActorDisposed: () => seen.push('a.dispose'),
			onMicrostepBegin: () => seen.push('a.micro'),
			onEnqueue: () => seen.push('a.enqueue'),
			onPortCallBegin: () => seen.push('a.port.begin'),
			onPortCallEnd: () => seen.push('a.port.end'),
			onOutboundCallBegin: () => seen.push('a.out.begin'),
			onOutboundCallEnd: () => seen.push('a.out.end'),
			transition: {
				traceTransitionStart: () => seen.push('a.tr.start'),
				traceTransitionDone: final => seen.push(`a.tr.done:${final}`),
				traceHookStart: () => seen.push('a.hook.start'),
				traceHookDone: () => seen.push('a.hook.done'),
				traceHookSkipped: () => {},
				traceHookError: () => seen.push('a.hook.error'),
				traceInitializeDone: () => seen.push('a.init.done'),
			},
		});
		registerCollector({
			onActorDisposed: () => seen.push('b.dispose'),
			onMicrostepBegin: () => seen.push('b.micro'),
			transition: {
				traceTransitionStart: () => {},
				traceTransitionDone: () => {},
				traceHookDone: () => {},
				traceHookError: () => {},
				traceInitializeStart: () => seen.push('b.init.start'),
				traceHookSkipped: () => seen.push('b.hook.skip'),
			},
		});
		const agg = getActiveInstrumentation()!;
		const info = {} as never;
		notifyActorCreated(agg, info);
		notifyActorSpawned(agg, info);
		agg.onActorDisposed?.(info);
		notifyMicrostepBegin(agg, info);
		notifyMicrostepEnd(agg, info);
		notifyEnqueue(agg, info);
		notifyPortCallBegin(agg, info);
		notifyPortCallEnd(agg, info);
		notifyOutboundCallBegin(agg, info);
		notifyOutboundCallEnd(agg, info);
		agg.transition?.traceTransitionStart?.('A', 'B');
		agg.transition?.traceInitializeStart?.('Leaf');
		agg.transition?.traceInitializeDone?.('Leaf');
		agg.transition?.traceHookStart?.('Leaf', 'onEntry');
		agg.transition?.traceHookDone?.('Leaf', 'onEntry');
		agg.transition?.traceHookSkipped?.('Leaf', 'onExit');
		agg.transition?.traceHookError?.('Leaf', 'onEntry', new Error('hook'));
		agg.transition?.traceTransitionDone?.('Leaf');
		expect(seen).eqls(['a.spawn', 'a.dispose', 'b.dispose', 'a.micro', 'b.micro', 'a.enqueue', 'a.port.begin', 'a.port.end', 'a.out.begin', 'a.out.end', 'a.tr.start', 'b.init.start', 'a.init.done', 'a.hook.start', 'a.hook.done', 'b.hook.skip', 'a.hook.error', 'a.tr.done:Leaf']);
	});
});
