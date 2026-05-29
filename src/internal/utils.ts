/** @internal */
import { HsmStateClass } from '../';

// eslint-disable-next-line valid-jsdoc
/** @internal */
export function quoteError(err: Error): string {
	return `${err.name}${err.message ? `: ${err.message}` : ' with no error message'}`;
}

// eslint-disable-next-line valid-jsdoc
/** @internal */
export function getInitialState<Context, Protocol extends {} | undefined>(State: HsmStateClass<Context, Protocol>): HsmStateClass<Context, Protocol> {
	return (State as { [key: string]: any })._initialState as HsmStateClass<Context, Protocol>;
}

// eslint-disable-next-line valid-jsdoc
/** @internal */
export function hasInitialState<Context, Protocol extends {} | undefined>(State: HsmStateClass<Context, Protocol>): boolean {
	return Object.prototype.hasOwnProperty.call(State, '_initialState');
}

// eslint-disable-next-line valid-jsdoc
/** @internal */
export function getTransitionKey<Context, Protocol extends {} | undefined>(FromState: HsmStateClass<Context, Protocol>, ToState: HsmStateClass<Context, Protocol>): string {
	return `${FromState.name}=>${ToState.name}`;
}
