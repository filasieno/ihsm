import { expect } from 'chai';
import 'mocha';

import { asError, quoteError, quoteUnknown } from '../internal/runtime';
import * as self from './quote.spec';
import { registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

registerSpecStateNames(self);

//#endregion

describe(`quote error`, () => {
	it(`with no error message`, async () => {
		expect(quoteError(new Error())).equals('Error with no error message');
	});

	it(`with error message`, async () => {
		expect(quoteError(new Error('error message'))).equals('Error: error message');
	});

	it(`quoteUnknown wraps non-Error values`, async () => {
		expect(quoteUnknown('boom')).equals('Error: boom');
		expect(asError('plain')).instanceOf(Error);
	});
});
