/** @internal */
import { HsmStateClass } from '../';

/** @internal */
export function asError(err: unknown): Error {
	return err instanceof Error ? err : new Error(String(err));
}

/** @internal */
export function quoteUnknown(err: unknown): string {
	return quoteError(asError(err));
}

/** @internal */
export function quoteError(err: Error): string {
	return `${err.name}${err.message ? `: ${err.message}` : ' with no error message'}`;
}

/** @internal */
export function getInitialState<Context, Protocol extends {} | undefined>(State: HsmStateClass<Context, Protocol>): HsmStateClass<Context, Protocol> {
	return (State as { [key: string]: any })._initialState as HsmStateClass<Context, Protocol>;
}

/** @internal */
export function hasInitialState<Context, Protocol extends {} | undefined>(State: HsmStateClass<Context, Protocol>): boolean {
	return Object.prototype.hasOwnProperty.call(State, '_initialState');
}

/** @internal */
export function getTransitionKey<Context, Protocol extends {} | undefined>(FromState: HsmStateClass<Context, Protocol>, ToState: HsmStateClass<Context, Protocol>): string {
	return `${FromState.name}=>${ToState.name}`;
}
