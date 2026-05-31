import { expect } from 'chai';
import 'mocha';

import { INIT_TRACE, LeafEastA, LeafEastB, LeafWestA, LeafWestB, createDeepMachine } from './machine';
import { A, B, C, createTracer } from './trace-sibling';

function tailTrace(trace: string[], from: number): string[] {
	return trace.slice(from);
}

describe('Tutorial 05 · hierarchy and transitions', () => {
	describe('entry exit shallow siblings', () => {
		it('runs exit then entry across LCA when changing branch', async () => {
			const sm = createTracer();
			await sm.sync();
			expect(sm.currentState).equals(A);

			sm.post('goToB');
			await sm.sync();
			expect(sm.currentState).equals(B);
			expect(sm.ctx.log).includes('exit:A');
			expect(sm.ctx.log).includes('enter:B');

			sm.post('goToC');
			await sm.sync();
			expect(sm.currentState).equals(C);
			expect(sm.ctx.log).includes('exit:B');
			expect(sm.ctx.log).includes('enter:C');
			expect(sm.ctx.log.filter(line => line === 'exit:Top')).to.have.length(0);
		});
	});

	describe('01 initialization', () => {
		it('descends DeepTop → StackWest → MidWest → LeafWestA', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			expect(sm.currentState).equals(LeafWestA);
			expect(sm.ctx.trace).to.deep.equal(INIT_TRACE);
		});
	});

	describe('02 internal transition', () => {
		it('runs handler only — no exit/entry', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('tick');
			await sm.sync();

			expect(sm.currentState).equals(LeafWestA);
			expect(sm.ctx.value).equals(1);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['handler:tick']);
		});
	});

	describe('03 sibling (same parent, LCA = MidWest)', () => {
		it('LeafWestA → LeafWestB: exit source leaf, enter sibling', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goSiblingWest');
			await sm.sync();

			expect(sm.currentState).equals(LeafWestB);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'enter:LeafWestB']);
		});
	});

	describe('04 to parent composite', () => {
		it('LeafWestA → MidWest: re-enters @HsmInitialState leaf', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goParentWest');
			await sm.sync();

			expect(sm.currentState).equals(LeafWestA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'enter:LeafWestA']);
		});
	});

	describe('05 to ancestor composite', () => {
		it('LeafWestB → StackWest: LCA = StackWest, skips DeepTop', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			sm.post('goSiblingWest');
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goAncestorWest');
			await sm.sync();

			expect(sm.currentState).equals(LeafWestA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestB', 'exit:MidWest', 'enter:MidWest', 'enter:LeafWestA']);
		});
	});

	describe('06 to root (LCA = DeepTop)', () => {
		it('LeafWestA → DeepTop: exits west stack, re-enters initial west chain', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goRoot');
			await sm.sync();

			expect(sm.currentState).equals(LeafWestA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackWest', 'enter:MidWest', 'enter:LeafWestA']);
		});
	});

	describe('07 cross-stack to leaf', () => {
		it('LeafWestA → LeafEastB: LCA = DeepTop', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goCrossToLeafEastB');
			await sm.sync();

			expect(sm.currentState).equals(LeafEastB);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackEast', 'enter:MidEast', 'enter:LeafEastB']);
		});
	});

	describe('08 cross-stack to branch composite', () => {
		it('LeafWestA → StackEast: descends to initial leaf LeafEastA', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goCrossToBranchEast');
			await sm.sync();

			expect(sm.currentState).equals(LeafEastA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackEast', 'enter:MidEast', 'enter:LeafEastA']);
		});
	});

	describe('09 cross-stack to mid composite', () => {
		it('LeafWestA → MidEast: same entry path when initial chain matches', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goCrossToMidEast');
			await sm.sync();

			expect(sm.currentState).equals(LeafEastA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackEast', 'enter:MidEast', 'enter:LeafEastA']);
		});
	});

	describe('10 self-transition', () => {
		it('LeafWestA → LeafWestA: no exit/entry', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goSelfWest');
			await sm.sync();

			expect(sm.currentState).equals(LeafWestA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal([]);
		});
	});

	describe('11 east-stack sibling', () => {
		it('LeafEastB → LeafEastA: LCA = MidEast (mirror of case 03)', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			sm.restore(LeafEastB, { ...sm.ctx, trace: [...sm.ctx.trace] });
			const base = sm.ctx.trace.length;

			sm.post('goSiblingEast');
			await sm.sync();

			expect(sm.currentState).equals(LeafEastA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafEastB', 'enter:LeafEastA']);
		});
	});

	describe('12 cross-stack return', () => {
		it('LeafEastA → LeafWestB: LCA = DeepTop (reverse direction)', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			sm.restore(LeafEastA, { ...sm.ctx, trace: [...sm.ctx.trace] });
			const base = sm.ctx.trace.length;

			sm.post('goCrossToLeafWestB');
			await sm.sync();

			expect(sm.currentState).equals(LeafWestB);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafEastA', 'exit:MidEast', 'exit:StackEast', 'enter:StackWest', 'enter:MidWest', 'enter:LeafWestB']);
		});
	});

	describe('13 async cross-stack', () => {
		it('await in handler, then transition to east leaf', async () => {
			const sm = createDeepMachine();
			await sm.sync();
			const base = sm.ctx.trace.length;

			sm.post('goAsyncCrossEast');
			await sm.sync();

			expect(sm.currentState).equals(LeafEastA);
			expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['handler:goAsyncCrossEast:start', 'handler:goAsyncCrossEast:after-await', 'exit:LeafWestA', 'exit:MidWest', 'exit:StackWest', 'enter:StackEast', 'enter:MidEast', 'enter:LeafEastA']);
		});
	});

	describe('14 errors', () => {
		it('onExit throw → HsmFatalErrorState', async () => {
			const sm = createDeepMachine();
			await sm.sync();

			sm.post('armFailExit');
			await sm.sync();
			sm.post('goCrossToLeafEastB');
			await sm.sync();

			expect(sm.currentState.name).equals('HsmFatalErrorState');
		});

		it('unhandled event → HsmFatalErrorState', async () => {
			const sm = createDeepMachine();
			await sm.sync();

			sm.post('notInProtocol' as 'tick');
			await sm.sync();

			expect(sm.currentState.name).equals('HsmFatalErrorState');
		});
	});
});
