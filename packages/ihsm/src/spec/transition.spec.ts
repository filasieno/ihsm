import { expect } from 'chai';
import 'mocha';
import { InitialState, StateClass, TopState, TraceLevel } from '../';
import { TestPort, TestActor, makeTestActor } from '../testing';
import { TRACE_LEVELS, clearLastError, registerSpecStateNames, traceActorOnPort } from './spec.utils';

type Cons = StateClass<TransitionTrace, Protocol>;

class TransitionTrace {
	public exitList: Cons[] = [];
	public entryList: Cons[] = [];
}

interface Protocol {
	transitionTo(s: Cons): void;
	clear(): void;
}

class HsmTop extends TopState<TransitionTrace, Protocol> implements Protocol {
	transitionTo(s: Cons): void {
		this.clear();
		this.transition(s);
	}
	clear(): void {
		this.ctx.entryList = [];
		this.ctx.exitList = [];
	}
	onEntry(): void {
		this.ctx.entryList.push(HsmTop);
	}
	onExit(): void {
		this.ctx.exitList.push(HsmTop);
	}
}

class A extends HsmTop implements Protocol {
	onEntry(): void {
		this.ctx.entryList.push(A);
	}
	onExit(): void {
		this.ctx.exitList.push(A);
	}
}

class A1 extends A {
	onEntry(): void {
		this.ctx.entryList.push(A1);
	}
	onExit(): void {
		this.ctx.exitList.push(A1);
	}
}

class A11 extends A1 {
	onEntry(): void {
		this.ctx.entryList.push(A11);
	}
	onExit(): void {
		this.ctx.exitList.push(A11);
	}
}

class A111 extends A11 {
	onEntry(): void {
		this.ctx.entryList.push(A111);
	}
	onExit(): void {
		this.ctx.exitList.push(A111);
	}
}

class A2 extends A {
	onEntry(): void {
		this.ctx.entryList.push(A2);
	}
	onExit(): void {
		this.ctx.exitList.push(A2);
	}
}

class A21 extends A2 {
	onEntry(): void {
		this.ctx.entryList.push(A21);
	}
	onExit(): void {
		this.ctx.exitList.push(A21);
	}
}

class A211 extends A21 {
	onEntry(): void {
		this.ctx.entryList.push(A211);
	}
	onExit(): void {
		this.ctx.exitList.push(A211);
	}
}

class A2111 extends A211 {
	onEntry(): void {
		this.ctx.entryList.push(A2111);
	}
	onExit(): void {
		this.ctx.exitList.push(A2111);
	}
}

class B extends HsmTop {
	onEntry(): void {
		this.ctx.entryList.push(B);
	}
	onExit(): void {
		this.ctx.exitList.push(B);
	}
}

class B1 extends B {
	onEntry(): void {
		this.ctx.entryList.push(B1);
	}
	onExit(): void {
		this.ctx.exitList.push(B1);
	}
}

@InitialState
class C extends HsmTop {
	onEntry(): void {
		this.ctx.entryList.push(C);
	}
	onExit(): void {
		this.ctx.exitList.push(C);
	}
}

@InitialState
class C1 extends C {
	onEntry(): void {
		this.ctx.entryList.push(C1);
	}
	onExit(): void {
		this.ctx.exitList.push(C1);
	}
}

@InitialState
class C11 extends C1 {
	onEntry(): void {
		this.ctx.entryList.push(C11);
	}
	onExit(): void {
		this.ctx.exitList.push(C11);
	}
}

@InitialState
class C111 extends C11 {
	onEntry(): void {
		this.ctx.entryList.push(C111);
	}
	onExit(): void {
		this.ctx.exitList.push(C111);
	}
}

@InitialState
class C1111 extends C111 {
	async onEntry(): Promise<void> {
		this.ctx.entryList.push(C1111);
	}
	async onExit(): Promise<void> {
		this.ctx.exitList.push(C1111);
	}
}

registerSpecStateNames({
	HsmTop,
	A,
	A1,
	A11,
	A111,
	A2,
	A21,
	A211,
	A2111,
	B,
	B1,
	C,
	C1,
	C11,
	C111,
	C1111,
});

for (const traceLevel of TRACE_LEVELS) {
	describe(`Transition (traceLevel = ${traceLevel})`, function () {
		let ctx: TransitionTrace;
		let sm: TestActor<TransitionTrace, Protocol, {}, TestPort>;
		let port: TestPort;
		beforeEach(async () => {
			clearLastError();
			ctx = new TransitionTrace();
			port = new TestPort();
			sm = makeTestActor(HsmTop, ctx, port, { traceLevel });
			traceActorOnPort(sm, port);
			await sm.sync();
		});

		it(`using sets the initial currentState following the @initialState annotation directives (traceLevel = ${traceLevel as TraceLevel})`, async (): Promise<void> => {
			expect(sm.currentState).eq(C1111);
			expect(ctx.entryList).to.eql([HsmTop, C, C1, C11, C111, C1111]);
		});

		it(`records every posted event on the attached TestPort (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			sm.post('transitionTo', A111);
			sm.post('clear');
			await sm.sync();
			expect(port.events).to.eql(['transitionTo', 'clear']);
		});

		it(`checks nextState to another branch with common ancestor (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			sm.post('transitionTo', A111);
			await sm.sync();

			expect(sm.currentStateName).eq('A111');
			expect(sm.currentState).eq(A111);

			sm.post('transitionTo', A211);
			await sm.sync();

			expect(sm.currentStateName, 'A211');
			expect(sm.currentState).eq(A211);

			expect(ctx.exitList).to.eql([A111, A11, A1]);
			expect(ctx.entryList).to.eql([A2, A21, A211]);
		});

		it(`checks nextState to ancestor (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			sm.post('transitionTo', A111);
			sm.post('transitionTo', A1);
			await sm.sync();

			expect(ctx.exitList).to.eql([A111, A11]);
			expect(ctx.entryList).to.eql([]);
		});

		it(`checks nextState to descendant (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			sm.post('transitionTo', A111);
			sm.post('transitionTo', A1);
			await sm.sync();

			expect(ctx.exitList).to.eql([A111, A11]);
			expect(ctx.entryList).to.eql([]);
		});

		it(`checks nextState to another branch without common ancestor (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			sm.post('transitionTo', A2111);
			sm.post('transitionTo', B1);
			await sm.sync();

			expect(ctx.exitList).to.eql([A2111, A211, A21, A2, A]);
			expect(ctx.entryList).to.eql([B, B1]);
		});

		it(`checks nextState to self (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			sm.post('transitionTo', A);
			sm.post('transitionTo', A);
			await sm.sync();

			expect(ctx.exitList).to.eql([]);
			expect(ctx.entryList).to.eql([]);
		});

		it(`checks nextState to a parent currentState (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			sm.post('transitionTo', A111);
			sm.post('transitionTo', C1);
			await sm.sync();

			expect(ctx.exitList).to.eql([A111, A11, A1, A]);
			expect(ctx.entryList).to.eql([C, C1, C11, C111, C1111]);
		});

		it(`checks nextState to parent currentState which initial currentState is the current currentState (traceLevel = ${traceLevel as TraceLevel})`, async () => {
			sm.post('transitionTo', C1111);
			sm.post('transitionTo', HsmTop);
			await sm.sync();

			expect(ctx.exitList).to.eql([C1111, C111, C11, C1, C]);
			expect(ctx.entryList).to.eql([C, C1, C11, C111, C1111]);
		});
	});
}
