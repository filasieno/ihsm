import { expect } from 'chai';
import 'mocha';
import { Hsm, HsmFactory, HsmInitialState, HsmStateClass, HsmTopState, HsmTraceLevel, HsmTraceWriter } from '../';
import { clearLastError, TRACE_LEVELS } from './spec.utils';

type State = HsmStateClass<Report>;

class Report {
	eventName?: string;
	eventPayload?: any[];
	traceHeader?: string;
	topState?: State;
	currentStateName?: string;
	currentState?: State;
	ctxTypeName?: string;
	traceLevel?: HsmTraceLevel;
	topStateName?: string;
	traceWriter?: HsmTraceWriter;
}

class TopState extends HsmTopState<Report> {
	report(msg: string): void {
		console.log(`received message: ${msg}`);
		this.ctx.eventName = this.eventName;
		this.ctx.eventPayload = this.eventPayload;
		this.ctx.currentState = this.currentState;
		this.ctx.currentStateName = this.currentStateName;
		this.ctx.traceHeader = this.traceHeader;
		this.ctx.topState = this.topState;
		this.ctx.ctxTypeName = this.ctxTypeName;
		this.ctx.traceLevel = this.traceLevel;
		this.ctx.topStateName = this.topStateName;
		this.ctx.traceWriter = this.traceWriter;
	}
}

@HsmInitialState
class A extends TopState {}

@HsmInitialState
class B extends A {}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Fields (traceLevel = ${traceLevel})`, () => {
		let sm: Hsm;
		const factory = new HsmFactory(TopState);
		factory.traceLevel = traceLevel;

		beforeEach(async () => {
			clearLastError();
		});

		it(`are available`, async () => {
			const ctx = new Report();
			sm = factory.create(ctx);
			sm.post('report', 'hello world');
			await sm.sync();
			expect(sm.currentStateName).eq('B');
			expect(ctx.eventName).eq('report');
			expect(ctx.eventPayload).eqls(['hello world']);
			expect(ctx.currentState).eq(B);
			expect(ctx.currentStateName).eq('B');
			expect(ctx.topState).eq(factory.topState);
			expect(ctx.ctxTypeName).eq('Report');
			expect(ctx.traceLevel).eq(factory.traceLevel);
			expect(ctx.topStateName).eq('TopState');
			expect(ctx.traceWriter).eq(factory.traceWriter);
		});
	});
}
