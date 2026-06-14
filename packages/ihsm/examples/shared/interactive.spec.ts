import { expect } from 'chai';
import 'mocha';

import { interactive as t00 } from '../00-config/interactive';
import { interactive as t01 } from '../01-hello-state-machine/interactive';
import { interactive as t02 } from '../02-tracing/interactive';
import { interactive as t03 } from '../03-context/interactive';
import { interactive as t04 } from '../04-protocol-typing/interactive';
import { interactive as t05 } from '../05-hierarchy/interactive';
import { interactive as t07 } from '../07-internal-transitions/interactive';
import { interactive as t08 } from '../08-post-and-sync/interactive';
import { interactive as t09 } from '../09-deferred-post/interactive';
import { interactive as t10 } from '../10-call-services/interactive';
import { interactive as t11 } from '../11-restore/interactive';
import { interactive as t12 } from '../12-error-recovery/interactive';
import { interactive as t13 } from '../13-async-handlers/interactive';
import { interactive as t14 } from '../14-nested-machines/interactive';
import { interactive as t15 } from '../15-complex-workflow/interactive';
import { interactive as t17 } from '../17-post-now/interactive';
import { interactive as t18 } from '../18-chained-child-actors/interactive';
import { interactive as t19 } from '../19-request-manager/interactive';
import { interactive as testing01 } from '../testing-01-deferred-timers/interactive';
import { interactive as testing02 } from '../testing-02-network-fetch/interactive';
import { interactive as testing03 } from '../testing-03-event-streaming/interactive';
import { interactive as testing04 } from '../testing-04-fault-injection/interactive';
import { interactive as testing05 } from '../testing-05-subscriptions-and-disposables/interactive';
import { dispatchMessage, traceFromRuntime } from './interactive-helpers';

const all = [t00, t01, t02, t03, t04, t05, t07, t08, t09, t10, t11, t12, t13, t14, t15, t17, t18, t19, testing01, testing02, testing03, testing04, testing05];

describe('Interactive tutorial metadata', () => {
	for (const [index, meta] of all.entries()) {
		it(`tutorial ${index + 1} exposes senders and messages`, () => {
			expect(meta.senders.length).to.be.greaterThan(0);
			for (const sender of meta.senders) {
				expect(meta.messagesBySender[sender.id]?.length ?? 0).to.be.greaterThan(0);
			}
			const runtime = meta.createRuntime();
			const summary = meta.stateSummary(runtime);
			expect(summary).to.be.a('string');
			expect(summary.length).to.be.greaterThan(0);
			expect(summary).to.match(/State:|Payment:|Gateway state:|Order:|Manager:/);
		});
	}

	it('tutorial 01 dispatch updates trace', async () => {
		const runtime = t01.createRuntime();
		const sender = t01.senders[0].id;
		const message = t01.messagesBySender[sender][0];
		await dispatchMessage(runtime, sender, message, {});
		expect(traceFromRuntime(runtime)).to.match(/open/);
	});

	it('tutorial 01 state summary uses export names, not minified class names', async () => {
		const runtime = t01.createRuntime();
		if (runtime.kind !== 'single') {
			throw new Error('expected single-machine runtime');
		}
		await runtime.sm.hsm.sync();
		const summary = t01.stateSummary(runtime);
		expect(summary).to.include('Closed');
		expect(summary).to.not.match(/State: [a-z] ·/);
	});

	it('tutorial 01 trace uses export names, not minified class names', async () => {
		const runtime = t01.createRuntime();
		if (runtime.kind !== 'single') {
			throw new Error('expected single-machine runtime');
		}
		await runtime.sm.hsm.sync();
		const trace = traceFromRuntime(runtime);
		expect(trace).to.include('Closed');
		expect(trace).to.match(/initialize\|.*Closed/);
	});
});
