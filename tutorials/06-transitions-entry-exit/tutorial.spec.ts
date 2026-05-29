import { expect } from 'chai';
import 'mocha';

import { A, B, C, createTracer } from './machine';

describe('Tutorial 06: transitions entry exit', () => {
	it('runs exit then entry across LCA when changing branch', async () => {
		const sm = createTracer();
		await sm.sync();
		// Init already ran onEntry for Top and A
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
		// B and C are siblings under TraceTop — Top is not exited
		expect(sm.ctx.log.filter(line => line === 'exit:Top')).to.have.length(0);
	});
});
