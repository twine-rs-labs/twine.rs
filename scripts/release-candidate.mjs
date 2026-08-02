#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {createReadStream, readFileSync} from 'node:fs';
import {readdir, stat, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {basename, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const require = createRequire(import.meta.url);
const {
	distributionArtifactPath,
	requiredArtifactMatrix,
	targetManifestName
} = require('./release-profile.cjs');
const workflowPath = '.github/workflows/release-candidate.yml';
const candidateKind = 'pretag-main';
const qualityWorkflowPath = '.github/workflows/quality.yml';
const packagedWorkflowPath = '.github/workflows/packaged-electron-smoke.yml';
const packagedEvidenceArtifactName = 'desktop-local-test-bundle';

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function readJson(path, label) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		throw new Error(
			`${label} is not valid JSON: ${
				error instanceof Error ? error.message : error
			}`
		);
	}
}

async function sha256(path) {
	const hash = createHash('sha256');

	for await (const chunk of createReadStream(path)) {
		hash.update(chunk);
	}

	return hash.digest('hex');
}

function normalizedRelativePath(root, path) {
	return relative(root, path).split(sep).join('/');
}

export function githubReleaseAssetName(fileName) {
	// GitHub normalizes spaces in uploaded release asset names to periods.
	return fileName === 'WHICH TO DOWNLOAD.md'
		? 'WHICH.TO.DOWNLOAD.md'
		: fileName;
}

export function pretagCandidateArtifactName(tag, profile, planSha256) {
	assert(/^[0-9a-f]{64}$/.test(planSha256), 'Plan SHA-256 is invalid.');
	return `desktop-pretag-${tag}-${profile}-${planSha256}`;
}

export function assertPreTag({cwd = process.cwd(), remote = 'origin', tag}) {
	assert(
		/^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-[0-9A-Za-z.-]+)?$/.test(
			tag
		),
		'Candidate tag is invalid.'
	);
	const reference = `refs/tags/${tag}`;
	const local = spawnSync(
		'git',
		['show-ref', '--verify', '--quiet', reference],
		{cwd, encoding: 'utf8'}
	);
	if (local.status === 0) {
		throw new Error(
			`${tag} already exists locally; never rebuild or replace its candidate.`
		);
	}
	assert(local.status === 1, `Could not prove that ${tag} is absent locally.`);

	const remoteResult = spawnSync(
		'git',
		['ls-remote', '--exit-code', '--refs', remote, reference],
		{cwd, encoding: 'utf8'}
	);
	if (remoteResult.status === 0) {
		throw new Error(
			`${tag} already exists remotely; never rebuild or replace its candidate.`
		);
	}
	assert(
		remoteResult.status === 2,
		`Could not prove that ${tag} is absent from ${remote}.`
	);
}

async function distributionFiles(root, current = root) {
	const entries = await readdir(current, {withFileTypes: true});
	const paths = [];

	for (const entry of entries) {
		const path = join(current, entry.name);

		if (entry.isDirectory()) {
			paths.push(...(await distributionFiles(root, path)));
		} else if (entry.isFile()) {
			paths.push(path);
		} else {
			throw new Error(
				`Release candidate contains unsupported filesystem entry ${normalizedRelativePath(root, path)}.`
			);
		}
	}

	return paths;
}

export async function inventoryDistribution(root) {
	const absoluteRoot = resolve(root);
	const paths = (await distributionFiles(absoluteRoot)).sort();
	const inventory = [];

	for (const path of paths) {
		const fileName = normalizedRelativePath(absoluteRoot, path);
		const fileStat = await stat(path);

		inventory.push({
			fileName,
			githubName: githubReleaseAssetName(basename(fileName)),
			sha256: await sha256(path),
			size: fileStat.size
		});
	}

	const githubNames = inventory.map(file => file.githubName);
	assert(
		new Set(githubNames).size === githubNames.length,
		'Release candidate contains duplicate GitHub asset names.'
	);
	return inventory;
}

function expectedMatrix(version, profile) {
	return requiredArtifactMatrix(version, profile)
		.map(distributionArtifactPath)
		.sort();
}

function expectedTargetManifests(version) {
	return [
		['win', 'x64'],
		['mac', 'x64'],
		['mac', 'arm64'],
		['linux', 'x64'],
		['linux', 'arm64']
	]
		.map(
			([platform, arch]) =>
				`provenance/${targetManifestName(version, platform, arch)}`
		)
		.sort();
}

export function expectedCandidateFilePaths(version, profile) {
	return [
		...expectedMatrix(version, profile),
		...expectedTargetManifests(version),
		'LICENSE',
		'SHA256SUMS.txt',
		'WHICH TO DOWNLOAD.md',
		'artifact-manifest.json',
		'compliance/LICENSES.chromium.html',
		'compliance/THIRD_PARTY_NOTICES.md',
		'compliance/sbom.cdx.json',
		'release-notes.md'
	].sort();
}

export function validateCandidateFileSet(inventory, version, profile) {
	const actual = inventory.map(file => file.fileName).sort();
	const expected = expectedCandidateFilePaths(version, profile);
	assert(
		JSON.stringify(actual) === JSON.stringify(expected),
		'Candidate does not contain the exact release file set.'
	);
}

function validateManifest(manifest, {commit, profile, version}, inventory) {
	validateCandidateFileSet(inventory, version, profile);
	assert(manifest.schemaVersion === 1, 'Candidate manifest schema is invalid.');
	assert(
		manifest.applicationVersion === version,
		'Candidate manifest version does not match the release plan.'
	);
	assert(
		manifest.profile === profile,
		'Candidate manifest profile does not match the release plan.'
	);
	assert(
		manifest.sourceCommit?.toLowerCase() === commit.toLowerCase(),
		'Candidate manifest source commit does not match the peeled release tag.'
	);
	assert(
		manifest.sourceTree === 'clean',
		'Candidate manifest does not record a clean source tree.'
	);

	const artifacts = Array.isArray(manifest.artifacts) ? manifest.artifacts : [];
	const matrix = artifacts.map(artifact => artifact.fileName).sort();
	assert(
		JSON.stringify(matrix) === JSON.stringify(expectedMatrix(version, profile)),
		'Candidate manifest does not contain the exact supported artifact matrix.'
	);
	const targetManifests = Array.isArray(manifest.targetManifests)
		? [...manifest.targetManifests].sort()
		: [];
	assert(
		JSON.stringify(targetManifests) ===
			JSON.stringify(expectedTargetManifests(version)),
		'Candidate manifest does not contain the exact target-manifest matrix.'
	);

	const byName = new Map(inventory.map(file => [file.fileName, file]));
	for (const artifact of artifacts) {
		const file = byName.get(artifact.fileName);
		assert(file, `Candidate is missing ${artifact.fileName}.`);
		assert(
			file.sha256 === artifact.sha256 && file.size === artifact.size,
			`Candidate artifact ${artifact.fileName} does not match its manifest.`
		);
	}

	return {matrix, targetManifests};
}

function validateIdentity(metadata, expected) {
	assert(metadata.schemaVersion === 2, 'Candidate metadata schema is invalid.');
	for (const key of [
		'artifactName',
		'candidateKind',
		'repository',
		'workflowPath',
		'tag',
		'version',
		'profile',
		'channel',
		'sourceCommit'
	]) {
		assert(
			metadata[key] === expected[key],
			`Candidate ${key} does not match the requested release.`
		);
	}
	assert(
		String(metadata.workflowRunId) === String(expected.workflowRunId),
		'Candidate workflow run ID does not match the requested run.'
	);
	assert(
		metadata.headSha === expected.sourceCommit,
		'Candidate workflow head SHA does not match the peeled release tag.'
	);
}

function positiveIntegerString(value, label) {
	const normalized = String(value);
	assert(/^[1-9][0-9]*$/.test(normalized), `${label} is invalid.`);
	return normalized;
}

function expectedRunUrl(repository, runId) {
	return `https://github.com/${repository}/actions/runs/${runId}`;
}

function validateBoundRun(runEvidence, expected, run) {
	assert(
		runEvidence && typeof runEvidence === 'object',
		`${expected.label} evidence is missing.`
	);
	assert(
		JSON.stringify(Object.keys(runEvidence).sort()) ===
			JSON.stringify(['headSha', 'runId', 'url', 'workflowPath']),
		`${expected.label} evidence fields are invalid.`
	);
	const runId = positiveIntegerString(
		runEvidence.runId,
		`${expected.label} run ID`
	);
	assert(
		runEvidence.workflowPath === expected.workflowPath,
		`${expected.label} workflow path is invalid.`
	);
	assert(
		runEvidence.headSha === expected.sourceCommit,
		`${expected.label} head SHA does not match the candidate source commit.`
	);
	assert(
		runEvidence.url === expectedRunUrl(expected.repository, runId),
		`${expected.label} URL does not match its repository and run ID.`
	);

	if (run) {
		assert(
			String(run.id) === runId,
			`${expected.label} run response has the wrong ID.`
		);
		assert(
			run.repository?.full_name === expected.repository,
			`${expected.label} run belongs to a different repository.`
		);
		assert(
			run.path === expected.workflowPath,
			`${expected.label} run executed a different workflow.`
		);
		assert(
			run.head_sha === expected.sourceCommit,
			`${expected.label} run has the wrong head SHA.`
		);
		assert(
			run.html_url === runEvidence.url,
			`${expected.label} run URL does not match candidate metadata.`
		);
		assert(
			run.status === 'completed' && run.conclusion === 'success',
			`${expected.label} run must be completed successfully.`
		);
	}

	return runId;
}

export function validateCandidateCiEvidence(
	ciEvidence,
	{packagedRun, qualityRun, repository, sourceCommit}
) {
	assert(
		ciEvidence && typeof ciEvidence === 'object',
		'Candidate CI evidence is missing.'
	);
	assert(
		JSON.stringify(Object.keys(ciEvidence).sort()) ===
			JSON.stringify(['desktopLocalTestBundle', 'packagedElectron', 'quality']),
		'Candidate CI evidence fields are invalid.'
	);
	validateBoundRun(
		ciEvidence.quality,
		{
			label: 'Quality',
			repository,
			sourceCommit,
			workflowPath: qualityWorkflowPath
		},
		qualityRun
	);
	validateBoundRun(
		ciEvidence.packagedElectron,
		{
			label: 'Packaged Electron',
			repository,
			sourceCommit,
			workflowPath: packagedWorkflowPath
		},
		packagedRun
	);

	const artifact = ciEvidence.desktopLocalTestBundle;
	assert(
		artifact && typeof artifact === 'object',
		'Desktop local test bundle evidence is missing.'
	);
	assert(
		JSON.stringify(Object.keys(artifact).sort()) ===
			JSON.stringify(['digest', 'id', 'name', 'size']),
		'Desktop local test bundle evidence fields are invalid.'
	);
	assert(
		Number.isSafeInteger(artifact.id) && artifact.id > 0,
		'Desktop local test bundle artifact ID is invalid.'
	);
	assert(
		artifact.name === packagedEvidenceArtifactName,
		'Desktop local test bundle artifact name is invalid.'
	);
	assert(
		typeof artifact.digest === 'string' &&
			/^sha256:[0-9a-f]{64}$/.test(artifact.digest),
		'Desktop local test bundle artifact digest is invalid.'
	);
	assert(
		Number.isSafeInteger(artifact.size) && artifact.size > 0,
		'Desktop local test bundle artifact size is invalid.'
	);

	return ciEvidence;
}

function ciEvidenceFromOptions(options) {
	return {
		quality: {
			workflowPath: qualityWorkflowPath,
			runId: options.qualityRunId,
			url: options.qualityRunUrl,
			headSha: options.qualityRunHeadSha
		},
		packagedElectron: {
			workflowPath: packagedWorkflowPath,
			runId: options.packagedRunId,
			url: options.packagedRunUrl,
			headSha: options.packagedRunHeadSha
		},
		desktopLocalTestBundle: {
			id: Number(options.desktopBundleArtifactId),
			name: options.desktopBundleArtifactName,
			digest: options.desktopBundleArtifactDigest,
			size: Number(options.desktopBundleArtifactSize)
		}
	};
}

export function validateCandidateRun({artifacts, expected, run}) {
	assert(
		String(run.id) === String(expected.workflowRunId),
		'Candidate run response does not match the requested run ID.'
	);
	assert(
		run.repository?.full_name === expected.repository,
		'Candidate run belongs to a different repository.'
	);
	assert(
		run.path === expected.workflowPath,
		'Candidate run did not execute the release workflow.'
	);
	if (expected.sourceCommit) {
		assert(
			run.head_sha?.toLowerCase() === expected.sourceCommit.toLowerCase(),
			'Candidate run head SHA does not match the intended source commit.'
		);
	}
	assert(
		run.status === 'completed' && run.conclusion === 'success',
		'Candidate run must be completed successfully.'
	);
	assert(
		run.event === 'workflow_dispatch',
		'Candidate run was not manually dispatched from main.'
	);

	const matches = (artifacts.artifacts ?? []).filter(
		artifact => artifact.name === expected.artifactName
	);
	assert(
		matches.length === 1,
		`Candidate run must retain exactly one ${expected.artifactName} artifact.`
	);
	const [artifact] = matches;
	assert(!artifact.expired, 'Candidate release unit has expired.');
	assert(
		Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0,
		'Candidate release unit is empty or has invalid metadata.'
	);
	if (artifact.workflow_run?.id !== undefined) {
		assert(
			String(artifact.workflow_run.id) === String(expected.workflowRunId),
			'Candidate artifact belongs to a different workflow run.'
		);
	}

	return artifact;
}

function releaseAssetDigest(asset) {
	return typeof asset.digest === 'string' ? asset.digest.toLowerCase() : '';
}

export function validateDraftRelease({
	candidateMetadataAsset,
	metadata,
	release
}) {
	assert(
		Array.isArray(metadata.releaseAssets),
		'Candidate metadata does not contain a release asset inventory.'
	);
	assert(
		release.tag_name === metadata.tag,
		'Draft release tag does not match.'
	);
	assert(release.draft === true, 'Candidate GitHub Release is not a draft.');
	assert(
		release.prerelease === (metadata.channel === 'prerelease'),
		'Draft prerelease state does not match the plan.'
	);
	assert(
		release.name === `Twine RS ${metadata.version}`,
		'Draft release title does not match the plan.'
	);
	assert(
		release.body === metadata.releaseNotes,
		'Draft release notes do not match the inspected candidate.'
	);

	const actualAssets = new Map();
	for (const asset of release.assets ?? []) {
		assert(
			!actualAssets.has(asset.name),
			`Draft release contains duplicate asset ${asset.name}.`
		);
		actualAssets.set(asset.name, asset);
	}

	for (const expected of metadata.releaseAssets) {
		const actual = actualAssets.get(expected.githubName);
		assert(actual, `Draft release is missing ${expected.githubName}.`);
		assert(
			actual.size === expected.size,
			`Draft asset ${expected.githubName} has the wrong size.`
		);
		assert(
			releaseAssetDigest(actual) === `sha256:${expected.sha256}`,
			`Draft asset ${expected.githubName} has the wrong digest.`
		);
		actualAssets.delete(expected.githubName);
	}
	if (candidateMetadataAsset) {
		const actual = actualAssets.get(candidateMetadataAsset.githubName);
		assert(actual, 'Draft release is missing release-candidate.json.');
		assert(
			actual.size === candidateMetadataAsset.size,
			'Draft asset release-candidate.json has the wrong size.'
		);
		assert(
			releaseAssetDigest(actual) === `sha256:${candidateMetadataAsset.sha256}`,
			'Draft asset release-candidate.json has the wrong digest.'
		);
		actualAssets.delete(candidateMetadataAsset.githubName);
	}

	const allowedPublicationExtras = new Set([
		'release-record.json',
		`Twine-RS-${metadata.version}-release-evidence.zip`
	]);
	const unrelated = [...actualAssets.keys()].filter(
		name => !allowedPublicationExtras.has(name)
	);
	assert(
		unrelated.length === 0,
		`Draft release contains unexpected assets: ${unrelated.join(', ')}.`
	);

	return actualAssets;
}

export function validatePublicationDraft({
	candidateMetadataAsset,
	metadata,
	publicationAssets,
	release
}) {
	const remainingAssets = validateDraftRelease({
		candidateMetadataAsset,
		metadata,
		release
	});
	const expectedNames = [
		'release-record.json',
		`Twine-RS-${metadata.version}-release-evidence.zip`
	].sort();
	const describedNames = publicationAssets
		.map(asset => asset.githubName)
		.sort();

	assert(
		JSON.stringify(describedNames) === JSON.stringify(expectedNames),
		'Publication asset inventory does not contain the exact final evidence set.'
	);
	assert(
		JSON.stringify([...remainingAssets.keys()].sort()) ===
			JSON.stringify(expectedNames),
		'Draft release does not contain the exact final evidence set.'
	);

	for (const expected of publicationAssets) {
		const actual = remainingAssets.get(expected.githubName);
		assert(
			actual.size === expected.size,
			`Draft asset ${expected.githubName} has the wrong size.`
		);
		assert(
			releaseAssetDigest(actual) === `sha256:${expected.sha256}`,
			`Draft asset ${expected.githubName} has the wrong digest.`
		);
	}
}

async function publicationAssetInventory(paths) {
	const inventory = [];

	for (const path of paths) {
		const fileStat = await stat(path);
		inventory.push({
			githubName: githubReleaseAssetName(basename(path)),
			sha256: await sha256(path),
			size: fileStat.size
		});
	}

	return inventory.sort((left, right) =>
		left.githubName.localeCompare(right.githubName)
	);
}

async function candidateMetadataAsset(path) {
	return {
		githubName: basename(path),
		sha256: await sha256(path),
		size: (await stat(path)).size
	};
}

function metadataExpected(options, plan) {
	return {
		artifactName: options.artifactName,
		candidateKind,
		channel: plan.channel,
		profile: plan.profile,
		repository: options.repository,
		sourceCommit: options.commit,
		tag: options.tag,
		version: plan.version,
		workflowPath: options.workflowPath,
		workflowRunId: options.runId
	};
}

export async function createCandidateMetadata(options) {
	const plan = readJson(options.plan, 'release plan');
	assert(
		options.tag === plan.tag,
		'Candidate intended tag does not match its plan.'
	);
	assert(
		options.event === 'workflow_dispatch',
		'Pre-tag candidates must be manually dispatched.'
	);
	assert(
		/^[0-9a-f]{40}$/.test(options.commit),
		'Candidate source commit must be a lowercase 40-hex SHA.'
	);
	assert(
		Number.isSafeInteger(Number(options.runAttempt)) &&
			Number(options.runAttempt) > 0,
		'Candidate workflow attempt is invalid.'
	);
	const planSha256 = await sha256(options.plan);
	assert(
		options.artifactName ===
			pretagCandidateArtifactName(plan.tag, plan.profile, planSha256),
		'Candidate artifact name is not derived from the tag, profile, and plan hash.'
	);
	const inventory = await inventoryDistribution(options.distribution);
	const manifestPath = join(options.distribution, 'artifact-manifest.json');
	const manifest = readJson(manifestPath, 'artifact manifest');
	const matrix = validateManifest(
		manifest,
		{
			commit: options.commit,
			profile: plan.profile,
			version: plan.version
		},
		inventory
	);
	const releaseNotes = readFileSync(
		join(options.distribution, 'release-notes.md'),
		'utf8'
	);
	const ciEvidence = validateCandidateCiEvidence(
		ciEvidenceFromOptions(options),
		{
			repository: options.repository,
			sourceCommit: options.commit
		}
	);

	return {
		schemaVersion: 2,
		artifactName: options.artifactName,
		candidateKind,
		repository: options.repository,
		workflowPath: options.workflowPath,
		workflowRunId: String(options.runId),
		workflowAttempt: Number(options.runAttempt),
		workflowEvent: options.event,
		workflowUrl: options.workflowUrl,
		headSha: options.commit,
		tag: options.tag,
		version: plan.version,
		profile: plan.profile,
		channel: plan.channel,
		sourceCommit: options.commit,
		plan: {
			fileName: options.plan,
			sha256: planSha256
		},
		artifactManifest: {
			sha256: await sha256(manifestPath),
			size: (await stat(manifestPath)).size
		},
		matrix,
		ciEvidence,
		releaseNotes,
		releaseAssets: inventory
	};
}

export async function verifyCandidate(options) {
	const metadata = readJson(options.metadata, 'candidate metadata');
	const plan = readJson(options.plan, 'release plan');
	const expected = metadataExpected(options, plan);
	validateIdentity(metadata, expected);
	validateCandidateCiEvidence(metadata.ciEvidence, {
		packagedRun: readJson(options.packagedRunJson, 'packaged run response'),
		qualityRun: readJson(options.qualityRunJson, 'quality run response'),
		repository: options.repository,
		sourceCommit: options.commit
	});
	const planSha256 = await sha256(options.plan);
	assert(
		options.artifactName ===
			pretagCandidateArtifactName(plan.tag, plan.profile, planSha256),
		'Requested candidate artifact name is not deterministic for the release plan.'
	);
	assert(
		metadata.plan.sha256 === planSha256,
		'Candidate release plan bytes do not match the current tag.'
	);
	const inventory = await inventoryDistribution(options.distribution);
	assert(
		JSON.stringify(metadata.releaseAssets) === JSON.stringify(inventory),
		'Downloaded candidate files do not match the retained candidate inventory.'
	);
	const manifestPath = join(options.distribution, 'artifact-manifest.json');
	assert(
		metadata.artifactManifest.sha256 === (await sha256(manifestPath)) &&
			metadata.artifactManifest.size === (await stat(manifestPath)).size,
		'Downloaded candidate manifest does not match candidate metadata.'
	);
	const matrix = validateManifest(
		readJson(manifestPath, 'artifact manifest'),
		{commit: options.commit, profile: plan.profile, version: plan.version},
		inventory
	);
	assert(
		JSON.stringify(metadata.matrix) === JSON.stringify(matrix),
		'Candidate matrix does not match candidate metadata.'
	);
	const run = readJson(options.runJson, 'candidate run response');
	validateCandidateRun({
		artifacts: readJson(options.artifactsJson, 'candidate artifacts response'),
		expected,
		run
	});
	assert(
		metadata.workflowEvent === run.event &&
			metadata.workflowUrl === run.html_url,
		'Candidate workflow evidence does not match the retained metadata.'
	);
	assert(
		metadata.workflowAttempt === run.run_attempt,
		'Candidate workflow attempt does not match the retained metadata.'
	);
	if (options.releaseJson) {
		validateDraftRelease({
			candidateMetadataAsset: await candidateMetadataAsset(options.metadata),
			metadata,
			release: readJson(options.releaseJson, 'draft release response')
		});
	}

	return metadata;
}

function parseArgs(args) {
	const command = args.shift();
	const options = {workflowPath};

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		assert(arg.startsWith('--'), `Unknown argument "${arg}".`);
		const value = args[++index];
		assert(value, `${arg} requires a value.`);
		const key = arg
			.slice(2)
			.replaceAll(/-([a-z])/g, (_, letter) => letter.toUpperCase());
		options[key] = value;
	}

	return {command, options};
}

function requireOptions(options, names) {
	for (const name of names) {
		assert(
			options[name],
			`--${name.replaceAll(/[A-Z]/g, m => `-${m.toLowerCase()}`)} is required.`
		);
	}
}

async function main() {
	const {command, options} = parseArgs(process.argv.slice(2));

	if (command === 'assert-pretag') {
		requireOptions(options, ['tag']);
		assertPreTag({tag: options.tag});
		return;
	}

	if (command === 'write') {
		requireOptions(options, [
			'artifactName',
			'commit',
			'desktopBundleArtifactDigest',
			'desktopBundleArtifactId',
			'desktopBundleArtifactName',
			'desktopBundleArtifactSize',
			'distribution',
			'event',
			'output',
			'packagedRunHeadSha',
			'packagedRunId',
			'packagedRunUrl',
			'plan',
			'qualityRunHeadSha',
			'qualityRunId',
			'qualityRunUrl',
			'repository',
			'runAttempt',
			'runId',
			'tag',
			'workflowUrl'
		]);
		const metadata = await createCandidateMetadata(options);
		await writeFile(options.output, `${JSON.stringify(metadata, null, 2)}\n`);
		return;
	}

	if (command === 'write-bound-run-outputs') {
		requireOptions(options, ['commit', 'metadata', 'output', 'repository']);
		const metadata = readJson(options.metadata, 'candidate metadata');
		assert(
			metadata.schemaVersion === 2 &&
				metadata.repository === options.repository &&
				metadata.sourceCommit === options.commit &&
				/^[1-9][0-9]*$/.test(String(metadata.workflowRunId)) &&
				metadata.workflowUrl ===
					expectedRunUrl(options.repository, metadata.workflowRunId),
			'Candidate metadata cannot safely identify bound CI runs.'
		);
		const ciEvidence = validateCandidateCiEvidence(metadata.ciEvidence, {
			repository: options.repository,
			sourceCommit: options.commit
		});
		await writeFile(
			options.output,
			[
				`candidate_workflow_url=${metadata.workflowUrl}`,
				`packaged_run_id=${ciEvidence.packagedElectron.runId}`,
				`packaged_run_url=${ciEvidence.packagedElectron.url}`,
				`quality_run_id=${ciEvidence.quality.runId}`,
				`quality_run_url=${ciEvidence.quality.url}`
			].join('\n') + '\n',
			{flag: 'a'}
		);
		return;
	}

	if (command === 'verify-run') {
		requireOptions(options, [
			'artifactName',
			'artifactsJson',
			'commit',
			'repository',
			'runId',
			'runJson'
		]);
		validateCandidateRun({
			artifacts: readJson(
				options.artifactsJson,
				'candidate artifacts response'
			),
			expected: {
				artifactName: options.artifactName,
				repository: options.repository,
				sourceCommit: options.commit,
				workflowPath: options.workflowPath,
				workflowRunId: options.runId
			},
			run: readJson(options.runJson, 'candidate run response')
		});
		return;
	}

	if (command === 'verify-draft') {
		requireOptions(options, ['distribution', 'metadata', 'releaseJson']);
		const metadata = readJson(options.metadata, 'candidate metadata');
		assert(
			JSON.stringify(metadata.releaseAssets) ===
				JSON.stringify(await inventoryDistribution(options.distribution)),
			'Refreshed draft files do not match the retained candidate inventory.'
		);
		validateDraftRelease({
			candidateMetadataAsset: await candidateMetadataAsset(options.metadata),
			metadata,
			release: readJson(options.releaseJson, 'draft release response')
		});
		return;
	}

	if (command === 'write-publication-assets') {
		requireOptions(options, ['evidence', 'output', 'releaseRecord']);
		const inventory = await publicationAssetInventory([
			options.releaseRecord,
			options.evidence
		]);
		await writeFile(options.output, `${JSON.stringify(inventory, null, 2)}\n`);
		return;
	}

	if (command === 'verify-publication') {
		requireOptions(options, ['metadata', 'publicationAssets', 'releaseJson']);
		validatePublicationDraft({
			candidateMetadataAsset: await candidateMetadataAsset(options.metadata),
			metadata: readJson(options.metadata, 'candidate metadata'),
			publicationAssets: readJson(
				options.publicationAssets,
				'publication asset inventory'
			),
			release: readJson(options.releaseJson, 'draft release response')
		});
		return;
	}

	if (command === 'verify') {
		requireOptions(options, [
			'artifactName',
			'artifactsJson',
			'commit',
			'distribution',
			'metadata',
			'plan',
			'packagedRunJson',
			'qualityRunJson',
			'releaseJson',
			'repository',
			'runId',
			'runJson',
			'tag'
		]);
		await verifyCandidate(options);
		return;
	}

	if (command === 'verify-unit') {
		requireOptions(options, [
			'artifactName',
			'artifactsJson',
			'commit',
			'distribution',
			'metadata',
			'plan',
			'packagedRunJson',
			'qualityRunJson',
			'repository',
			'runId',
			'runJson',
			'tag'
		]);
		await verifyCandidate(options);
		return;
	}

	throw new Error(
		'Command must be assert-pretag, write, write-bound-run-outputs, write-publication-assets, verify-run, verify-draft, verify-publication, verify-unit, or verify.'
	);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main().catch(error => {
		console.error(error instanceof Error ? error.message : error);
		process.exitCode = 1;
	});
}
