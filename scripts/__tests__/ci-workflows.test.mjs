import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const actionRevisions = {
	'actions/checkout': 'de0fac2e4500dabe0009e67214ff5f5447ce83dd',
	'actions/download-artifact': '37930b1c2abaa49bbe596cd826c3c89aef350131',
	'actions/setup-node': '48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e',
	'actions/upload-artifact': '043fb46d1a93c77aae656e7c1c64a875d1fc6a0a'
};

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
		'npm run check:web-reproducibility'
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
	assert.match(source, /node-version: 24\.18\.0/);
});

test('packaging CI exercises and retains every supported installable format', () => {
	const source = workflow('packaged-electron-smoke.yml');

	for (const marker of [
		'Exercise Linux AppImage',
		'Extract and smoke Linux ZIP',
		'Mount and smoke macOS DMG',
		'Install Windows package',
		'Uninstall Windows package',
		`actions/upload-artifact@${actionRevisions['actions/upload-artifact']}`,
		`actions/download-artifact@${actionRevisions['actions/download-artifact']}`,
		'npm run release:organize'
	]) {
		assert.match(source, new RegExp(marker));
	}
	assert.equal((source.match(/platform: linux/g) ?? []).length, 2);
	assert.equal((source.match(/platform: mac/g) ?? []).length, 2);
	assert.equal((source.match(/platform: windows/g) ?? []).length, 1);
	assert.equal((source.match(/node-version: 24\.18\.0/g) ?? []).length, 2);
});

test('active workflows pin every action to an immutable revision', () => {
	for (const name of [
		'packaged-electron-smoke.yml',
		'quality.yml',
		'rust-security-audit.yml'
	]) {
		const source = workflow(name);
		const uses = [...source.matchAll(/uses: ([^@\s]+)@([^\s]+)/g)];

		assert.ok(uses.length > 0, `${name} should use at least one action`);
		for (const [, action, revision] of uses) {
			assert.equal(
				revision,
				actionRevisions[action],
				`${name} should pin ${action}`
			);
		}
	}
});

test('the repository pins the release Rust toolchain and WASM target', () => {
	const source = readFileSync(
		join(repositoryRoot, 'rust-toolchain.toml'),
		'utf8'
	);

	assert.match(source, /channel = "1\.96\.0"/);
	assert.match(source, /components = \["clippy", "rustfmt"\]/);
	assert.match(source, /targets = \["wasm32-unknown-unknown"\]/);
});
