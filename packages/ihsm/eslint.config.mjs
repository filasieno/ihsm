import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';
import { noMultilineImport } from './eslint-rules/no-multiline-import.mjs';

const ihsmPlugin = { rules: { 'no-multiline-import': noMultilineImport } };

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	eslintConfigPrettier,
	{
		ignores: [
			'lib/**',
			'.tsc/**',
			'coverage/**',
			'.typedoc-out/**',
			'docs-build/**',
			'node_modules/**',
			'node_modules.bak/**',
			'scripts/**',
			'website/docs/**',
			'website/**',
		],
	},
	{
		files: ['src/**/*.ts', 'examples/**/*.ts'],
		plugins: { ihsm: ihsmPlugin },
		rules: {
			'ihsm/no-multiline-import': 'error',
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/no-unused-vars': [
				'warn',
				{ argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
			],
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'no-prototype-builtins': 'off',
			'no-empty': 'off',
		},
	},
);
