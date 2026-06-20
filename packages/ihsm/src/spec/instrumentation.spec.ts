import { expect } from 'chai';
import 'mocha';
import { InitialState, Port, TopState, asParentActor, clearCollectors, configureRunSeed, makeChildActor, registerCollector, registerStateNames } from '../';
import { makeTestActor } from '../testing';
import * as self from './instrumentation.spec';

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

interface ChildConfig {
	context: {};
	services: { pong(): Promise<string> };
}

class ChildTop extends TopState<ChildConfig> {
	async pong(): Promise<string> {
		return 'pong';
	}
}

@InitialState
export class ChildReady extends ChildTop {}

class ParentPort extends Port<typeof ParentTop> {
	child?: any;

	syncCall(): void {
		if (this.child === undefined) throw new Error('missing child');
		void this.child.call.pong();
	}

	async asyncCall(): Promise<void> {
		if (this.child === undefined) throw new Error('missing child');
		await this.child.call.pong();
	}
}

interface ParentConfig {
	context: {};
	notifications: { go(): Promise<void> };
	port: ParentPort;
}

class ParentTop extends TopState<ParentConfig> {
	async go(): Promise<void> {
		const child = makeChildActor(asParentActor(this), ChildTop, {}, new Port(), { initialize: true });
		this.hsm.port.child = child;
		this.hsm.port.syncCall();
		await this.hsm.port.asyncCall();
	}
}

@InitialState
export class ParentReady extends ParentTop {}

registerStateNames(self);

function createCollector() {
	const signals: Array<{ kind: string; [key: string]: unknown }> = [];
	const t0 = Date.now();
	const at = () => Date.now() - t0;
	const instrumentation = {
		onActorCreated(actor: unknown) {
			signals.push({ kind: 'actor.created', at: at(), actor });
		},
		onMacrostepBegin(info: unknown) {
			signals.push({ kind: 'macrostep.begin', at: at(), ...(info as object) });
		},
		onMacrostepEnd(info: unknown) {
			signals.push({ kind: 'macrostep.end', at: at(), ...(info as object) });
		},
		onMicrostepBegin(info: unknown) {
			signals.push({ kind: 'microstep.begin', at: at(), ...(info as object) });
		},
		onMicrostepEnd(info: unknown) {
			signals.push({ kind: 'microstep.end', at: at(), ...(info as object) });
		},
		onActorSpawned(info: unknown) {
			signals.push({ kind: 'actor.spawned', at: at(), ...(info as object) });
		},
		onPortCallBegin(info: unknown) {
			signals.push({ kind: 'port.begin', at: at(), ...(info as object) });
		},
		onPortCallEnd(info: unknown) {
			signals.push({ kind: 'port.end', at: at(), ...(info as object) });
		},
		onOutboundCallBegin(info: unknown) {
			signals.push({ kind: 'outbound.begin', at: at(), ...(info as object) });
		},
		onOutboundCallEnd(info: unknown) {
			signals.push({ kind: 'outbound.end', at: at(), ...(info as object) });
		},
	};
	return { signals, instrumentation };
}

describe('ihsm Instrumentation seam', () => {
	afterEach(() => clearCollectors());

	it('fires macrostep/microstep boundaries for one notify', async () => {
		configureRunSeed('ihsm-instrumentation-spec');
		const { signals, instrumentation } = createCollector();
		// Tracing is a cross-cutting concern: register the collector globally, then spawn the actor.
		registerCollector(instrumentation);
		const ctx = { pings: 0 };
		const actor = makeTestActor(PingTop, ctx, new Port(), { initialize: true });
		await actor.hsm.sync();
		actor.notify.ping();
		await actor.hsm.sync();

		expect(signals.filter(s => s.kind === 'actor.created').length).equals(1);
		expect(signals.filter(s => s.kind === 'macrostep.begin').length).equals(2);
		expect(signals.filter(s => s.kind === 'macrostep.end').length).equals(2);
		expect(signals.filter(s => s.kind === 'microstep.begin').length).equals(2);
		expect(signals.filter(s => s.kind === 'microstep.end').length).equals(2);
		expect(actor.hsm.actorUuid).matches(/^[0-9a-f-]{36}$/i);
		expect(actor.hsm.actorName).equals('Ping');
		expect(actor.hsm.actorPath).equals('Ping');
	});

	it('fires spawn/port/outbound callbacks for nested service calls from port methods', async () => {
		configureRunSeed('ihsm-instrumentation-port-service');
		const { signals, instrumentation } = createCollector();
		registerCollector(instrumentation);
		const actor = makeTestActor(ParentTop, {}, new ParentPort(), { initialize: true });
		await actor.hsm.sync();
		actor.notify.go();
		await actor.hsm.sync();
		await actor.hsm.sync();

		expect(signals.some(s => s.kind === 'actor.spawned')).equals(true);
		expect(signals.filter(s => s.kind === 'port.begin').length).to.be.greaterThan(0);
		expect(signals.filter(s => s.kind === 'port.end').length).to.be.greaterThan(0);
		expect(signals.filter(s => s.kind === 'outbound.begin').length).to.be.greaterThan(0);
		expect(signals.filter(s => s.kind === 'outbound.end').length).to.be.greaterThan(0);
	});
});
