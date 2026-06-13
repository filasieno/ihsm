import { expect } from 'chai';
import 'mocha';
import { defineStateName, registerStateNames, TopState } from '../';
import { getStateName } from '../internal/runtime';
import * as self from './state-names.spec';
import { isBrowserMinTestEnv, registerSpecStateNames } from './spec.utils';

//#region ThisTestSpec

export class NamedState extends TopState {}

export class Alpha extends TopState {}

export class Beta extends TopState {}

export class Fallback extends TopState {}

export class Parent extends TopState {}

export class Child extends Parent {}

registerSpecStateNames(self);
//#endregion

describe('state display names', () => {
	it('registers and reads explicit names', () => {
		class LocalNamedState extends TopState {}
		defineStateName(LocalNamedState, 'Explicit');
		expect(getStateName(LocalNamedState)).equals('Explicit');
	});

	it('registers names in bulk from an exports map', () => {
		expect(getStateName(Alpha)).equals('Alpha');
		expect(getStateName(Beta)).equals('Beta');
		registerStateNames({ notAStateClass: () => undefined, alsoIgnored: 42 });
	});

	it('falls back to constructor.name', function () {
		if (isBrowserMinTestEnv()) {
			this.skip();
		}
		expect(getStateName(Fallback)).equals('Fallback');
	});

	it('does not inherit a parent state display name through the class prototype chain', () => {
		expect(getStateName(Parent)).equals('Parent');
		expect(getStateName(Child)).equals('Child');
	});
});
