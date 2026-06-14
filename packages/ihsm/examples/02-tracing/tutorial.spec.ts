import { expect } from 'chai';
import 'mocha';

import { CollectingTraceWriter, expectTraceMatching } from '../shared/trace';
import { Ready, createTracedPing } from './machine';

describe('Tutorial 02: tracing', () => {
	it('captures VERBOSE_DEBUG trace lines via custom writer', async () => {
		const writer = new CollectingTraceWriter();
		const sm = createTracedPing(writer);
		await sm.hsm.sync();
		expect(sm.hsm.currentState).equals(Ready);

		const before = writer.lines.length;
		sm.notify.ping();
		await sm.hsm.sync();
		expect(sm.ctx.pings).equals(1);
		expect(writer.lines.length).greaterThan(before);
		expectTraceMatching(writer, [/#ping\|.*started event dispatch/, /ping count is now 1/]);
	});
});
