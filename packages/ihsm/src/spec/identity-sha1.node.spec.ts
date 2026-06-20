import { createHash } from 'node:crypto';
import { expect } from 'chai';
import 'mocha';

import { sha1Pure } from '../internal/identity';

/** Node-only cross-check — not imported by browser test bundles. */
describe('internal/identity sha1Pure (node)', () => {
	it('matches node:crypto across block boundaries', () => {
		const enc = new TextEncoder();
		const inputs: Uint8Array[] = [new Uint8Array(0), enc.encode('abc'), enc.encode('a'.repeat(55)), enc.encode('a'.repeat(56)), enc.encode('a'.repeat(64)), enc.encode('the quick brown fox jumps over the lazy dog')];
		for (const input of inputs) {
			const expected = new Uint8Array(createHash('sha1').update(input).digest());
			expect([...sha1Pure(input)]).eqls([...expected]);
		}
	});
});
