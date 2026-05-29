import { expect } from 'chai';
import 'mocha';

import { Hsm, HsmAny, HsmFactory, HsmInitialState, HsmTopState, HsmTraceLevel } from '../';

import { TRACE_LEVELS } from './spec.utils';

interface Protocol {
	setValue(value: string, object: HsmAny): Promise<void>;
}

class TopState extends HsmTopState<HsmAny, Protocol> implements Protocol {
	async setValue(value: string, object: HsmAny): Promise<void> {
		object.value = value;
		console.log(`new value = ${value}`);
	}
}

@HsmInitialState
class A extends TopState {}

async function sleep(millis: number): Promise<void> {
	return new Promise((resolve: () => void) => {
		setTimeout(() => resolve(), millis);
	});
}

for (const traceLevel of TRACE_LEVELS) {
	describe(`Deferred post (traceLevel = ${traceLevel})`, function(): void {
		let sm: Hsm<HsmAny, Protocol>;
		const factory = new HsmFactory(TopState);

		beforeEach(async () => {
			factory.traceLevel = traceLevel;
			sm = factory.create({});
			await sm.sync();
		});

		it(`executes a deferred post`, async () => {
			expect(sm.currentState).equals(A);
			const obj: HsmAny = { value: '' };
			sm.deferredPost(600, 'setValue', 'first', obj);
			sm.deferredPost(10, 'setValue', 'second', obj);
			await sleep(1500);
			await sm.sync();
			expect(obj.value).equals('first');
		});
	});
}
