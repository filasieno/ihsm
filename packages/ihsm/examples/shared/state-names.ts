import { registerStateNames } from '../../src';

/**
 * Register stable display names from `import * as machine from './machine'` export keys.
 *
 * Thin wrapper around the public {@link registerStateNames} API, kept for the
 * tutorial/spec call sites that import this helper by name.
 */
export function registerStateNamesFromExports(exports: Record<string, unknown>): void {
	registerStateNames(exports);
}
