import { expect } from 'chai';
import 'mocha';
import { defineStateName, registerStateNames, TopState } from '../';
import { getStateName } from '../internal/utils';
import { isBrowserMinTestEnv } from './spec.utils';

describe('state display names', () => {
	it('registers and reads explicit names', () => {
		class NamedState extends TopState {}
		defineStateName(NamedState, 'Explicit');
		expect(getStateName(NamedState)).equals('Explicit');
	});

	it('registers names in bulk from an exports map', () => {
		class Alpha extends TopState {}
		class Beta extends TopState {}
		registerStateNames({ Alpha, Beta, notAStateClass: () => undefined, alsoIgnored: 42 });
		expect(getStateName(Alpha)).equals('Alpha');
		expect(getStateName(Beta)).equals('Beta');
	});

	it('falls back to constructor.name', function () {
		if (isBrowserMinTestEnv()) {
			this.skip();
		}
		class Fallback extends TopState {}
		expect(getStateName(Fallback)).equals('Fallback');
	});

	it('does not inherit a parent state display name through the class prototype chain', () => {
		class Parent extends TopState {}
		class Child extends Parent {}
		defineStateName(Parent, 'ParentOnly');
		expect(getStateName(Parent)).equals('ParentOnly');
		expect(getStateName(Child)).equals('Child');
	});
});
