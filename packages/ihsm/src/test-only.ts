/** @internal Test hooks — not part of the public API. */
import { cacheProtocolIndex as writeProtocolIndexCache, dispatchContext, protocolIndexFor as readProtocolIndexFor, } from './internal/runtime';
import type { ProtocolIndex } from './internal/types';

export function cacheProtocolIndex(topState: object, index: ProtocolIndex): ProtocolIndex {
	return writeProtocolIndexCache(topState, index);
}

export function protocolIndexFor(topState: object): ProtocolIndex | undefined {
	return readProtocolIndexFor(topState);
}

export function disableDispatchStorage(): void {
	dispatchContext.markUnavailable();
}

export function resetDispatchStorage(): void {
	dispatchContext.resetInit();
}
