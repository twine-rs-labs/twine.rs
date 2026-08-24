import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {scripts} = require('../../package.json');
const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);

test('default browser E2E serves a deterministic build without watchers', () => {
	const source = readFileSync(
		join(repositoryRoot, 'playwright.config.ts'),
		'utf8'
	);

	assert.equal(
		scripts['e2e:serve'],
		'vite preview --host 127.0.0.1 --port 5173 --strictPort'
	);
	assert.match(source, /process\.env\.TWINE_E2E_USE_EXISTING_BUILD === '1'/);
	assert.match(source, /command: `\$\{buildCommand\}npm run e2e:serve`/);
	assert.match(source, /reuseExistingServer: false/);
	assert.match(source, /timeout: 120_000/);
	assert.doesNotMatch(source, /npm run start/);
});
