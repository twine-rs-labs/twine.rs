import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);

function workflow(name) {
	return readFileSync(
		join(repositoryRoot, '.github', 'workflows', name),
		'utf8'
	);
}

test('quality CI enforces the JavaScript, documentation, and Rust contracts', () => {
	const source = workflow('quality.yml');

	for (const command of [
		'npm run test:ci',
		'npm run lint',
		'npm run format:check',
		'npm run build:web'
	]) {
		assert.match(source, new RegExp(command.replace(':', '\\:')));
	}
	assert.match(source, /rust: \[1\.88\.0, 1\.96\.0\]/);
	assert.match(source, /cargo \+\$\{\{ matrix\.rust \}\} fmt --all -- --check/);
	assert.match(
		source,
		/clippy --workspace --all-targets --locked -- -D warnings/
	);
	assert.match(source, /test --workspace --locked/);
});

test('packaging CI exercises and retains every supported installable format', () => {
	const source = workflow('packaged-electron-smoke.yml');

	for (const marker of [
		'Exercise Linux AppImage',
		'Extract and smoke Linux ZIP',
		'Mount and smoke macOS DMG',
		'Install Windows package',
		'Uninstall Windows package',
		'actions/upload-artifact@v4',
		'actions/download-artifact@v4',
		'npm run release:organize'
	]) {
		assert.match(source, new RegExp(marker));
	}
	assert.equal((source.match(/platform: linux/g) ?? []).length, 2);
	assert.equal((source.match(/platform: mac/g) ?? []).length, 2);
	assert.equal((source.match(/platform: windows/g) ?? []).length, 1);
});
