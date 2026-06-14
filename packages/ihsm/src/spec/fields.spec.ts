import { expect } from 'chai';
import 'mocha';
import { InitialState, StateClass, TopState, TraceLevel, TraceWriter } from '../';
import type { TestActor } from '../testing';
import { makeTestActor, TestPort } from '../testing';
import * as self from './fields.spec';
import { clearLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

//#region ThisTestSpec

type State = StateClass;

class Report {
	eventName?: string;
	eventPayload?: any[];
	traceHeader?: string;
	topState?: State;
	currentStateName?: string;
	currentState?: State;
	traceLevel?: TraceLevel;
	topStateName?: string;
	traceWriter?: TraceWriter;
}

interface FieldsConfig {
	context: Report;
	notifications: {
		report(msg: string): void;
	};
}

export class HsmTop extends TopState<FieldsConfig> {
	report(msg: string): void {
		console.log(`received message: ${msg}`);
		this.ctx.eventName = this.hsm.eventName;
		this.ctx.eventPayload = this.hsm.eventPayload;
		this.ctx.currentState = this.hsm.currentState;
		this.ctx.currentStateName = this.hsm.currentStateName;
		this.ctx.traceHeader = this.hsm.traceHeader;
		expect(this.hsm.ctx).eq(this.ctx);
		this.ctx.topState = this.hsm.topState;
		this.ctx.traceLevel = this.hsm.traceLevel;
		this.ctx.topStateName = this.hsm.topStateName;
		this.ctx.traceWriter = this.hsm.traceWriter;
	}
}

@InitialState
export class A extends HsmTop {}

@InitialState
export class B extends A {}

registerSpecStateNames(self);
//#endregion

for (const traceLevel of TRACE_LEVELS) {
	describe(`Fields (traceLevel = ${traceLevel})`, () => {
		let sm: TestActor<FieldsConfig>;
		beforeEach(async () => {
			clearLastError();
		});

		it(`are available`, async () => {
			const ctx = new Report();
			const port = new TestPort();
			sm = makeTestActor(HsmTop, ctx, port, { traceLevel });
			traceActorOnPort(sm, port);
			sm.notify.report('hello world');
			await sm.hsm.sync();
			expect(port.trace).eqls(['report:hello world']);
			expect(sm.hsm.currentStateName).eq('B');
			expect(ctx.eventName).eq('report');
			expect(ctx.eventPayload).eqls(['hello world']);
			expect(ctx.currentState).eq(B);
			expect(ctx.currentStateName).eq('B');
			expect(ctx.topState).eq(HsmTop);
			expect(sm.ctx).eq(ctx);
			expect(ctx.traceLevel).eq(traceLevel);
			expect(ctx.topStateName).eq('HsmTop');
			expect(ctx.traceWriter).eq(sm.hsm.traceWriter);
		});
	});
}
