import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['tests/e2e/fake-tor.cjs', 'out/**', 'dist/**', 'node_modules/**', 'resources/**', 'scripts/**', 'test-results/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      '@typescript-eslint/consistent-type-imports': 'error',
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='exec']", message: 'Use execFile/spawn with argument arrays only.' },
        { selector: "CallExpression[callee.property.name='exec'][callee.object.name='child_process']", message: 'Use execFile/spawn with argument arrays only.' }
      ]
    }
  }
)
