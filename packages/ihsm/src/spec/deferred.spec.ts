import { expect } from 'chai';
import 'mocha';

import { Hsm, Any, makeHsm, InitialState, TopState } from '../';

import { TRACE_LEVELS } from './spec.utils';

interface Protocol {
	setValue(value: string, object: Any): Promise<void>;
}

class HsmTop extends TopState<Any, Protocol> implements Protocol {
	async setValue(value: string, object: Any): Promise<void> {
		object.value = value;
		console.log(`new value = ${value}`);
	}
}

@InitialState
class A extends HsmTop {}

async function sleep(millis: number): Promise<void> {
	return new Promise((resolve: () => void) => {
		setTimeout(() => resolve(), millis);
	});
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Deferred post (traceLevel = ${traceLevel})`, function (): void {
		let sm: Hsm<Any, Protocol>;

		beforeEach(async () => {
			sm = makeHsm(HsmTop, {}, true, traceLevel);
			await sm.sync();
		});

		it(`executes a deferred post`, async () => {
			expect(sm.currentState).equals(A);
			const obj: Any = { value: '' };
			sm.deferredPost(600, 'setValue', 'first', obj);
			sm.deferredPost(10, 'setValue', 'second', obj);
			await sleep(1500);
			await sm.sync();
			expect(obj.value).equals('first');
		});
	});
}
