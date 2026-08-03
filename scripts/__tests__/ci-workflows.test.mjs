import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const actionRevisions = {
	'actions/cache': '55cc8345863c7cc4c66a329aec7e433d2d1c52a9',
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

function job(source, name) {
	const start = source.indexOf(`\n  ${name}:\n`);
	assert.ok(start >= 0, `workflow should include ${name}`);
	const rest = source.slice(start + 1);
	const next = rest.slice(rest.indexOf('\n') + 1).search(/^  [\w-]+:\n/m);
	return next < 0 ? rest : rest.slice(0, rest.indexOf('\n') + 1 + next);
}

function stepRun(source, jobName, stepName) {
	const sourceJob = job(source, jobName);
	const marker = `      - name: ${stepName}\n`;
	const start = sourceJob.indexOf(marker);
	assert.ok(start >= 0, `${jobName} should include ${stepName}`);
	const runStart = sourceJob.indexOf('        run: |\n', start);
	assert.ok(runStart >= 0, `${stepName} should include a run block`);
	const lines = sourceJob.slice(runStart + 15).split('\n');
	const block = [];
	for (const line of lines) {
		if (line.startsWith('          ')) block.push(line.slice(10));
		else if (line === '') block.push(line);
		else break;
	}
	return block.join('\n');
}

test('quality CI enforces JavaScript, documentation, and Rust contracts', () => {
	const source = workflow('quality.yml');
	for (const marker of [
		'Classify changed paths and modes fail closed',
		'npm run test:ci',
		'npm run lint',
		'cargo install mdbook --version 0.5.4 --locked',
		'npm run build:docs',
		'npm run format:check',
		'npm run check:web-reproducibility',
		'node-version: 24.18.0'
	]) {
		assert.ok(source.includes(marker));
	}
	assert.match(source, /rust: \[1\.88\.0, 1\.96\.0\]/);
	assert.match(
		source,
		/clippy --workspace --all-targets --locked -- -D warnings/
	);
	assert.match(source, /merge_group:\n\s+types: \[checks_requested\]/);
	assert.match(source, /workflow_dispatch:/);
	assert.doesNotMatch(source, /\n  push:/);
	assert.match(
		source,
		/cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/
	);
	assert.match(source, /name: Quality gate/);
	assert.match(
		source,
		/mdbook-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-0\.5\.4/
	);
	assert.doesNotMatch(source, /restore-keys:/);
});

test('quality CI routes explicit safe changes and preserves a stable fail-closed gate', () => {
	const source = workflow('quality.yml');
	const javascript = job(source, 'javascript');
	const rust = job(source, 'rust');
	const lightweight = job(source, 'lightweight');

	assert.match(
		javascript,
		/if: needs\.classify\.outputs\.quality_mode == 'full'/
	);
	assert.match(rust, /if: needs\.classify\.outputs\.quality_mode == 'full'/);
	assert.match(lightweight, /quality_mode == 'docs'/);
	assert.match(lightweight, /quality_mode == 'metadata'/);
	for (const marker of [
		'npm run format:check',
		'npm run check:docs',
		'npm run build:docs'
	]) {
		assert.ok(lightweight.includes(marker), marker);
	}
	assert.match(
		lightweight,
		/name: Documentation checks\n\s+if: needs\.classify\.outputs\.quality_mode == 'docs'/
	);
	assert.match(
		lightweight,
		/name: Build compatibility manual\n\s+if: needs\.classify\.outputs\.quality_mode == 'docs'/
	);
	assert.match(
		job(source, 'classify'),
		/BASE_SHA: \$\{\{ github\.event\.pull_request\.base\.sha \|\| github\.event\.merge_group\.base_sha \|\| github\.sha \}\}/
	);
});

test('packaged CI retains complete native evidence', () => {
	const source = workflow('packaged-electron-smoke.yml');
	for (const marker of [
		'Exercise Linux AppImage',
		'Extract and smoke Linux ZIP',
		'Mount and smoke macOS DMG',
		'Install Windows package',
		'Uninstall Windows package',
		'desktop-local-test-bundle',
		'LOCAL-TEST-ONLY.txt'
	]) {
		assert.ok(source.includes(marker));
	}
	assert.equal((source.match(/platform: linux/g) ?? []).length, 2);
	assert.equal((source.match(/platform: mac/g) ?? []).length, 2);
	assert.equal((source.match(/platform: windows/g) ?? []).length, 1);
	for (const marker of [
		'merge_group:',
		'Classify changed paths fail closed',
		'TWINE_MERGE_QUEUE_NATIVE_ONLY',
		"if: needs.classify.outputs.native_required == 'true'",
		'name: Packaged Electron gate',
		'desktop-local-test-bundle',
		'WASM_BINDGEN_ROOT',
		'ELECTRON_CACHE',
		'ELECTRON_BUILDER_CACHE',
		'wasm-bindgen-cli-${{ runner.os }}-${{ runner.arch }}-0.2.125',
		'electron-downloads-${{ runner.os }}-${{ runner.arch }}-electron-43.1.1-builder-26.15.3'
	]) {
		assert.ok(
			source.includes(marker),
			`packaged workflow should include ${marker}`
		);
	}
	assert.doesNotMatch(source, /paths-ignore:/);
	assert.doesNotMatch(source, /restore-keys:/);
	assert.doesNotMatch(source, /\n  push:/);
	assert.doesNotMatch(source, /workflow_dispatch:/);
	assert.match(source, /pull_request:/);
	assert.match(source, /merge_group:\n\s+types: \[checks_requested\]/);
});

test('stable final CI gates fail when required upstream work fails', () => {
	const run = (script, env) =>
		spawnSync('bash', ['-e', '-o', 'pipefail', '-c', script], {
			encoding: 'utf8',
			env: {...process.env, ...env}
		});
	const qualityGate = stepRun(
		workflow('quality.yml'),
		'quality-gate',
		'Require selected quality jobs'
	);
	assert.equal(
		run(qualityGate, {
			CLASSIFY_RESULT: 'success',
			JAVASCRIPT_RESULT: 'success',
			LIGHTWEIGHT_RESULT: 'skipped',
			QUALITY_MODE: 'full',
			RUST_RESULT: 'success'
		}).status,
		0
	);
	for (const qualityMode of ['docs', 'metadata']) {
		assert.equal(
			run(qualityGate, {
				CLASSIFY_RESULT: 'success',
				JAVASCRIPT_RESULT: 'skipped',
				LIGHTWEIGHT_RESULT: 'success',
				QUALITY_MODE: qualityMode,
				RUST_RESULT: 'skipped'
			}).status,
			0
		);
	}
	for (const env of [
		{
			CLASSIFY_RESULT: 'success',
			JAVASCRIPT_RESULT: 'failure',
			LIGHTWEIGHT_RESULT: 'skipped',
			QUALITY_MODE: 'full',
			RUST_RESULT: 'success'
		},
		{
			CLASSIFY_RESULT: 'failure',
			JAVASCRIPT_RESULT: 'skipped',
			LIGHTWEIGHT_RESULT: 'skipped',
			QUALITY_MODE: '',
			RUST_RESULT: 'skipped'
		},
		{
			CLASSIFY_RESULT: 'success',
			JAVASCRIPT_RESULT: 'skipped',
			LIGHTWEIGHT_RESULT: 'success',
			QUALITY_MODE: 'unknown',
			RUST_RESULT: 'skipped'
		}
	]) {
		assert.notEqual(run(qualityGate, env).status, 0);
	}

	const packagedGate = stepRun(
		workflow('packaged-electron-smoke.yml'),
		'packaged-electron-gate',
		'Require the selected packaged evidence mode'
	);
	assert.equal(
		run(packagedGate, {
			ASSEMBLY_RESULT: 'success',
			CLASSIFY_RESULT: 'success',
			NATIVE_REQUIRED: 'true',
			PACKAGE_RESULT: 'success'
		}).status,
		0
	);
	assert.equal(
		run(packagedGate, {
			ASSEMBLY_RESULT: 'skipped',
			CLASSIFY_RESULT: 'success',
			NATIVE_REQUIRED: 'false',
			PACKAGE_RESULT: 'skipped'
		}).status,
		0
	);
	assert.notEqual(
		run(packagedGate, {
			ASSEMBLY_RESULT: 'skipped',
			CLASSIFY_RESULT: 'success',
			NATIVE_REQUIRED: 'true',
			PACKAGE_RESULT: 'failure'
		}).status,
		0
	);
});

test('merge-queue transition never emits native evidence from gate-only PR runs', () => {
	const mode = stepRun(
		workflow('packaged-electron-smoke.yml'),
		'classify',
		'Apply merge-queue native transition'
	);
	const runMode = env => {
		const temporaryRoot = mkdtempSync(join(tmpdir(), 'twine-packaged-mode-'));
		const output = join(temporaryRoot, 'output.txt');
		const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', mode], {
			encoding: 'utf8',
			env: {...process.env, GITHUB_OUTPUT: output, ...env}
		});
		assert.equal(result.status, 0, result.stderr);
		const contents = readFileSync(output, 'utf8');
		rmSync(temporaryRoot, {force: true, recursive: true});
		return contents;
	};

	assert.match(
		runMode({
			CHANGED_PATHS_REQUIRE_NATIVE: 'true',
			EVENT_NAME: 'pull_request',
			MERGE_QUEUE_NATIVE_ONLY: 'false'
		}),
		/native_required=true/
	);
	assert.match(
		runMode({
			CHANGED_PATHS_REQUIRE_NATIVE: 'true',
			EVENT_NAME: 'pull_request',
			MERGE_QUEUE_NATIVE_ONLY: 'true'
		}),
		/native_required=false/
	);
	assert.match(
		runMode({
			CHANGED_PATHS_REQUIRE_NATIVE: 'true',
			EVENT_NAME: 'merge_group',
			MERGE_QUEUE_NATIVE_ONLY: 'true'
		}),
		/native_required=true/
	);
});

test('pre-tag candidate binds exact main and builds the distributable matrix', () => {
	const source = workflow('release-candidate.yml');
	const candidateScript = readFileSync(
		join(repositoryRoot, 'scripts', 'release-candidate.mjs'),
		'utf8'
	);
	const prepare = job(source, 'prepare');
	assert.match(source, /on:\n\s+workflow_dispatch:/);
	for (const marker of [
		"github.ref }}\" != 'refs/heads/main'",
		'refs/remotes/origin/main',
		'commit\" != \"${{ github.sha }}',
		'--commit "$commit"',
		'quality.yml',
		'packaged-electron-smoke.yml',
		'desktop-local-test-bundle',
		'matches[0].expired',
		'size_in_bytes <= 0',
		'packagedArtifact.digest.toLowerCase()'
	]) {
		assert.ok(
			prepare.includes(marker),
			`candidate prepare should include ${marker}`
		);
	}
	assert.doesNotMatch(prepare, /--check-tag/);
	assert.match(candidateScript, /const candidateKind = 'pretag-main'/);
	assert.equal(
		(source.match(/release-candidate\.mjs assert-pretag/g) ?? []).length,
		2,
		'candidate must prove tag absence before builds and before retention'
	);
	for (const marker of [
		'package-installable:',
		'Build production Electron app',
		'Package release artifacts',
		'Exercise Linux AppImage',
		'Mount and smoke macOS DMG',
		'Install Windows package',
		'node scripts/organize-release.mjs --profile',
		'--workflow-path .github/workflows/release-candidate.yml',
		'retention-days: 30',
		'desktop-pretag-${RELEASE_TAG}'
	]) {
		assert.ok(
			source.includes(marker),
			`candidate workflow should include ${marker}`
		);
	}
	assert.equal((source.match(/target: linux-/g) ?? []).length, 2);
	assert.equal((source.match(/target: mac-/g) ?? []).length, 2);
	assert.equal((source.match(/target: win-/g) ?? []).length, 1);
	assert.doesNotMatch(source, /TWINE_RELEASE_PROFILE: local/);
	assert.doesNotMatch(source, /contents: write/);
	assert.doesNotMatch(source, /gh release (create|edit|upload)/);
	assert.match(
		source,
		/wasm-bindgen-cli-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-0\.2\.125/
	);
	assert.match(
		source,
		/electron-downloads-\$\{\{ runner\.os \}\}-\$\{\{ runner\.arch \}\}-electron-43\.1\.1-builder-26\.15\.3/
	);
	assert.doesNotMatch(source, /restore-keys:/);
});

test('tag, recovery, and publication only promote a retained pre-tag candidate', () => {
	const source = workflow('release.yml');
	for (const marker of [
		'push:',
		'tags:',
		'workflow_dispatch:',
		'--check-tag',
		'release-candidate.yml',
		'candidate_run_id',
		'desktop-pretag-${RELEASE_TAG}',
		'No successful nonexpired exact-main candidate',
		'write-bound-run-outputs',
		'--quality-run-json',
		'--packaged-run-json',
		'--artifact-name',
		'--commit',
		'verify-unit',
		'verify-draft',
		'artifacts/reused-candidate/release-candidate.json',
		'--phase publish',
		'--candidate-artifacts-json',
		'--candidate-metadata',
		'write-publication-assets',
		'verify-publication',
		'gh release verify "$RELEASE_TAG"',
		'fresh release smoke'
	]) {
		assert.ok(
			source.includes(marker),
			`release workflow should include ${marker}`
		);
	}
	assert.match(
		source,
		/candidate_run_id:\n\s+description: Successful pre-tag candidate run ID \(required manually\)/
	);
	assert.match(
		source,
		/if: github\.event_name != 'workflow_dispatch' \|\| inputs\.publish == false/
	);
	assert.match(
		source,
		/if: github\.event_name == 'workflow_dispatch' && inputs\.publish/
	);
	for (const forbidden of [
		'package-installable:',
		'Build production Electron app',
		'Package release artifacts',
		'node scripts/organize-release.mjs',
		'TWINE_RELEASE_PROFILE'
	]) {
		assert.ok(
			!source.includes(forbidden),
			`release must not include ${forbidden}`
		);
	}
	const publish = job(source, 'publish');
	assert.doesNotMatch(publish, /gh release (create|edit .*--title)/);
	assert.match(publish, /actions: read/);
	assert.match(
		publish,
		/run-id: \$\{\{ needs\.prepare\.outputs\.candidate_run_id \}\}/
	);
	assert.doesNotMatch(source, /desktop-local-test-bundle/);
	assert.doesNotMatch(
		job(source, 'prepare'),
		/--workflow", "packaged-electron-smoke\.yml"/
	);
});

test('merge-queue native-only rollout is documented in fail-closed order', () => {
	const releasing = readFileSync(join(repositoryRoot, 'RELEASING.md'), 'utf8');
	const variable = releasing.indexOf('TWINE_MERGE_QUEUE_NATIVE_ONLY');
	const workflows = releasing.indexOf('Merge the workflow changes', variable);
	const ruleset = releasing.indexOf('Configure the ruleset', workflows);
	const pilot = releasing.indexOf('Enable and pilot the merge queue', ruleset);
	const enable = releasing.indexOf(
		'set `TWINE_MERGE_QUEUE_NATIVE_ONLY` to `true`',
		pilot
	);
	assert.ok(variable >= 0 && workflows > variable);
	assert.ok(ruleset > workflows && pilot > ruleset && enable > pilot);
	assert.match(releasing, /Candidate preparation then\nblocks fail-closed/);
});

test('manual modes require an explicit numeric candidate run ID', () => {
	const source = workflow('release.yml');
	assert.match(
		source,
		/Manual draft recovery and publication require candidate_run_id/
	);
	assert.match(source, /\^\[1-9\]\[0-9\]\*\$/);
});

test('active workflows pin every action to an immutable revision', () => {
	for (const name of [
		'packaged-electron-smoke.yml',
		'quality.yml',
		'release-candidate.yml',
		'release.yml',
		'rust-security-audit.yml'
	]) {
		const source = workflow(name);
		const uses = [...source.matchAll(/uses: ([^@\s]+)@([^\s]+)/g)];
		assert.ok(uses.length > 0);
		for (const [, action, revision] of uses) {
			assert.equal(revision, actionRevisions[action], `${name} pins ${action}`);
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
