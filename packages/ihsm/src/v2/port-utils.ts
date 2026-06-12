/** Marker on {@link RequestingPort} constructors — avoids `instanceof` across bundle boundaries. */
export const kRequestingPort = Symbol('ihsm.requestingPort');

export function isRequestingPort(port: unknown): boolean {
	if (port === null || typeof port !== 'object') {
		return false;
	}
	const ctor = Object.getPrototypeOf(port)?.constructor as { [typeof kRequestingPort]?: boolean } | undefined;
	if (ctor === undefined) {
		return false;
	}
	return ctor[kRequestingPort] === true;
}

export function markRequestingPort(ctor: Function): void {
	(ctor as { [typeof kRequestingPort]?: boolean })[kRequestingPort] = true;
}
