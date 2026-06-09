import { AnyStateClass } from './types';

export interface GenerateTransitionTableOptions {
	/** Root state class passed to `makeHsm` / `makeActor`. */
	readonly topState: AnyStateClass;
	/** Explicit state class list (filtered to descendants of `topState`). */
	readonly states?: AnyStateClass[];
	/** Module namespace (`import * as machine`) — export keys become import names. */
	readonly exports?: Record<string, unknown>;
	/** Module specifier for generated imports, e.g. `'./machine'`. */
	readonly importPath: string;
	/** Banner comment on the generated file. */
	readonly banner?: string;
}
