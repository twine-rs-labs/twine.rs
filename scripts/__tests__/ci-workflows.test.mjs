import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {delimiter, dirname, join, resolve} from 'node:path';
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

function workflowStepRun(source, jobName, stepName) {
	const jobMarker = `\n  ${jobName}:\n`;
	const jobStart = source.indexOf(jobMarker);
	assert.ok(jobStart >= 0, `workflow should include the ${jobName} job`);
	const followingJobs = source.slice(jobStart + jobMarker.length);
	const nextJobOffset = followingJobs.search(/^  [a-zA-Z0-9_-]+:\n/m);
	const jobSource =
		nextJobOffset === -1
			? followingJobs
			: followingJobs.slice(0, nextJobOffset);
	const stepMarker = `      - name: ${stepName}\n`;
	const stepStart = jobSource.indexOf(stepMarker);
	assert.ok(stepStart >= 0, `${jobName} should include ${stepName}`);
	const runMarker = '        run: |\n';
	const runStart = jobSource.indexOf(runMarker, stepStart);
	assert.ok(runStart >= 0, `${stepName} should include a run block`);
	const lines = jobSource.slice(runStart + runMarker.length).split('\n');
	const block = [];

	for (const line of lines) {
		if (line.startsWith('          ')) {
			block.push(line.slice(10));
		} else if (line === '') {
			block.push(line);
		} else {
			break;
		}
	}

	return block.join('\n');
}

function nodeHeredoc(runBlock) {
	const marker = "node <<'NODE'\n";
	const start = runBlock.indexOf(marker);
	const end = runBlock.lastIndexOf('\nNODE');

	assert.ok(start >= 0 && end > start, 'step should contain a Node heredoc');
	return runBlock.slice(start + marker.length, end);
}

test('quality CI enforces the JavaScript, documentation, and Rust contracts', () => {
	const source = workflow('quality.yml');

	for (const command of [
		'npm run test:ci',
		'npm run lint',
		'cargo install mdbook --version 0.5.4 --locked',
		'npm run build:docs',
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
	assert.match(source, /node --test scripts\/rust-policy-tests\/\*\.test\.mjs/);
	assert.match(source, /TWINE_RS_CARGO_TOOLCHAIN: \$\{\{ matrix\.rust \}\}/);
	assert.match(source, /test --workspace --locked/);
	assert.match(source, /node-version: 24\.18\.0/);
});

test('packaging CI exercises and retains every supported installable format', () => {
	const source = workflow('packaged-electron-smoke.yml');
	const packagedElectronSource = readFileSync(
		join(repositoryRoot, 'e2e', 'packaged-electron.spec.ts'),
		'utf8'
	);
	const packagedPreviewSource = readFileSync(
		join(repositoryRoot, 'e2e', 'packaged-electron-preview.spec.ts'),
		'utf8'
	);

	for (const marker of [
		'Exercise Linux AppImage',
		'Extend Linux ARM64 preview wait in test harness',
		'Extract and smoke Linux ZIP',
		'Mount and smoke macOS DMG',
		'Install Windows package',
		'Uninstall Windows package',
		'Retain package smoke diagnostics',
		`actions/upload-artifact@${actionRevisions['actions/upload-artifact']}`,
		`actions/download-artifact@${actionRevisions['actions/download-artifact']}`,
		'npm run release:assemble:local-test-bundle',
		'TWINE_RELEASE_PROFILE: local',
		'desktop-local-test-bundle',
		'name: desktop-local-target-',
		'pattern: desktop-local-target-*',
		'LOCAL-TEST-ONLY.txt',
		'artifacts/local-test-bundle'
	]) {
		assert.match(source, new RegExp(marker));
	}
	assert.doesNotMatch(source, /desktop-release-complete/);
	assert.doesNotMatch(source, /name: desktop-\$\{\{/);
	assert.equal((source.match(/platform: linux/g) ?? []).length, 2);
	assert.equal((source.match(/platform: mac/g) ?? []).length, 2);
	assert.equal((source.match(/platform: windows/g) ?? []).length, 1);
	assert.equal((source.match(/node-version: 24\.18\.0/g) ?? []).length, 2);
	assert.equal((source.match(/compression-level: 0/g) ?? []).length, 2);
	assert.match(source, /appimage_arch: x86_64/);
	assert.match(source, /Twine-RS-\*-linux-x86_64\.AppImage/);
	assert.match(source, /linux-\$\{\{ matrix\.appimage_arch \}\}\.AppImage/);
	assert.match(
		packagedPreviewSource,
		/async function expectCurrentPassage[\s\S]*?timeout: 90_000/
	);
	assert.match(
		packagedElectronSource,
		/async function waitForSavedText[\s\S]*?const passagesRoot[\s\S]*?try \{[\s\S]*?await readdir[\s\S]*?await readFile[\s\S]*?catch \(error\)[\s\S]*?code === 'ENOENT'[\s\S]*?return '';/
	);
	assert.match(
		packagedPreviewSource,
		/async function waitForSavedText[\s\S]*?const passagesRoot[\s\S]*?try \{[\s\S]*?const sources = await Promise\.all[\s\S]*?catch \(error\)[\s\S]*?code === 'ENOENT'[\s\S]*?return '';/
	);
	assert.match(
		source,
		/if: runner\.os == 'Linux' && matrix\.arch == 'arm64'[\s\S]*?expectCurrentPassage[\s\S]*?timeout: 90_000/
	);
	assert.match(
		source,
		/name: Retain package smoke diagnostics\n\s+if: failure\(\)/
	);
});

test('release CI gates an immutable release on decisions and retained evidence', () => {
	const source = workflow('release.yml');
	const buildIndex = source.indexOf('name: Build production Electron app');
	const restoreWasmIndex = source.indexOf(
		'name: Restore verified generated WASM sources after bundling'
	);
	const packageIndex = source.indexOf('name: Package release artifacts');
	const patchSaveSmokeIndex = source.indexOf(
		'name: Patch beta.2 atomic-save smoke polling'
	);
	const linuxSmokeIndex = source.indexOf('name: Exercise Linux AppImage');
	const freshDownloadIndex = source.indexOf('fresh-download-smoke:');
	const freshPatchSaveSmokeIndex = source.indexOf(
		'name: Patch beta.2 atomic-save smoke polling',
		freshDownloadIndex
	);
	const freshLinuxSmokeIndex = source.indexOf(
		'name: Exercise downloaded Linux AppImage',
		freshDownloadIndex
	);
	const retainedTargetInput = source.slice(
		source.indexOf('      - name: Retain target release input'),
		source.indexOf('      - name: Retain standalone compliance evidence')
	);

	for (const marker of [
		'push:',
		'tags:',
		'workflow_dispatch:',
		'Publish after rebuilding and validating the draft',
		'npm ci --include=dev',
		'Extend Linux ARM64 preview wait in test harness',
		'Retain package smoke diagnostics',
		'--check-tag',
		'git merge-base --is-ancestor',
		'packaged_app_run',
		'conclusion,databaseId,headSha',
		'desktop-release-target-',
		'desktop-release-compliance',
		'electron-build/compliance/sbom.cdx.json',
		'node scripts/organize-release.mjs --profile',
		'--phase publish',
		'--checklist-json',
		'release-record.json',
		'release-evidence.zip',
		'Validate and publish immutable release',
		"if: github.event_name == 'workflow_dispatch' && inputs.publish",
		'gh release edit "$RELEASE_TAG" --draft=false',
		'--json isImmutable',
		'gh release verify "$RELEASE_TAG"',
		'fresh release smoke',
		'verify-release-download.mjs',
		'Post-publication fresh-download smoke passed'
	]) {
		assert.match(source, new RegExp(marker.replaceAll('$', '\\$')));
	}
	assert.match(source, /ALLOW_UNSIGNED_DISTRIBUTION:.*'1'/);
	assert.match(
		source,
		/publish:\n\s+description: Publish after rebuilding and validating the draft\n\s+required: true\n\s+default: false\n\s+type: boolean/
	);
	assert.match(source, /pattern: desktop-release-target-\*/);
	assert.match(source, /merge-multiple: true/);
	assert.equal((source.match(/compression-level: 0/g) ?? []).length, 2);
	assert.match(
		retainedTargetInput,
		/path: artifacts\/staging\/\$\{\{ needs\.prepare\.outputs\.profile \}\}\/\$\{\{ matrix\.target \}\}\/Twine-RS-\*/
	);
	assert.doesNotMatch(
		retainedTargetInput,
		/path: artifacts\/staging\/\$\{\{ needs\.prepare\.outputs\.profile \}\}\/\$\{\{ matrix\.target \}\}\s*$/m
	);
	assert.match(
		source,
		/if: runner\.os == 'Linux' && matrix\.arch == 'arm64'[\s\S]*?expectCurrentPassage[\s\S]*?timeout: 90_000/
	);
	assert.match(
		source,
		/name: Retain package smoke diagnostics\n\s+if: failure\(\)/
	);
	assert.ok(buildIndex >= 0 && buildIndex < restoreWasmIndex);
	assert.ok(restoreWasmIndex < packageIndex);
	assert.ok(packageIndex < patchSaveSmokeIndex);
	assert.ok(patchSaveSmokeIndex < linuxSmokeIndex);
	assert.ok(freshDownloadIndex < freshPatchSaveSmokeIndex);
	assert.ok(freshPatchSaveSmokeIndex < freshLinuxSmokeIndex);
	assert.equal(
		(source.match(/name: Patch beta\.2 atomic-save smoke polling/g) ?? [])
			.length,
		2
	);
	assert.equal(
		(
			source.match(/name: Patch beta\.2 aggregate-manifest path validation/g) ??
			[]
		).length,
		2
	);
	for (const marker of [
		"':(exclude)src/core/wasm/pkg/twine_wasm.d.ts'",
		"':(exclude)src/core/wasm/pkg/twine_wasm.js'",
		"':(exclude)src/core/wasm/pkg/twine_wasm_bg.wasm'",
		"':(exclude)src/core/wasm/pkg/twine_wasm_bg.wasm.d.ts'",
		'git status --porcelain=v1 --untracked-files=all',
		'git restore --source=HEAD --worktree --',
		"if: needs.prepare.outputs.tag == 'v0.2.0-beta.2'",
		"file: 'e2e/packaged-electron.spec.ts'",
		"file: 'e2e/packaged-electron-preview.spec.ts'",
		'Could not locate the beta.2 ${label}.'
	]) {
		assert.ok(
			source.includes(marker),
			`release workflow should include ${marker}`
		);
	}
	assert.equal((source.match(/target: linux-/g) ?? []).length, 2);
	assert.equal((source.match(/target: mac-/g) ?? []).length, 2);
	assert.equal((source.match(/target: win-/g) ?? []).length, 1);
	assert.doesNotMatch(source, /TWINE_RELEASE_PROFILE: local/);
	assert.doesNotMatch(source, /environment: release-publication/);
});

test('manual recovery packages only the validated tag commit', t => {
	const source = workflow('release.yml');
	const packageRun = workflowStepRun(
		source,
		'package-installable',
		'Package release artifacts'
	).replace('${{ matrix.arch }}', 'arm64');
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twine-release-source-'));
	const binRoot = join(temporaryRoot, 'bin');
	const gitPath = join(binRoot, 'git');
	const npmPath = join(binRoot, 'npm');
	const npmRecord = join(temporaryRoot, 'npm-environment.txt');
	const runPackage = overrides =>
		spawnSync('bash', ['-e', '-o', 'pipefail', '-c', packageRun], {
			cwd: temporaryRoot,
			encoding: 'utf8',
			env: {
				...process.env,
				FAKE_GIT_HEAD: 'tag-commit',
				FAKE_NPM_RECORD: npmRecord,
				GITHUB_SHA: 'workflow-commit',
				PATH: `${binRoot}${delimiter}${process.env.PATH}`,
				RELEASE_EVENT_NAME: 'workflow_dispatch',
				RELEASE_SOURCE_COMMIT: 'tag-commit',
				...overrides
			}
		});

	t.after(() => rmSync(temporaryRoot, {force: true, recursive: true}));
	mkdirSync(binRoot, {recursive: true});
	writeFileSync(
		gitPath,
		['#!/bin/sh', 'printf \'%s\\n\' "$FAKE_GIT_HEAD"'].join('\n'),
		'utf8'
	);
	writeFileSync(
		npmPath,
		[
			'#!/bin/sh',
			'printf \'%s\' "${GITHUB_SHA-unset}" > "$FAKE_NPM_RECORD"'
		].join('\n'),
		'utf8'
	);
	chmodSync(gitPath, 0o755);
	chmodSync(npmPath, 0o755);

	const manualRun = runPackage();
	assert.equal(manualRun.status, 0, manualRun.stderr);
	assert.equal(readFileSync(npmRecord, 'utf8'), 'unset');

	const tagPushRun = runPackage({
		GITHUB_SHA: 'tag-commit',
		RELEASE_EVENT_NAME: 'push'
	});
	assert.equal(tagPushRun.status, 0, tagPushRun.stderr);
	assert.equal(readFileSync(npmRecord, 'utf8'), 'tag-commit');

	rmSync(npmRecord, {force: true});
	const mismatchedRun = runPackage({FAKE_GIT_HEAD: 'unexpected-commit'});
	assert.notEqual(mismatchedRun.status, 0);
	assert.match(
		mismatchedRun.stdout,
		/Checked-out source does not match the validated release commit/
	);
	assert.throws(() => readFileSync(npmRecord, 'utf8'), {code: 'ENOENT'});
});

test('beta.2 manifest recovery patches the immutable-tag validator', t => {
	const source = workflow('release.yml');
	const draftRun = workflowStepRun(
		source,
		'assemble-draft',
		'Patch beta.2 aggregate-manifest path validation'
	);
	const publishRun = workflowStepRun(
		source,
		'publish',
		'Patch beta.2 aggregate-manifest path validation'
	);
	const script = nodeHeredoc(draftRun);
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twine-beta2-validator-'));
	const scriptsRoot = join(temporaryRoot, 'scripts');
	const validatorPath = join(scriptsRoot, 'check-release.mjs');
	const before = [
		'\tconst expectedNames = requiredArtifactMatrix(plan.version, plan.profile)',
		'\t\t.map(artifact => artifact.fileName)',
		'\t\t.sort();'
	].join('\r\n');
	const current = [
		'\tconst expectedNames = requiredArtifactMatrix(plan.version, plan.profile)',
		'\t\t.map(distributionArtifactPath)',
		'\t\t.sort();'
	].join('\r\n');
	const runPatch = () =>
		spawnSync(process.execPath, ['-e', script], {
			cwd: temporaryRoot,
			encoding: 'utf8'
		});

	t.after(() => rmSync(temporaryRoot, {force: true, recursive: true}));
	mkdirSync(scriptsRoot, {recursive: true});
	assert.equal(draftRun, publishRun);

	writeFileSync(validatorPath, before, 'utf8');
	const firstRun = runPatch();
	assert.equal(firstRun.status, 0, firstRun.stderr);
	const patched = readFileSync(validatorPath, 'utf8');
	assert.match(patched, /linux: 'linux'/);
	assert.match(patched, /segments\.push\('alternatives'\)/);
	assert.ok(patched.includes('\r\n'));
	assert.equal(patched.replaceAll('\r\n', '').includes('\n'), false);

	const secondRun = runPatch();
	assert.equal(secondRun.status, 0, secondRun.stderr);
	assert.equal(readFileSync(validatorPath, 'utf8'), patched);

	writeFileSync(validatorPath, current, 'utf8');
	const currentRun = runPatch();
	assert.equal(currentRun.status, 0, currentRun.stderr);
	assert.equal(readFileSync(validatorPath, 'utf8'), current);

	writeFileSync(validatorPath, 'unexpected validator\r\n', 'utf8');
	const failedRun = runPatch();
	assert.notEqual(failedRun.status, 0);
	assert.match(
		failedRun.stderr,
		/Could not locate the beta\.2 artifact-matrix validator/
	);
});

test('beta.2 save-smoke patch is CRLF-safe and shared by both smoke phases', t => {
	const source = workflow('release.yml');
	const packageRun = workflowStepRun(
		source,
		'package-installable',
		'Patch beta.2 atomic-save smoke polling'
	);
	const freshDownloadRun = workflowStepRun(
		source,
		'fresh-download-smoke',
		'Patch beta.2 atomic-save smoke polling'
	);
	const script = nodeHeredoc(packageRun);
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twine-beta2-smoke-patch-'));
	const e2eRoot = join(temporaryRoot, 'e2e');
	const installedPath = join(e2eRoot, 'packaged-electron.spec.ts');
	const previewPath = join(e2eRoot, 'packaged-electron-preview.spec.ts');
	const installedBefore = [
		"\t\t\t\t\tconst passagesRoot = path.join(projectRoot, 'passages');",
		'\t\t\t\t\tconst files = await readdir(passagesRoot, {recursive: true});',
		"\t\t\t\t\tconst passageFile = files.find(file => file.endsWith('.twee'));",
		'',
		'\t\t\t\t\treturn passageFile',
		"\t\t\t\t\t\t? readFile(path.join(passagesRoot, passageFile), 'utf8')",
		"\t\t\t\t\t\t: '';"
	].join('\r\n');
	const previewBefore = [
		"\t\t\t\t\tconst passagesRoot = path.join(projectRoot, 'passages');",
		'\t\t\t\t\tconst files = (await readdir(passagesRoot, {recursive: true})).filter(',
		"\t\t\t\t\t\tfile => file.endsWith('.twee')",
		'\t\t\t\t\t);',
		'\t\t\t\t\tconst sources = await Promise.all(',
		"\t\t\t\t\t\tfiles.map(file => readFile(path.join(passagesRoot, file), 'utf8'))",
		'\t\t\t\t\t);',
		'',
		"\t\t\t\t\treturn sources.join('\\n');"
	].join('\r\n');
	const runPatch = () =>
		spawnSync(process.execPath, ['-e', script], {
			cwd: temporaryRoot,
			encoding: 'utf8'
		});

	t.after(() => rmSync(temporaryRoot, {force: true, recursive: true}));
	mkdirSync(e2eRoot, {recursive: true});
	writeFileSync(installedPath, installedBefore, 'utf8');
	writeFileSync(previewPath, previewBefore, 'utf8');
	assert.equal(packageRun, freshDownloadRun);

	const firstRun = runPatch();
	assert.equal(firstRun.status, 0, firstRun.stderr);
	const installedAfter = readFileSync(installedPath, 'utf8');
	const previewAfter = readFileSync(previewPath, 'utf8');

	for (const patchedSource of [installedAfter, previewAfter]) {
		assert.match(patchedSource, /code === 'ENOENT'/);
		assert.ok(patchedSource.includes('\r\n'));
		assert.equal(patchedSource.replaceAll('\r\n', '').includes('\n'), false);
	}
	assert.match(installedAfter, /\? await readFile/);
	assert.match(previewAfter, /const sources = await Promise\.all/);

	const secondRun = runPatch();
	assert.equal(secondRun.status, 0, secondRun.stderr);
	assert.equal(readFileSync(installedPath, 'utf8'), installedAfter);
	assert.equal(readFileSync(previewPath, 'utf8'), previewAfter);

	writeFileSync(installedPath, 'unexpected helper\r\n', 'utf8');
	const failedRun = runPatch();
	assert.notEqual(failedRun.status, 0);
	assert.match(
		failedRun.stderr,
		/Could not locate the beta\.2 installed-app save helper/
	);
});

test('active workflows pin every action to an immutable revision', () => {
	for (const name of [
		'packaged-electron-smoke.yml',
		'quality.yml',
		'release.yml',
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
