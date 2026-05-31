import eslint from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	eslintConfigPrettier,
	{
		ignores: [
			'lib/**',
			'coverage/**',
			'docs/**',
			'.typedoc-out/**',
			'node_modules/**',
			'scripts/**',
			'site/**',
		],
	},
	{
		files: ['**/*.ts'],
		rules: {
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
			'@typescript-eslint/no-empty-object-type': 'off',
			'@typescript-eslint/no-unsafe-function-type': 'off',
			'no-prototype-builtins': 'off',
			'no-empty': 'off',
		},
	},
);
