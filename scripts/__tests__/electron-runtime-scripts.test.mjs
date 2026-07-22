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

test('every desktop and release build regenerates WASM before compiling the renderer', () => {
	assert.match(scripts.build, /build:electron-app:ci/);
	assert.match(scripts['build:electron'], /^npm-run-all --serial build:wasm /);
	assert.match(
		scripts['build:electron-app'],
		/^NODE_ENV=production npm-run-all --serial build:wasm /
	);
	assert.match(
		scripts['build:electron-app:ci'],
		/^npm-run-all --serial build:wasm /
	);
	assert.match(scripts['build:electron-release'], /build:electron /);
	assert.match(scripts.dist, /build:electron-release/);
	assert.match(scripts['start:electron'], /clean build:wasm build:web/);
});

test('release packaging targets only the current runner platform', () => {
	assert.doesNotMatch(
		scripts['build:electron-bundle'],
		/--linux|--mac|--windows/
	);
	assert.match(
		scripts['build:electron-bundle'],
		/npm run package:electron:artifacts/
	);
	assert.match(scripts['package:electron:artifacts'], /electron-builder/);
});
