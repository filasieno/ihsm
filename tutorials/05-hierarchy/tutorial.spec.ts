import { expect } from 'chai';
import 'mocha';

import {
	INIT_TRACE,
	LeafEast,
	LeafNorthA,
	LeafNorthB,
	LeafSouthA,
	LeafSouthB,
	createDeepMachine,
} from './machine';

function tailTrace(trace: string[], from: number): string[] {
	return trace.slice(from);
}

describe('Tutorial 05: deep hierarchy and transitions', () => {
	it('init: descends initial chain DeepTop → BranchSouth → MidSouth → LeafSouthA', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		expect(sm.currentState).equals(LeafSouthA);
		expect(sm.ctx.trace).to.deep.equal(INIT_TRACE);
	});

	it('internal transition: handler only, no exit/entry', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('tick');
		await sm.sync();

		expect(sm.currentState).equals(LeafSouthA);
		expect(sm.ctx.value).equals(1);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['handler:tick']);
	});

	it('child to sibling child: exit leaf, enter sibling, ancestors stay active', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('goSibling');
		await sm.sync();

		expect(sm.currentState).equals(LeafSouthB);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafSouthA', 'enter:LeafSouthB']);
	});

	it('child to parent composite: exits leaf (re-enters initial leaf of parent)', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('goParent');
		await sm.sync();

		// MidSouth has @HsmInitialState LeafSouthA — runtime ends on initial leaf again
		expect(sm.currentState).equals(LeafSouthA);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal(['exit:LeafSouthA', 'enter:LeafSouthA']);
	});

	it('child to ancestor: exits up to BranchSouth, skips DeepTop', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		sm.post('goSibling');
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('goAncestor');
		await sm.sync();

		expect(sm.currentState).equals(LeafSouthA);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal([
			'exit:LeafSouthB',
			'exit:MidSouth',
			'enter:MidSouth',
			'enter:LeafSouthA',
		]);
	});

	it('child to root: exits entire south branch', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('goRoot');
		await sm.sync();

		expect(sm.currentState).equals(LeafSouthA);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal([
			'exit:LeafSouthA',
			'exit:MidSouth',
			'exit:BranchSouth',
			'enter:BranchSouth',
			'enter:MidSouth',
			'enter:LeafSouthA',
		]);
	});

	it('child to leaf under another branch (LCA = DeepTop)', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('goCrossBranch');
		await sm.sync();

		expect(sm.currentState).equals(LeafNorthB);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal([
			'exit:LeafSouthA',
			'exit:MidSouth',
			'exit:BranchSouth',
			'enter:BranchNorth',
			'enter:MidNorth',
			'enter:LeafNorthB',
		]);
	});

	it('child to composite in another branch: descends to initial leaf', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('goComposite');
		await sm.sync();

		expect(sm.currentState).equals(LeafEast);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal([
			'exit:LeafSouthA',
			'exit:MidSouth',
			'exit:BranchSouth',
			'enter:BranchEast',
			'enter:LeafEast',
		]);
	});

	it('self-transition: no exit/entry when target equals source leaf', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('goSelf');
		await sm.sync();

		expect(sm.currentState).equals(LeafSouthA);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal([]);
	});

	it('async handler then transition: sync waits for full chain', async () => {
		const sm = createDeepMachine();
		await sm.sync();
		const base = sm.ctx.trace.length;

		sm.post('goAsyncCross');
		await sm.sync();

		expect(sm.currentState).equals(LeafNorthA);
		expect(tailTrace(sm.ctx.trace, base)).to.deep.equal([
			'handler:goAsyncCross:start',
			'handler:goAsyncCross:after-await',
			'exit:LeafSouthA',
			'exit:MidSouth',
			'exit:BranchSouth',
			'enter:BranchNorth',
			'enter:MidNorth',
			'enter:LeafNorthA',
		]);
	});

	it('transition error: onExit throw becomes HsmTransitionError then fatal state', async () => {
		const sm = createDeepMachine();
		await sm.sync();

		sm.post('armFailExit');
		await sm.sync();
		sm.post('goCrossBranch');
		await sm.sync();

		expect(sm.currentState.name).equals('HsmFatalErrorState');
	});

	it('unhandled event: recovery fails → HsmFatalErrorState', async () => {
		const sm = createDeepMachine();
		await sm.sync();

		sm.post('notInProtocol' as 'tick');
		await sm.sync();

		expect(sm.currentState.name).equals('HsmFatalErrorState');
	});
});
