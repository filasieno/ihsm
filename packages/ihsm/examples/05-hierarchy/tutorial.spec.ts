import { expect } from 'chai';
import 'mocha';

import { kMachine } from '../../src/internal/runtime';
import type { HandleOwn } from '../../src/internal/runtime';
import { INIT_TRACE, LeafEastA, LeafEastB, LeafWestA, LeafWestB, createDeepMachine } from './machine';
import { A, B, C, createTracer } from './trace-sibling';

function dispatchUnknown(actor: HandleOwn, event: string, ...args: unknown[]): void {
	actor[kMachine].dispatchNotification(event, args, 'default');
}

function tailTrace(trace: string[], from: number): string[] {
	return trace.slice(from);
}

describe('Tutorial 05 · hierarchy and transitions', () => {
	describe('entry exit shallow siblings', () => {
		it('runs exit then entry across LCA when changing branch', async () => {
			const sm = createTracer();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(A);

			sm.notify.goToB();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(B);
			expect(sm.ctx.log).includes('exit:A');
			expect(sm.ctx.log).includes('enter:B');

			sm.notify.goToC();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(C);
			expect(sm.ctx.log).includes('exit:B');
			expect(sm.ctx.log).includes('enter:C');
			expect(sm.ctx.log.filter(line => line === 'exit:Top')).to.have.length(0);
		});
	});

	describe('01 initialization', () => {
		it('descends DeepTop → StackWest → MidWest → LeafWestA', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			expect(sm.hsm.currentState).equals(LeafWestA);
			expect(sm.ctx.trace).to.deep.equal(INIT_TRACE);
		});
	});

	describe('02 internal transition', () => {
		it('runs handler only — no exit/entry', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.tick();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafWestA);
			expect(sm.ctx.value).equals(1);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['handler:tick']);
		});
	});

	describe('03 sibling (same parent, LCA = MidWest)', () => {
		it('LeafWestA → LeafWestB: exit source leaf, enter sibling', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goSiblingWest();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafWestB);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'enter:LeafWestB']);
		});
	});

	describe('04 to parent composite', () => {
		it('LeafWestA → MidWest: re-enters @InitialState leaf', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goParentWest();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafWestA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'enter:LeafWestA']);
		});
	});

	describe('05 to ancestor composite', () => {
		it('LeafWestB → StackWest: LCA = StackWest, skips DeepTop', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			sm.notify.goSiblingWest();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goAncestorWest();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafWestA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestB', 'exit:MidWest', 'enter:MidWest', 'enter:LeafWestA']);
		});
	});

	describe('06 to root (LCA = DeepTop)', () => {
		it('LeafWestA → DeepTop: exits west stack, re-enters initial west chain', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goRoot();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafWestA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackWest', 'enter:MidWest', 'enter:LeafWestA']);
		});
	});

	describe('07 cross-stack to leaf', () => {
		it('LeafWestA → LeafEastB: LCA = DeepTop', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goCrossToLeafEastB();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafEastB);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackEast', 'enter:MidEast', 'enter:LeafEastB']);
		});
	});

	describe('08 cross-stack to branch composite', () => {
		it('LeafWestA → StackEast: descends to initial leaf LeafEastA', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goCrossToBranchEast();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafEastA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackEast', 'enter:MidEast', 'enter:LeafEastA']);
		});
	});

	describe('09 cross-stack to mid composite', () => {
		it('LeafWestA → MidEast: same entry path when initial chain matches', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goCrossToMidEast();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafEastA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackEast', 'enter:MidEast', 'enter:LeafEastA']);
		});
	});

	describe('10 self-transition', () => {
		it('LeafWestA → LeafWestA: no exit/entry', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goSelfWest();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafWestA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal([]);
		});
	});

	describe('11 east-stack sibling', () => {
		it('LeafEastB → LeafEastA: LCA = MidEast (mirror of case 03)', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			sm.hsm.restore(LeafEastB, { ...sm.ctx, trace: [...sm.ctx.trace] });
			const base = sm.ctx.trace.length;

			sm.notify.goSiblingEast();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafEastA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafEastB', 'enter:LeafEastA']);
		});
	});

	describe('12 cross-stack return', () => {
		it('LeafEastA → LeafWestB: LCA = DeepTop (reverse direction)', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			sm.hsm.restore(LeafEastA, { ...sm.ctx, trace: [...sm.ctx.trace] });
			const base = sm.ctx.trace.length;

			sm.notify.goCrossToLeafWestB();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafWestB);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafEastA', 'exit:MidEast', 'exit:StackEast', 'enter:StackWest', 'enter:MidWest', 'enter:LeafWestB']);
		});
	});

	describe('13 async cross-stack', () => {
		it('await in handler, then transition to east leaf', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();
			const base = sm.ctx.trace.length;

			sm.notify.goAsyncCrossEast();
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafEastA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['handler:goAsyncCrossEast:start', 'handler:goAsyncCrossEast:after-await', 'exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackEast', 'enter:MidEast', 'enter:LeafEastA']);
		});
	});

	describe('14 errors', () => {
		it('onExit throw → FatalErrorState', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();

			sm.notify.armFailExit();
			await sm.hsm.sync();
			sm.notify.goCrossToLeafEastB();
			await sm.hsm.sync();

			expect(sm.hsm.currentStateName).equals('FatalErrorState');
		});

		it('unhandled event is ignored (playground onUnhandled)', async () => {
			const sm = createDeepMachine();
			await sm.hsm.sync();

			dispatchUnknown(sm, 'notInProtocol');
			await sm.hsm.sync();

			expect(sm.hsm.currentState).equals(LeafWestA);
		});
	});
});
