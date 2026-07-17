import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';

const require = createRequire(import.meta.url);
const {scripts} = require('../../package.json');

test('Electron runtime installation is explicit before development and performance launches', () => {
	assert.equal(scripts['electron:install'], 'install-electron');
	assert.equal(scripts['prestart:electron'], 'npm run electron:install');
	assert.match(
		scripts['perf:prepare'],
		/^npm-run-all --serial electron:install build:electron-app /
	);
	assert.match(
		scripts['perf:prepare:smoke'],
		/^npm-run-all --serial electron:install build:electron-app /
	);
});
