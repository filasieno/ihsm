/** Marker on {@link RequestingPort} constructors — avoids `instanceof` across bundle boundaries. */
export const kRequestingPort = Symbol('ihsm.requestingPort');

type RequestingPortCtor = Function & Record<typeof kRequestingPort, boolean | undefined>;

export function isRequestingPort(port: unknown): boolean {
	if (port === null || typeof port !== 'object') {
		return false;
	}
	const ctor = Object.getPrototypeOf(port)?.constructor as RequestingPortCtor | undefined;
	if (ctor === undefined) {
		return false;
	}
	return ctor[kRequestingPort] === true;
}

export function markRequestingPort(ctor: Function): void {
	(ctor as RequestingPortCtor)[kRequestingPort] = true;
}
