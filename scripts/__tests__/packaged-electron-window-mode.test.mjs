import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';
import {
	environmentForPackagedElectronWindowMode,
	resolvePackagedElectronWindowMode,
	visibleWindowTag,
	windowModeForTest
} from '../../e2e/packaged-electron-window-mode.mjs';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const packageJson = JSON.parse(
	readFileSync(join(repositoryRoot, 'package.json'), 'utf8')
);

test('packaged Electron window modes resolve fail-closed and isolate the background flag', () => {
	assert.equal(
		resolvePackagedElectronWindowMode({TWINE_E2E_WINDOW_MODE: 'hidden'}),
		'hidden'
	);
	assert.equal(
		resolvePackagedElectronWindowMode({TWINE_E2E_WINDOW_MODE: 'visible'}),
		'visible'
	);
	assert.throws(() => resolvePackagedElectronWindowMode({}), /must be either/);
	assert.throws(
		() =>
			resolvePackagedElectronWindowMode({TWINE_E2E_WINDOW_MODE: 'background'}),
		/must be either/
	);
	assert.equal(windowModeForTest('hidden', [visibleWindowTag]), 'visible');
	assert.equal(windowModeForTest('hidden', []), 'hidden');
	assert.deepEqual(
		environmentForPackagedElectronWindowMode('hidden', {
			TWINE_E2E_BACKGROUND_WINDOW: 'unexpected',
			TWINE_PERF: '1'
		}),
		{TWINE_E2E_BACKGROUND_WINDOW: '1', TWINE_PERF: '1'}
	);
	assert.deepEqual(
		environmentForPackagedElectronWindowMode('visible', {
			TWINE_E2E_BACKGROUND_WINDOW: '1',
			TWINE_PERF: '1'
		}),
		{TWINE_PERF: '1'}
	);
});

test('packaged Electron scripts and configs keep CI on the explicit visible lane', () => {
	const previewSpec = readFileSync(
		join(repositoryRoot, 'e2e', 'packaged-electron-preview.spec.ts'),
		'utf8'
	);

	assert.equal(
		packageJson.scripts['e2e:electron:packaged'],
		'playwright test --config playwright.packaged-electron.config.ts'
	);
	assert.equal(
		packageJson.scripts['e2e:electron:packaged:hidden'],
		'playwright test --config playwright.packaged-electron-hidden.config.ts'
	);
	assert.match(
		readFileSync(
			join(repositoryRoot, 'playwright.packaged-electron.config.ts'),
			'utf8'
		),
		/packagedElectronConfig\('visible'\)/
	);
	assert.match(
		readFileSync(
			join(repositoryRoot, 'playwright.packaged-electron-hidden.config.ts'),
			'utf8'
		),
		/packagedElectronConfig\('hidden'\)/
	);
	assert.deepEqual(
		[...previewSpec.matchAll(/test\('([^']* @visible-window)'/g)].map(
			match => match[1]
		),
		[
			'Play exposes debug state and replaces fresh Test builds in the same window @visible-window',
			'current passage resolves to a stable ID in every bundled format family @visible-window'
		]
	);
	for (const workflow of [
		'packaged-electron-smoke.yml',
		'release-candidate.yml',
		'release.yml'
	]) {
		const source = readFileSync(
			join(repositoryRoot, '.github', 'workflows', workflow),
			'utf8'
		);

		assert.match(source, /npm run e2e:electron:packaged/);
		assert.doesNotMatch(source, /e2e:electron:packaged:hidden/);
	}
});
