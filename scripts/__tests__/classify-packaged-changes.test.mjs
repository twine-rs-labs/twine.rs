import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
	chmodSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {
	classifyChangedFiles,
	classifyChangedPaths,
	isSafeDocumentationPath,
	isSafeMetadataPath
} from '../classify-packaged-changes.mjs';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const classifier = join(
	repositoryRoot,
	'scripts',
	'classify-packaged-changes.mjs'
);

function run(command, args, cwd) {
	const result = spawnSync(command, args, {cwd, encoding: 'utf8'});
	assert.equal(result.status, 0, result.stderr);
	return result.stdout.trim();
}

function git(args, cwd) {
	return run('git', args, cwd);
}

function runClassifier(cwd, base, head, output) {
	return spawnSync(
		process.execPath,
		[classifier, '--base', base, '--head', head, '--output', output],
		{cwd, encoding: 'utf8'}
	);
}

test('explicitly allowed documentation may use lightweight quality checks', () => {
	for (const path of [
		'README.md',
		'docs/README.md',
		'docs/architecture/overview.md',
		'docs/archive/visual-audits/example.png',
		'docs/en/book.toml',
		'docs/en/custom.css',
		'docs/en/src/getting-started/index.md',
		'docs/en/src/fonts/nunito-light.woff2',
		'docs/upstream/README.md',
		'docs/user/recovery-and-backups.md'
	]) {
		assert.equal(isSafeDocumentationPath(path), true, path);
	}
	assert.deepEqual(
		classifyChangedPaths(['README.md', 'docs/architecture/overview.md']),
		{
			nativeRequired: false,
			qualityMode: 'docs',
			reason: 'safe-documentation-only'
		}
	);
	for (const file of [
		{
			newMode: '100644',
			oldMode: '000000',
			path: 'docs/user/new-guide.md',
			status: 'A'
		},
		{
			newMode: '000000',
			oldMode: '100644',
			path: 'docs/user/old-guide.md',
			status: 'D'
		}
	]) {
		assert.equal(classifyChangedFiles([file]).qualityMode, 'docs');
	}
});

test('explicitly allowed repository metadata may use metadata validation', () => {
	for (const path of [
		'.github/FUNDING.yml',
		'.github/ISSUE_TEMPLATE/bug.yml',
		'.github/ISSUE_TEMPLATE/help.md',
		'.github/PULL_REQUEST_TEMPLATE.md',
		'.github/PULL_REQUEST_TEMPLATE/release.md'
	]) {
		assert.equal(isSafeMetadataPath(path), true, path);
	}
	assert.deepEqual(classifyChangedPaths(['.github/FUNDING.yml']), {
		nativeRequired: false,
		qualityMode: 'metadata',
		reason: 'safe-metadata-only'
	});
	assert.equal(
		classifyChangedPaths(['.github/FUNDING.yml', 'docs/product/principles.md'])
			.qualityMode,
		'docs'
	);
});

test('release, compliance, governance, and unsafe documentation boundaries run full CI', () => {
	for (const path of [
		'CHANGELOG.md',
		'RELEASING.md',
		'SUPPORT.md',
		'LICENSE',
		'CITATION.cff',
		'SECURITY.md',
		'docs/releases/README.md',
		'docs/design-system/_ds_bundle.js',
		'docs/design-system/components/example.jsx',
		'docs/en/book/searcher.js',
		'docs/upstream/source/github/workflows/quality.yml',
		'docs/upstream/source/CONTRIBUTING.md',
		'.github/CODEOWNERS',
		'.github/dependabot.yml',
		'.github/future.yml',
		'.github/ISSUE_TEMPLATE/release-checklist.yml',
		'.github/workflows/quality.yml',
		'docs/new-area/guide.md',
		'docs/user/example.exe'
	]) {
		assert.equal(classifyChangedPaths([path]).qualityMode, 'full', path);
	}
});

test('source, dependency, and mixed changes require full quality and native packaging', () => {
	for (const paths of [
		['src/app.ts'],
		['package-lock.json'],
		['Cargo.lock'],
		['README.md', 'scripts/build-wasm.mjs']
	]) {
		const result = classifyChangedPaths(paths);
		assert.equal(result.nativeRequired, true);
		assert.equal(result.qualityMode, 'full');
	}
});

test('empty, invalid, executable, symlink, and submodule diffs fail closed', () => {
	for (const files of [
		[],
		undefined,
		[{path: '', oldMode: '100644', newMode: '100644', status: 'M'}],
		[
			{
				path: 'README.md',
				oldMode: '100644',
				newMode: '100755',
				status: 'M'
			}
		],
		[
			{
				path: 'README.md',
				oldMode: '000000',
				newMode: '120000',
				status: 'A'
			}
		],
		[
			{
				path: 'docs/README.md',
				oldMode: '160000',
				newMode: '160000',
				status: 'M'
			}
		]
	]) {
		const result = classifyChangedFiles(files);
		assert.equal(result.nativeRequired, true);
		assert.equal(result.qualityMode, 'full');
	}
});

test('CLI reads raw modes and keeps executable documentation in full CI', t => {
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twine-change-classifier-'));
	const output = join(temporaryRoot, 'output.txt');
	t.after(() => rmSync(temporaryRoot, {force: true, recursive: true}));
	git(['init', '--quiet'], temporaryRoot);
	git(['config', 'user.name', 'CI Classifier'], temporaryRoot);
	git(['config', 'user.email', 'ci-classifier@example.invalid'], temporaryRoot);
	writeFileSync(join(temporaryRoot, 'README.md'), '# Safe documentation\n');
	git(['add', 'README.md'], temporaryRoot);
	git(['commit', '--quiet', '-m', 'base'], temporaryRoot);
	const base = git(['rev-parse', 'HEAD'], temporaryRoot);
	chmodSync(join(temporaryRoot, 'README.md'), 0o755);
	git(['add', 'README.md'], temporaryRoot);
	git(['commit', '--quiet', '-m', 'make executable'], temporaryRoot);
	const head = git(['rev-parse', 'HEAD'], temporaryRoot);

	const result = runClassifier(temporaryRoot, base, head, output);
	assert.equal(result.status, 0, result.stderr);
	const contents = readFileSync(output, 'utf8');
	assert.match(contents, /native_required=true/);
	assert.match(contents, /quality_mode=full/);
	assert.match(contents, /reason=unsafe-file-mode/);
});

test('CLI records full CI instead of trusting invalid or equal commit ranges', t => {
	const temporaryRoot = mkdtempSync(join(tmpdir(), 'twine-change-classifier-'));
	t.after(() => rmSync(temporaryRoot, {force: true, recursive: true}));

	for (const [label, base, head] of [
		['invalid', '0'.repeat(40), '1'.repeat(40)],
		['equal', '1'.repeat(40), '1'.repeat(40)]
	]) {
		const output = join(temporaryRoot, `${label}.txt`);
		const result = runClassifier(repositoryRoot, base, head, output);
		assert.equal(result.status, 0, result.stderr);
		const contents = readFileSync(output, 'utf8');
		assert.match(contents, /native_required=true/);
		assert.match(contents, /quality_mode=full/);
		assert.match(contents, /reason=empty-or-invalid-diff/);
	}
});
