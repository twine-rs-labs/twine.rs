import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {
	assertPreTag,
	expectedCandidateFilePaths,
	githubReleaseAssetName,
	pretagCandidateArtifactName,
	validateCandidateCiEvidence,
	validateCandidateRun,
	validateCandidateFileSet,
	validateDraftRelease,
	validatePublicationDraft
} from '../release-candidate.mjs';

const digest = 'a'.repeat(64);
const sourceCommit = '1'.repeat(40);

function ciEvidence() {
	return {
		quality: {
			workflowPath: '.github/workflows/quality.yml',
			runId: '11',
			url: 'https://github.com/twine-rs-labs/twine.rs/actions/runs/11',
			headSha: sourceCommit
		},
		packagedElectron: {
			workflowPath: '.github/workflows/packaged-electron-smoke.yml',
			runId: '12',
			url: 'https://github.com/twine-rs-labs/twine.rs/actions/runs/12',
			headSha: sourceCommit
		},
		desktopLocalTestBundle: {
			id: 13,
			name: 'desktop-local-test-bundle',
			digest: `sha256:${digest}`,
			size: 14
		}
	};
}

function boundRun(id, path) {
	return {
		id,
		repository: {full_name: 'twine-rs-labs/twine.rs'},
		path,
		head_sha: sourceCommit,
		html_url: `https://github.com/twine-rs-labs/twine.rs/actions/runs/${id}`,
		status: 'completed',
		conclusion: 'success'
	};
}

function metadata() {
	return {
		tag: 'v1.2.3-beta.1',
		version: '1.2.3-beta.1',
		channel: 'prerelease',
		releaseNotes: 'Inspected notes\n',
		releaseAssets: [
			{
				fileName: 'WHICH TO DOWNLOAD.md',
				githubName: 'WHICH.TO.DOWNLOAD.md',
				sha256: digest,
				size: 42
			}
		]
	};
}

function draftRelease(overrides = {}) {
	return {
		tag_name: 'v1.2.3-beta.1',
		draft: true,
		prerelease: true,
		name: 'Twine RS 1.2.3-beta.1',
		body: 'Inspected notes\n',
		assets: [
			{
				name: 'WHICH.TO.DOWNLOAD.md',
				digest: `sha256:${digest}`,
				size: 42
			}
		],
		...overrides
	};
}

test('GitHub release asset normalization is explicit', () => {
	assert.equal(
		githubReleaseAssetName('WHICH TO DOWNLOAD.md'),
		'WHICH.TO.DOWNLOAD.md'
	);
	assert.equal(githubReleaseAssetName('SHA256SUMS.txt'), 'SHA256SUMS.txt');
});

test('pre-tag artifact name binds intended tag, profile, and complete plan hash', () => {
	const planHash = 'f'.repeat(64);
	assert.equal(
		pretagCandidateArtifactName(
			'v1.2.3-beta.1',
			'distributable-unsigned',
			planHash
		),
		`desktop-pretag-v1.2.3-beta.1-distributable-unsigned-${planHash}`
	);
});

test('pre-tag guard fails closed for existing local and remote tags', () => {
	const root = mkdtempSync(join(tmpdir(), 'twine-pretag-'));
	const remote = join(root, 'remote.git');
	const work = join(root, 'work');
	const git = (args, cwd = root) =>
		execFileSync('git', args, {cwd, encoding: 'utf8'});
	try {
		git(['init', '--bare', remote]);
		git(['init', work]);
		git(['config', 'user.name', 'Release Test'], work);
		git(['config', 'user.email', 'release-test@example.invalid'], work);
		writeFileSync(join(work, 'README.md'), 'test\n');
		git(['add', 'README.md'], work);
		git(['commit', '-m', 'test'], work);
		git(['remote', 'add', 'origin', remote], work);

		assert.doesNotThrow(() => assertPreTag({cwd: work, tag: 'v1.2.3-beta.1'}));
		git(['tag', 'v1.2.3-beta.1'], work);
		assert.throws(
			() => assertPreTag({cwd: work, tag: 'v1.2.3-beta.1'}),
			/already exists locally/
		);
		git(['push', 'origin', 'refs/tags/v1.2.3-beta.1'], work);
		git(['tag', '--delete', 'v1.2.3-beta.1'], work);
		assert.throws(
			() => assertPreTag({cwd: work, tag: 'v1.2.3-beta.1'}),
			/already exists remotely/
		);
	} finally {
		rmSync(root, {force: true, recursive: true});
	}
});

test('candidate inventory rejects files outside the exact release set', () => {
	const fileNames = expectedCandidateFilePaths(
		'1.2.3-beta.1',
		'distributable-unsigned'
	);
	const inventory = fileNames.map(fileName => ({fileName}));

	assert.doesNotThrow(() =>
		validateCandidateFileSet(
			inventory,
			'1.2.3-beta.1',
			'distributable-unsigned'
		)
	);
	assert.throws(
		() =>
			validateCandidateFileSet(
				[...inventory, {fileName: 'builder-debug.yml'}],
				'1.2.3-beta.1',
				'distributable-unsigned'
			),
		/exact release file set/
	);
});

test('draft comparison accepts exact candidate bytes and publication retry files', () => {
	const release = draftRelease();
	release.assets.push(
		{name: 'release-record.json', digest: 'sha256:stale', size: 12},
		{
			name: 'Twine-RS-1.2.3-beta.1-release-evidence.zip',
			digest: 'sha256:stale',
			size: 99
		}
	);

	assert.doesNotThrow(() =>
		validateDraftRelease({metadata: metadata(), release})
	);
});

test('draft comparison binds the promoted candidate metadata asset', () => {
	const candidateMetadataAsset = {
		githubName: 'release-candidate.json',
		sha256: 'e'.repeat(64),
		size: 123
	};
	const release = draftRelease();
	release.assets.push({
		name: candidateMetadataAsset.githubName,
		digest: `sha256:${candidateMetadataAsset.sha256}`,
		size: candidateMetadataAsset.size
	});
	assert.doesNotThrow(() =>
		validateDraftRelease({
			candidateMetadataAsset,
			metadata: metadata(),
			release
		})
	);
	release.assets.at(-1).digest = `sha256:${'f'.repeat(64)}`;
	assert.throws(
		() =>
			validateDraftRelease({
				candidateMetadataAsset,
				metadata: metadata(),
				release
			}),
		/release-candidate\.json has the wrong digest/
	);
});

test('prepublication comparison binds both final evidence assets by digest', () => {
	const release = draftRelease();
	const publicationAssets = [
		{
			githubName: 'release-record.json',
			sha256: 'b'.repeat(64),
			size: 12
		},
		{
			githubName: 'Twine-RS-1.2.3-beta.1-release-evidence.zip',
			sha256: 'c'.repeat(64),
			size: 99
		}
	];
	release.assets.push(
		{
			name: publicationAssets[0].githubName,
			digest: `sha256:${publicationAssets[0].sha256}`,
			size: publicationAssets[0].size
		},
		{
			name: publicationAssets[1].githubName,
			digest: `sha256:${publicationAssets[1].sha256}`,
			size: publicationAssets[1].size
		}
	);

	assert.doesNotThrow(() =>
		validatePublicationDraft({
			metadata: metadata(),
			publicationAssets,
			release
		})
	);

	const changed = structuredClone(release);
	changed.assets.at(-1).digest = `sha256:${'d'.repeat(64)}`;
	assert.throws(
		() =>
			validatePublicationDraft({
				metadata: metadata(),
				publicationAssets,
				release: changed
			}),
		/wrong digest/
	);

	assert.throws(
		() =>
			validatePublicationDraft({
				metadata: metadata(),
				publicationAssets,
				release: draftRelease()
			}),
		/exact final evidence set/
	);
});

test('draft comparison rejects missing, changed, and unrelated assets', () => {
	assert.throws(
		() =>
			validateDraftRelease({
				metadata: metadata(),
				release: draftRelease({assets: []})
			}),
		/Draft release is missing WHICH\.TO\.DOWNLOAD\.md/
	);
	assert.throws(
		() =>
			validateDraftRelease({
				metadata: metadata(),
				release: draftRelease({
					assets: [
						{
							name: 'WHICH.TO.DOWNLOAD.md',
							digest: `sha256:${'b'.repeat(64)}`,
							size: 42
						}
					]
				})
			}),
		/wrong digest/
	);
	const release = draftRelease();
	release.assets.push({
		name: 'uninspected.txt',
		digest: `sha256:${digest}`,
		size: 1
	});
	assert.throws(
		() => validateDraftRelease({metadata: metadata(), release}),
		/unexpected assets: uninspected\.txt/
	);
});

test('draft comparison binds tag, title, notes, and prerelease state', () => {
	for (const [field, value, message] of [
		['tag_name', 'v9.9.9', /tag does not match/],
		['name', 'Wrong title', /title does not match/],
		['body', 'Changed notes', /notes do not match/],
		['prerelease', false, /prerelease state does not match/]
	]) {
		assert.throws(
			() =>
				validateDraftRelease({
					metadata: metadata(),
					release: draftRelease({[field]: value})
				}),
			message
		);
	}
});

test('candidate run validation is fail-closed for provenance and retention', () => {
	const expected = {
		artifactName: 'desktop-pretag-v1.2.3-beta.1-unsigned-hash',
		repository: 'twine-rs-labs/twine.rs',
		sourceCommit: '1'.repeat(40),
		workflowPath: '.github/workflows/release-candidate.yml',
		workflowRunId: '123'
	};
	const run = {
		id: 123,
		repository: {full_name: expected.repository},
		path: expected.workflowPath,
		head_sha: expected.sourceCommit,
		status: 'completed',
		conclusion: 'success',
		event: 'workflow_dispatch'
	};
	const artifacts = {
		artifacts: [
			{
				name: expected.artifactName,
				expired: false,
				size_in_bytes: 10,
				workflow_run: {id: 123}
			}
		]
	};

	assert.doesNotThrow(() => validateCandidateRun({artifacts, expected, run}));
	assert.throws(
		() =>
			validateCandidateRun({
				artifacts,
				expected,
				run: {...run, conclusion: 'failure'}
			}),
		/completed successfully/
	);
	assert.throws(
		() =>
			validateCandidateRun({
				artifacts: {
					artifacts: [{...artifacts.artifacts[0], expired: true}]
				},
				expected,
				run
			}),
		/has expired/
	);
	assert.throws(
		() =>
			validateCandidateRun({
				artifacts: {artifacts: []},
				expected,
				run
			}),
		/must retain exactly one desktop-pretag-/
	);
	assert.throws(
		() =>
			validateCandidateRun({
				artifacts,
				expected,
				run: {...run, head_sha: '2'.repeat(40)}
			}),
		/head SHA does not match/
	);
});

test('retained CI evidence remains valid after the 14-day package artifact expires', () => {
	assert.doesNotThrow(() =>
		validateCandidateCiEvidence(ciEvidence(), {
			packagedRun: boundRun(
				12,
				'.github/workflows/packaged-electron-smoke.yml'
			),
			qualityRun: boundRun(11, '.github/workflows/quality.yml'),
			repository: 'twine-rs-labs/twine.rs',
			sourceCommit
		})
	);
});

test('retained CI evidence rejects provenance tampering', () => {
	for (const [mutate, message] of [
		[
			evidence => {
				evidence.quality.headSha = '2'.repeat(40);
			},
			/Quality head SHA/
		],
		[
			evidence => {
				evidence.packagedElectron.url =
					'https://github.com/twine-rs-labs/twine.rs/actions/runs/999';
			},
			/Packaged Electron URL/
		],
		[
			evidence => {
				evidence.desktopLocalTestBundle.digest = `sha256:${'A'.repeat(64)}`;
			},
			/artifact digest/
		],
		[
			evidence => {
				evidence.desktopLocalTestBundle.size = 0;
			},
			/artifact size/
		]
	]) {
		const changed = ciEvidence();
		mutate(changed);
		assert.throws(
			() =>
				validateCandidateCiEvidence(changed, {
					repository: 'twine-rs-labs/twine.rs',
					sourceCommit
				}),
			message
		);
	}
});
