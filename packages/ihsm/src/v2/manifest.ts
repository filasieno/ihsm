import type { ProtocolBucketManifest } from './protocol-index';
import type { Config } from './types';

/** Type-preserving helper for declaring a machine's protocol key manifest at compile time. */
export function manifestFor<C extends Config>(m: ProtocolBucketManifest<C>): ProtocolBucketManifest<C> {
	return m;
}
