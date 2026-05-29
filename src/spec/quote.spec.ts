import { expect } from 'chai';
import 'mocha';
import { quoteError } from '../internal/utils';

describe(`quote error`, () => {
	it(`with no error message`, async () => {
		expect(quoteError(new Error())).equals('Error with no error message');
	});

	it(`with error message`, async () => {
		expect(quoteError(new Error('error message'))).equals('Error: error message');
	});
});
