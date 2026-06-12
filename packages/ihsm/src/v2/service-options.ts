import { CallTimeoutError } from './errors';

/** Optional trailing argument on generated service client methods. */
export type ServiceCallOptions = {
	readonly timeoutMs?: number;
};

export function isServiceCallOptions(value: unknown): value is ServiceCallOptions {
	if (value === null || typeof value !== 'object') {
		return false;
	}
	const record = value as Record<string, unknown>;
	if (!('timeoutMs' in record)) {
		return false;
	}
	const timeoutMs = record.timeoutMs;
	return timeoutMs === undefined || (typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs >= 0);
}

export function splitServiceArgs(args: readonly unknown[]): { callArgs: unknown[]; timeoutMs: number | undefined } {
	if (args.length === 0) {
		return { callArgs: [], timeoutMs: undefined };
	}
	const last = args[args.length - 1];
	if (!isServiceCallOptions(last)) {
		return { callArgs: [...args], timeoutMs: undefined };
	}
	const timeoutMs = last.timeoutMs;
	if (timeoutMs === undefined) {
		return { callArgs: [...args], timeoutMs: undefined };
	}
	return { callArgs: args.slice(0, -1), timeoutMs };
}

export function serviceCallWithTimeout<T>(promise: Promise<T>, method: string, timeoutMs: number): Promise<T> {
	if (timeoutMs === 0) {
		return Promise.reject(new CallTimeoutError(method));
	}
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new CallTimeoutError(method));
		}, timeoutMs);
		promise.then(
			value => {
				clearTimeout(timer);
				resolve(value);
			},
			err => {
				clearTimeout(timer);
				reject(err);
			},
		);
	});
}
