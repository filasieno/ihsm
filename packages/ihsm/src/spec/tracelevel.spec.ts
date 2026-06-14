import { expect } from 'chai';
import 'mocha';
import { InitialState, TopState, TraceLevel, TraceWriter } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as ihsm from '../index';
import * as self from './tracelevel.spec';
import { registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

interface TraceLevelConfig {
	context: Record<string, never>;
	notifications: {
		switchTraceWriter(tw: TraceWriter): Promise<void>;
		switchTraceLevel(tl: TraceLevel): Promise<void>;
		hello(): void;
	};
}

export class HsmTop extends TopState<TraceLevelConfig> {
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
export class A extends HsmTop {}
@InitialState
export class B extends A {}
@InitialState
export class C extends B {}
@InitialState
export class D extends C {}
@InitialState
export class E extends D {}
@InitialState
export class F extends E {}

registerSpecStateNames(self);
//#endregion

describe(`Switch TraceLevel`, function (): void {
	let sm: TestActor<TraceLevelConfig>;
	let port: TestPort;

	beforeEach(async () => {
		port = new TestPort();
		sm = makeTestActor(HsmTop, {}, port);
		traceActorOnPort(sm, port);
		await sm.hsm.sync();
	});

	it(`trace level switch`, async () => {
		expect(sm.hsm.currentState).eqls(F);

		sm.notify.switchTraceLevel(TraceLevel.VERBOSE_DEBUG);
		await sm.hsm.sync();

		console.log('>>>');
		sm.notify.hello();
		await sm.hsm.sync();
		console.log('<<<');

		sm.notify.switchTraceLevel(TraceLevel.DEBUG);
		await sm.hsm.sync();

		console.log('>>>');
		sm.notify.hello();
		await sm.hsm.sync();
		console.log('<<<');

		sm.notify.switchTraceLevel(TraceLevel.PRODUCTION);
		await sm.hsm.sync();

		console.log('>>>');
		sm.notify.hello();
		await sm.hsm.sync();
		console.log('<<<');

		// The TestPort observed each level switch and hello, in order.
		expect(port.events).eqls(['switchTraceLevel', 'hello', 'switchTraceLevel', 'hello', 'switchTraceLevel', 'hello']);
	});

	it('changes trace writer at runtime', async () => {
		const tw = new TestTraceWriter();
		sm.notify.switchTraceWriter(tw);
		sm.notify.hello();
		expect(tw.lines.filter(line => line.startsWith('TEST: '))).eqls([]);
	});
});
