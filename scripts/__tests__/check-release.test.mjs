import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, test} from 'node:test';
import {createRequire} from 'node:module';

const repositoryRoot = resolve(
	dirname(fileURLToPath(import.meta.url)),
	'../..'
);
const script = join(repositoryRoot, 'scripts/check-release.mjs');
const require = createRequire(import.meta.url);
const {
	distributionArtifactPath,
	profiles,
	requiredArtifactMatrix,
	targetManifestName
} = require('../release-profile.cjs');
const version = '0.2.0-beta.1';
const tag = `v${version}`;
const commit = 'a'.repeat(40);
const workspaceCrates = [
	'twine_cli',
	'twine_core',
	'twine_export',
	'twine_graph',
	'twine_model',
	'twine_native',
	'twine_parse',
	'twine_search',
	'twine_store',
	'twine_wasm'
];
const temporaryRoots = [];

function writeJson(path, value) {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'twine-rs-release-check-'));
	const plan = {
		schemaVersion: 1,
		version,
		tag,
		releaseDate: '2026-08-01',
		channel: 'prerelease',
		profile: profiles.unsigned,
		releaseManager: '@manager',
		checklistIssue: 'https://github.com/twine-rs-labs/twine.rs/issues/123',
		firstRelease: true,
		previousKnownGoodVersion: null,
		approvals: {
			releaseManager: true
		},
		compatibility: {
			projectFormat: 'unchanged',
			settingsMigration: 'none',
			previousVersionCanOpenProjects: 'not-applicable',
			backupRequired: false,
			notes: 'No migration is required.'
		},
		rollback: {
			application: 'Uninstall the prerelease.',
			projectData: 'Restore the project backup.',
			tested: true,
			evidence: 'https://github.com/twine-rs-labs/twine.rs/actions/runs/3'
		},
		knownIssues: []
	};
	const packageJson = {version};
	const packageLock = {version, packages: {'': {version}}};
	const cargoLock = workspaceCrates
		.map(name => `[[package]]\nname = "${name}"\nversion = "${version}"\n`)
		.join('\n');
	const checklist = {
		url: plan.checklistIssue,
		state: 'OPEN',
		body: [
			'# Release',
			'',
			...Array.from(
				{length: 24},
				(_, index) => `- [x] Pre-publication item ${index + 1}`
			),
			'',
			'## Post-publication',
			'',
			'- [ ] Download smoke',
			'- [ ] Closeout'
		].join('\n')
	};
	const artifactManifest = {
		schemaVersion: 1,
		profile: plan.profile,
		applicationVersion: version,
		sourceCommit: commit,
		sourceTree: 'clean',
		artifacts: requiredArtifactMatrix(version, plan.profile).map(
			(artifact, index) => ({
				fileName: distributionArtifactPath(artifact),
				sha256: `${index}`.padStart(64, '0'),
				size: index + 1
			})
		),
		targetManifests: [
			['win', 'x64'],
			['mac', 'x64'],
			['mac', 'arm64'],
			['linux', 'x64'],
			['linux', 'arm64']
		].map(
			([platform, arch]) =>
				`provenance/${targetManifestName(version, platform, arch)}`
		)
	};

	mkdirSync(join(root, 'docs/releases/plans'), {recursive: true});
	writeJson(join(root, 'package.json'), packageJson);
	writeJson(join(root, 'package-lock.json'), packageLock);
	writeFileSync(
		join(root, 'Cargo.toml'),
		`[workspace.package]\nversion = "${version}"\n`
	);
	writeFileSync(join(root, 'Cargo.lock'), cargoLock);
	writeFileSync(
		join(root, 'CHANGELOG.md'),
		`# Changelog\n\n## [Unreleased]\n\n## [${version}] - ${plan.releaseDate}\n\n### Added\n\n- Formal release governance.\n`
	);
	writeJson(join(root, 'docs/releases/plans', `${tag}.json`), plan);
	writeJson(join(root, 'checklist.json'), checklist);
	writeJson(join(root, 'artifact-manifest.json'), artifactManifest);
	mkdirSync(join(root, 'provenance'));
	for (const fileName of artifactManifest.targetManifests) {
		writeJson(join(root, fileName), {target: fileName});
	}
	mkdirSync(join(root, 'compliance'));
	for (const fileName of [
		'LICENSE',
		'SHA256SUMS.txt',
		'WHICH TO DOWNLOAD.md',
		'release-notes.md'
	]) {
		writeFileSync(join(root, fileName), `${fileName}\n`);
	}
	for (const fileName of [
		'LICENSES.chromium.html',
		'THIRD_PARTY_NOTICES.md',
		'sbom.cdx.json'
	]) {
		writeFileSync(join(root, 'compliance', fileName), `${fileName}\n`);
	}
	temporaryRoots.push(root);

	return {
		artifactManifest,
		checklist,
		plan,
		planPath: join(root, 'docs/releases/plans', `${tag}.json`),
		root
	};
}

function run(releaseFixture, ...args) {
	return spawnSync(
		process.execPath,
		[
			script,
			'--root',
			releaseFixture.root,
			'--plan',
			releaseFixture.planPath,
			'--commit',
			commit,
			...args
		],
		{encoding: 'utf8'}
	);
}

afterEach(() => {
	for (const root of temporaryRoots.splice(0)) {
		rmSync(root, {force: true, recursive: true});
	}
});

test('validates a candidate and writes curated release notes', () => {
	const releaseFixture = fixture();
	const notesPath = join(releaseFixture.root, 'release-notes.md');
	const result = run(
		releaseFixture,
		'--artifact-manifest',
		'artifact-manifest.json',
		'--write-notes',
		notesPath
	);

	assert.equal(result.status, 0, result.stderr);
	const notes = readFileSync(notesPath, 'utf8');
	assert.match(notes, /Formal release governance/);
	assert.match(notes, /Deliberately unsigned/);
	assert.match(notes, /First formal Twine RS release/i);
	assert.match(notes, new RegExp(releaseFixture.plan.checklistIssue));
});

test('requires canonical distribution paths in the aggregate manifest', () => {
	const releaseFixture = fixture();
	const [artifact] = releaseFixture.artifactManifest.artifacts;

	artifact.fileName = artifact.fileName.split('/').at(-1);
	writeJson(
		join(releaseFixture.root, 'artifact-manifest.json'),
		releaseFixture.artifactManifest
	);
	const result = run(
		releaseFixture,
		'--artifact-manifest',
		'artifact-manifest.json'
	);

	assert.equal(result.status, 1);
	assert.match(
		result.stderr,
		/artifact manifest does not contain the exact supported artifact matrix/
	);
});

test('publication validation writes a manifest-bound release record', () => {
	const releaseFixture = fixture();
	const recordPath = join(releaseFixture.root, 'release-record.json');
	const result = run(
		releaseFixture,
		'--phase',
		'publish',
		'--checklist-json',
		'checklist.json',
		'--artifact-manifest',
		'artifact-manifest.json',
		'--workflow-url',
		'https://github.com/twine-rs-labs/twine.rs/actions/runs/4',
		'--quality-run',
		'https://github.com/twine-rs-labs/twine.rs/actions/runs/1',
		'--packaged-app-run',
		'https://github.com/twine-rs-labs/twine.rs/actions/runs/2',
		'--write-record',
		recordPath
	);

	assert.equal(result.status, 0, result.stderr);
	const record = JSON.parse(readFileSync(recordPath, 'utf8'));
	assert.equal(record.sourceCommit, commit);
	assert.equal(record.checklist.prePublicationComplete, true);
	assert.equal(record.checklist.postPublicationComplete, false);
	assert.deepEqual(record.approvals, {releaseManager: true});
	assert.equal(
		record.validation.qualityRun,
		'https://github.com/twine-rs-labs/twine.rs/actions/runs/1'
	);
	assert.equal(record.provenance.artifactCount, 7);
	assert.equal(record.provenance.targetManifests.length, 5);
	assert.equal(record.provenance.evidenceFiles.length, 7);
	assert.match(record.provenance.artifactManifest.sha256, /^[0-9a-f]{64}$/);
});

test('blocks publication while a pre-publication item is unchecked', () => {
	const releaseFixture = fixture();

	releaseFixture.checklist.body = releaseFixture.checklist.body.replace(
		'- [x] Pre-publication item 1',
		'- [ ] Pre-publication item 1'
	);
	writeJson(
		join(releaseFixture.root, 'checklist.json'),
		releaseFixture.checklist
	);
	const result = run(
		releaseFixture,
		'--phase',
		'publish',
		'--checklist-json',
		'checklist.json'
	);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /Every checklist item before Post-publication/);
});

test('rejects version drift and unreviewed plan fields', () => {
	const versionFixture = fixture();
	const packageJsonPath = join(versionFixture.root, 'package.json');

	writeJson(packageJsonPath, {version: '0.2.0-beta.2'});
	const versionResult = run(versionFixture);
	assert.equal(versionResult.status, 1);
	assert.match(versionResult.stderr, /package\.json version/);

	const fieldFixture = fixture();
	fieldFixture.plan.unreviewed = true;
	writeJson(fieldFixture.planPath, fieldFixture.plan);
	const fieldResult = run(fieldFixture);
	assert.equal(fieldResult.status, 1);
	assert.match(fieldResult.stderr, /unexpected fields: unreviewed/);
});

test('rejects a plan without explicit release-manager approval', () => {
	const releaseFixture = fixture();
	releaseFixture.plan.approvals.releaseManager = false;
	writeJson(releaseFixture.planPath, releaseFixture.plan);

	const result = run(releaseFixture);

	assert.equal(result.status, 1);
	assert.match(result.stderr, /releaseManager approval must be true/);
});

test('rejects impossible dates and non-preceding rollback versions', () => {
	const dateFixture = fixture();

	dateFixture.plan.releaseDate = '2026-02-31';
	writeJson(dateFixture.planPath, dateFixture.plan);
	const dateResult = run(dateFixture);
	assert.equal(dateResult.status, 1);
	assert.match(dateResult.stderr, /releaseDate must be a valid/);

	const orderFixture = fixture();
	orderFixture.plan.firstRelease = false;
	orderFixture.plan.previousKnownGoodVersion = '0.3.0';
	orderFixture.plan.compatibility.previousVersionCanOpenProjects = 'yes';
	writeJson(orderFixture.planPath, orderFixture.plan);
	const orderResult = run(orderFixture);
	assert.equal(orderResult.status, 1);
	assert.match(orderResult.stderr, /must precede version/);
});

test('closeout requires every item checked and the issue closed', () => {
	const releaseFixture = fixture();

	releaseFixture.checklist.body = releaseFixture.checklist.body.replaceAll(
		'- [ ]',
		'- [x]'
	);
	releaseFixture.checklist.state = 'CLOSED';
	writeJson(
		join(releaseFixture.root, 'checklist.json'),
		releaseFixture.checklist
	);
	const result = run(
		releaseFixture,
		'--phase',
		'closeout',
		'--checklist-json',
		'checklist.json'
	);

	assert.equal(result.status, 0, result.stderr);
});
