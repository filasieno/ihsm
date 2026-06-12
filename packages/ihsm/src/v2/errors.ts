import type { ReservedName } from './types';

/** Thrown at construction when `Config`, state handlers, and the protocol index disagree. */
export class ProtocolCollisionError extends Error {
	constructor(
		message: string,
		readonly stateClass?: string,
		readonly symbol?: string,
	) {
		super(message);
		this.name = 'ProtocolCollisionError';
	}
}

export function protocolCollisionReservedConfig(symbol: ReservedName): ProtocolCollisionError {
	return new ProtocolCollisionError(
		`ihsm: reserved symbol "${symbol}" cannot be used as a Config protocol key — reserved symbols are: ctx, hsm, onEntry, onExit, onError, onUnhandled`,
		undefined,
		symbol,
	);
}

export function protocolCollisionReservedState(stateClass: string, symbol: ReservedName): ProtocolCollisionError {
	return new ProtocolCollisionError(
		`ihsm: state class "${stateClass}" defines reserved symbol "${symbol}" — rename the protocol method; reserved symbols are: ctx, hsm, onEntry, onExit, onError, onUnhandled`,
		stateClass,
		symbol,
	);
}

export function protocolCollisionDuplicateKey(key: string): ProtocolCollisionError {
	return new ProtocolCollisionError(`ihsm: protocol key "${key}" appears in more than one Config bucket`);
}

export function protocolCollisionMissingHandler(key: string): ProtocolCollisionError {
	return new ProtocolCollisionError(`ihsm: Config key "${key}" has no handler on the state graph`);
}

export function protocolCollisionUnbucketedHandler(stateClass: string, name: string): ProtocolCollisionError {
	return new ProtocolCollisionError(`ihsm: handler "${name}" on state class "${stateClass}" is not declared on Config`);
}

/** Thrown when a generated transition table's graph hash does not match the scanned hierarchy. */
export class TransitionTableError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TransitionTableError';
	}
}

/** Thrown in debug builds when a service targets the machine currently dispatching. */
export class SelfCallDeadlockError extends Error {
	constructor() {
		super('ihsm: awaiting a service on your own machine from inside your own dispatch deadlocks');
		this.name = 'SelfCallDeadlockError';
	}
}

/** Thrown when a service client call exceeds `{ timeoutMs }`. */
export class CallTimeoutError extends Error {
	constructor(readonly method: string) {
		super(`ihsm: service "${method}" timed out`);
		this.name = 'CallTimeoutError';
	}
}
