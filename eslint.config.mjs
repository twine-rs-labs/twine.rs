import eslint from '@eslint/js';
import prettier from 'eslint-config-prettier';
import jest from 'eslint-plugin-jest';
import react from 'eslint-plugin-react';
import testingLibrary from 'eslint-plugin-testing-library';
import tseslint from 'typescript-eslint';

export default tseslint.config(
	{
		ignores: ['src/__mocks__/*', 'src/core/wasm/pkg/*']
	},
	eslint.configs.recommended,
	...tseslint.configs.recommended,
	react.configs.flat.recommended,
	{
		plugins: {
			jest,
			'testing-library': testingLibrary
		},
		rules: {
			'@typescript-eslint/no-empty-object-type': [
				'error',
				{allowInterfaces: 'with-single-extends'}
			],
			'@typescript-eslint/no-explicit-any': 'off',
			'@typescript-eslint/no-unused-expressions': [
				'error',
				{allowShortCircuit: true}
			],
			'@typescript-eslint/no-unused-vars': ['error', {caughtErrors: 'none'}],
			'no-restricted-syntax': [
				'error',
				{
					message:
						'Production renderer IPC must remain asynchronous; use send() or invoke().',
					selector:
						"CallExpression[callee.type='MemberExpression'][callee.object.name='ipcRenderer'][callee.property.name='sendSync']"
				}
			],
			'react/display-name': 'off',
			'react/prop-types': 'off',
			'testing-library/no-render-in-setup': 'off',
			'testing-library/render-result-naming-convention': 'off'
		},
		settings: {
			react: {
				version: 'detect'
			}
		}
	},
	{
		files: [
			'src/**/__tests__/**/*.{ts,tsx}',
			'src/**/*.{test,spec}.{ts,tsx}',
			'scripts/__tests__/**/*.test.mjs'
		],
		rules: {
			'jest/no-alias-methods': 'error'
		}
	},
	prettier
);
