import { expect } from 'chai';
import 'mocha';

import { FatalErrorState } from '@ihsm/core';

import * as oracle from '../fixtures/transition-oracle.machine';
import { buildTransitionRoutines } from '../oracle/routines';
import { runCoreTransition } from '../oracle/run-core';
import { runRoutineTransition } from '../oracle/run-routine';
import { generateTransitionTableModule } from '../generate';

const routines = buildTransitionRoutines(oracle.HsmTop, oracle.oracleExports);

describe('transition oracle (@ihsm/core vs generated routines)', function () {
	this.timeout(120_000);

	it('generates routines that delegate to ihsm/transition-routines', () => {
		const source = generateTransitionTableModule({
			topState: oracle.HsmTop,
			exports: oracle.oracleExports,
			importPath: './transition-oracle.machine',
		});
		expect(source).to.include("from 'ihsm/transition-routines'");
		expect(source).to.include('executeTransitionRoutine');
		expect(source).to.include('plan_A_to_B');
		expect(source).to.include(`TRANSITION_PLAN_COUNT =\n\t${routines.length} as const`);
	});

	for (const routine of routines) {
		it(`verbose trace matches for ${routine.key}`, async () => {
			const core = await runCoreTransition({ from: routine.from, to: routine.to });
			const generated = await runRoutineTransition({ routine, from: routine.from });

			expect(generated.trace, `routine trace for ${routine.key}`).to.eql(core.trace);
			expect(generated.finalState).to.equal(core.finalState);
		});
	}

	for (const routine of routines) {
		const failTargets: Array<{ state: oracle.Cons; hook: 'onEntry' | 'onExit' }> = [];
		for (const ref of routine.plan.exit) {
			failTargets.push({ state: ref as oracle.Cons, hook: 'onExit' });
		}
		for (const ref of routine.plan.entry) {
			failTargets.push({ state: ref as oracle.Cons, hook: 'onEntry' });
		}

		for (const fail of failTargets) {
			const label = `${routine.key} fail@${fail.hook}`;
			it(`error path matches for ${label}`, async () => {
				const core = await runCoreTransition({
					from: routine.from,
					to: routine.to,
					fail,
				});
				const generated = await runRoutineTransition({
					routine,
					from: routine.from,
					fail,
				});

				expect(generated.trace, `routine trace for ${label}`).to.eql(core.trace);
				expect(core.finalState).to.equal(FatalErrorState);
				expect(generated.finalState).to.equal(FatalErrorState);
				expect(core.error?.failedCallback).to.equal(fail.hook);
				expect(generated.error?.failedCallback).to.equal(fail.hook);
				expect(core.error?.failedStateName).to.equal(generated.error?.failedStateName);
			});
		}
	}
});
