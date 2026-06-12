import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, TraceLevel, TraceWriter, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';
import { traceActorOnPort } from './spec.utils';
import * as ihsm from '../index';

interface TraceLevelConfig extends Config {
	context: Record<string, never>;
	notifications: {
		switchTraceWriter(tw: TraceWriter): Promise<void>;
		switchTraceLevel(tl: TraceLevel): Promise<void>;
		hello(): void;
	};
}

const traceLevelManifest = manifestFor<TraceLevelConfig>({
	services: [],
	notifications: ['switchTraceWriter', 'switchTraceLevel', 'hello'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = traceLevelManifest;
	declare readonly __ihsm: TraceLevelConfig;

	async switchTraceWriter(tw: TraceWriter): Promise<void> {
		this.hsm.traceWriter = tw;
	}

	async switchTraceLevel(tl: TraceLevel): Promise<void> {
		console.log(`new trace level = ${TraceLevel[tl]}`);
		this.hsm.traceLevel = tl;
	}

	hello(): void {
		console.log(`Hello: TraceLevel = ${TraceLevel[this.hsm.traceLevel]}`);
	}
}

class TestTraceWriter implements ihsm.TraceWriter {
	lines: string[] = [];
	write(_hsm: unknown, msg: unknown): void {
		this.lines.push(`TEST: ${msg}`);
	}
}

@InitialState
class A extends HsmTop {}
@InitialState
class B extends A {}
@InitialState
class C extends B {}
@InitialState
class D extends C {}
@InitialState
class E extends D {}
@InitialState
class F extends E {}

describe(`Switch TraceLevel`, function (): void {
	let sm: OwnerActor<TraceLevelConfig>;
	let port: TestPort;

	beforeEach(async () => {
		port = new TestPort();
		sm = makeOwnerActor(HsmTop as never, {}, port);
		traceActorOnPort(sm, port);
		await sm.hsm.sync();
	});

	it(`trace level switch`, async () => {
		expect(sm.hsm.currentState).eqls(F);

		sm.switchTraceLevel(TraceLevel.VERBOSE_DEBUG);
		await sm.hsm.sync();

		console.log('>>>');
		sm.hello();
		await sm.hsm.sync();
		console.log('<<<');

		sm.switchTraceLevel(TraceLevel.DEBUG);
		await sm.hsm.sync();

		console.log('>>>');
		sm.hello();
		await sm.hsm.sync();
		console.log('<<<');

		sm.switchTraceLevel(TraceLevel.PRODUCTION);
		await sm.hsm.sync();

		console.log('>>>');
		sm.hello();
		await sm.hsm.sync();
		console.log('<<<');

		// The TestPort observed each level switch and hello, in order.
		expect(port.events).eqls(['switchTraceLevel', 'hello', 'switchTraceLevel', 'hello', 'switchTraceLevel', 'hello']);
	});

	it('changes trace writer at runtime', async () => {
		const tw = new TestTraceWriter();
		sm.switchTraceWriter(tw);
		sm.hello();
		expect(tw.lines.filter(line => line.startsWith('TEST: '))).eqls([]);
	});
});
