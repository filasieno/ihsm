import { Any, StateClass } from 'ihsm';

/** Erased state class used by development tools (any context / protocol). */
export type AnyStateClass = StateClass<Any, undefined>;
