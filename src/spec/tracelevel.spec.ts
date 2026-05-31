import { expect } from 'chai';
import 'mocha';
import { makeHsm, Hsm, InitialState, TopState, TraceLevel, Any, TraceWriter } from '../';
import * as ihsm from '../index';

interface Protocol {
	switchTraceWriter(tw: TraceWriter): Promise<void>;
	switchTraceLevel(tl: TraceLevel): Promise<void>;
	hello(): void;
}

class HsmTop extends TopState<Any, Protocol> {
	async switchTraceWriter(tw: TraceWriter): Promise<void> {
		this.traceWriter = tw;
	}
	async switchTraceLevel(tl: TraceLevel): Promise<void> {
		console.log(`new trace level = ${TraceLevel[tl]}`);
		this.traceLevel = tl;
	}

	hello(): void {
		console.log(`Hello: TraceLevel = ${TraceLevel[this.traceLevel]}`);
	}
}

class TestTraceWriter implements ihsm.TraceWriter {
	lines: string[] = [];
	write<Context, Protocol extends {} | undefined>(hsm: ihsm.Properties<Context, Protocol>, msg: any): void {
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
	let sm: Hsm<Any, Protocol>;

	beforeEach(async () => {
		sm = makeHsm(HsmTop, {}, true, TraceLevel.VERBOSE_DEBUG);
		await sm.sync();
	});

	it(`trace level switch`, async () => {
		expect(sm.currentState).eqls(F);

		sm.post('switchTraceLevel', TraceLevel.VERBOSE_DEBUG);
		await sm.sync();

		console.log('>>>');
		sm.post('hello');
		await sm.sync();
		console.log('<<<');

		sm.post('switchTraceLevel', TraceLevel.DEBUG);
		await sm.sync();

		console.log('>>>');
		sm.post('hello');
		await sm.sync();
		console.log('<<<');

		sm.post('switchTraceLevel', TraceLevel.PRODUCTION);
		await sm.sync();

		console.log('>>>');
		sm.post('hello');
		await sm.sync();
		console.log('<<<');
	});

	it('changes trace writer at runtime', async () => {
		const tw = new TestTraceWriter();
		sm.post('switchTraceWriter', tw);
		sm.post('hello');
		expect(tw.lines.filter(line => line.startsWith('TEST: '))).eqls([]);
	});
});
