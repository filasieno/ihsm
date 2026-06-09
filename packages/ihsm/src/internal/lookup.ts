/** @internal */
import { StateClass, TopState } from '../';

import { HsmWithTracing } from './defs.private';

/**
 * Canonical event-handler lookup shared by every dispatch mode (production, debug, verbose).
 *
 * Walks the **state-class constructor chain** starting at `hsm.currentState` and going up to and
 * **including** {@link TopState}, returning the first state that defines `eventName` as an **own**
 * prototype property. Stopping at `TopState` keeps resolution inside the user's state hierarchy: it
 * never falls through to `State.prototype` / `Object.prototype`, so a posted event can never
 * accidentally resolve to a runtime method (`post`, `transition`, `toString`, …). Returns
 * `undefined` when no state owns the handler — the caller then routes the event to `onUnhandled`.
 *
 * The verbose-trace dispatcher narrates this exact algorithm step by step; sharing it here
 * guarantees production / debug / verbose dispatch all resolve handlers identically (proposal T6).
 */
export function lookupEventHandler<Context, Protocol extends {} | undefined>(hsm: HsmWithTracing<Context, Protocol>, eventName: PropertyKey): ((...args: any[]) => unknown) | undefined {
	let state: StateClass<Context, Protocol> = hsm.currentState;
	while (true) {
		const prototype = state.prototype as unknown as Record<PropertyKey, unknown>;
		if (Object.prototype.hasOwnProperty.call(prototype, eventName)) {
			return prototype[eventName] as (...args: any[]) => unknown;
		}
		if ((state as unknown) === TopState) {
			return undefined;
		}
		state = Object.getPrototypeOf(state) as StateClass<Context, Protocol>;
	}
}
