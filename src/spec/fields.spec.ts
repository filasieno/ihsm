import { expect } from 'chai';
import 'mocha';
import { Hsm, makeHsm, InitialState, StateClass, TopState, TraceLevel, TraceWriter } from '../';
import { clearLastError, TRACE_LEVELS, registerSpecStateNames } from './spec.utils';

type State = StateClass<Report>;

class Report {
	eventName?: string;
	eventPayload?: any[];
	traceHeader?: string;
	topState?: State;
	currentStateName?: string;
	currentState?: State;
	ctxTypeName?: string;
	traceLevel?: TraceLevel;
	topStateName?: string;
	traceWriter?: TraceWriter;
}

class HsmTop extends TopState<Report> {
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

@InitialState
class A extends HsmTop {}

@InitialState
class B extends A {}

registerSpecStateNames({ HsmTop, A, B });

for (const traceLevel of TRACE_LEVELS) {
	describe(`Fields (traceLevel = ${traceLevel})`, () => {
		let sm: Hsm;
		beforeEach(async () => {
			clearLastError();
		});

		it(`are available`, async () => {
			const ctx = new Report();
			sm = makeHsm(HsmTop, ctx, true, traceLevel);
			sm.post('report', 'hello world');
			await sm.sync();
			expect(sm.currentStateName).eq('B');
			expect(ctx.eventName).eq('report');
			expect(ctx.eventPayload).eqls(['hello world']);
			expect(ctx.currentState).eq(B);
			expect(ctx.currentStateName).eq('B');
			expect(ctx.topState).eq(HsmTop);
			expect(ctx.ctxTypeName).eq('Report');
			expect(ctx.traceLevel).eq(traceLevel);
			expect(ctx.topStateName).eq('HsmTop');
			expect(ctx.traceWriter).eq(sm.traceWriter);
		});
	});
}
