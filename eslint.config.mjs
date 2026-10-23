import js from '@eslint/js';
import ts from 'typescript-eslint';
import globals from 'globals';
import obsidianmd from 'eslint-plugin-obsidianmd';
export default ts.config(
  { ignores: ['node_modules/**', 'main.js', 'release/**'] },
  js.configs.recommended,
  ...ts.configs.recommended,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { obsidianmd },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'obsidianmd/no-tfile-tfolder-cast': 'error',
      'obsidianmd/no-sample-code': 'error',
      'obsidianmd/no-static-styles-assignment': 'error',
      'obsidianmd/no-forbidden-elements': 'error',
      'obsidianmd/commands/no-default-hotkeys': 'error',
      'obsidianmd/commands/no-plugin-id-in-command-id': 'error',
      'obsidianmd/commands/no-plugin-name-in-command-name': 'error',
    },
  },
  {
    files: ['src/**/*.ts'],
    languageOptions: { parserOptions: { projectService: true } },
    rules: {
      '@typescript-eslint/no-unnecessary-type-assertion': 'error',
      '@typescript-eslint/no-deprecated': 'error',
      'obsidianmd/settings-tab/no-manual-html-headings': 'error',
      'obsidianmd/settings-tab/prefer-setting-definitions': 'error',
      'obsidianmd/prefer-window-timers': 'error',
      'obsidianmd/prefer-file-manager-trash-file': 'error',
      'obsidianmd/no-global-this': 'error',
    },
  },
);
