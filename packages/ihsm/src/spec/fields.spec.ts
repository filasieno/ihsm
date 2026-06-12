import { expect } from 'chai';
import 'mocha';
import { InitialState, StateClass, TopState, TraceLevel, TraceWriter, makeOwnerActor, manifestFor } from '../';
import type { Config, OwnerActor } from '../';
import { TestPort } from '../testing';
import { clearLastError, TRACE_LEVELS, registerSpecStateNames, traceActorOnPort } from './spec.utils';

type State = StateClass<Report, Record<string, unknown>>;

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

interface FieldsConfig extends Config {
	context: Report;
	notifications: {
		report(msg: string): void;
	};
}

const fieldsManifest = manifestFor<FieldsConfig>({
	services: [],
	notifications: ['report'],
	internalServices: [],
	internalNotifications: [],
});

class HsmTop extends TopState {
	static readonly manifest = fieldsManifest;
	declare readonly __ihsm: FieldsConfig;

	report(msg: string): void {
		console.log(`received message: ${msg}`);
		this.ctx.eventName = this.hsm.eventName;
		this.ctx.eventPayload = this.hsm.eventPayload;
		this.ctx.currentState = this.hsm.currentState;
		this.ctx.currentStateName = this.hsm.currentStateName;
		this.ctx.traceHeader = this.hsm.traceHeader;
		this.ctx.topState = this.hsm.topState;
		this.ctx.ctxTypeName = this.hsm.ctxTypeName;
		this.ctx.traceLevel = this.hsm.traceLevel;
		this.ctx.topStateName = this.hsm.topStateName;
		this.ctx.traceWriter = this.hsm.traceWriter;
	}
}

@InitialState
class A extends HsmTop {}

@InitialState
class B extends A {}

registerSpecStateNames({ HsmTop, A, B });

for (const traceLevel of TRACE_LEVELS) {
	describe(`Fields (traceLevel = ${traceLevel})`, () => {
		let sm: OwnerActor<FieldsConfig>;
		beforeEach(async () => {
			clearLastError();
		});

		it(`are available`, async () => {
			const ctx = new Report();
			const port = new TestPort();
			sm = makeOwnerActor(HsmTop as never, ctx, port, { traceLevel });
			traceActorOnPort(sm, port);
			sm.report('hello world');
			await sm.hsm.sync();
			expect(port.trace).eqls(['report:hello world']);
			expect(sm.hsm.currentStateName).eq('B');
			expect(ctx.eventName).eq('report');
			expect(ctx.eventPayload).eqls(['hello world']);
			expect(ctx.currentState).eq(B);
			expect(ctx.currentStateName).eq('B');
			expect(ctx.topState).eq(HsmTop);
			expect(ctx.ctxTypeName).eq('Report');
			expect(ctx.traceLevel).eq(traceLevel);
			expect(ctx.topStateName).eq('HsmTop');
			expect(ctx.traceWriter).eq(sm.hsm.traceWriter);
		});
	});
}
