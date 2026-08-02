#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {basename, dirname, isAbsolute, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateCandidateCiEvidence} from './release-candidate.mjs';

const require = createRequire(import.meta.url);
const {
	distributionArtifactPath,
	profiles,
	requiredArtifactMatrix,
	targetManifestName
} = require('./release-profile.cjs');
const scriptRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceCrateNames = [
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
const semverPattern =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const expectedTargets = [
	'Windows x64 (NSIS installer)',
	'macOS Apple Silicon (DMG)',
	'macOS Intel (DMG)',
	'Linux x64 (AppImage and ZIP)',
	'Linux ARM64 (AppImage and ZIP)'
];
const retainedEvidencePaths = [
	'LICENSE',
	'SHA256SUMS.txt',
	'WHICH TO DOWNLOAD.md',
	'compliance/LICENSES.chromium.html',
	'compliance/THIRD_PARTY_NOTICES.md',
	'compliance/sbom.cdx.json',
	'release-notes.md'
];

function usage() {
	return `Usage: npm run release:check -- --plan <path> [options]

Options:
  --tag <vX.Y.Z>                 Override the plan tag.
  --commit <40-hex-commit>       Override the source commit.
  --phase <candidate|publish|closeout>
  --check-tag                    Require an annotated tag at the source commit.
  --checklist-json <path>        GitHub issue JSON with url, state, and body.
  --artifact-manifest <path>     Validated aggregate artifact manifest.
  --write-notes <path>           Write the curated GitHub Release body.
  --write-record <path>          Write the retained release record.
  --quality-run <url>            Successful same-commit Quality run.
  --packaged-app-run <url>       Successful same-commit packaged-app run.
  --candidate-workflow-url <url> Draft candidate workflow reused for publication.
  --candidate-artifacts-json <path>
                                  Actions artifact response for the candidate run.
  --candidate-metadata <path>    Retained release-candidate.json.
  --workflow-url <url>           Record the release workflow run.
  --root <path>                  Repository root (primarily for tests).
`;
}

function parseArgs(args) {
	const options = {
		artifactManifest: undefined,
		candidateArtifactsJson: undefined,
		candidateMetadata: undefined,
		candidateWorkflowUrl: undefined,
		checkTag: false,
		checklistJson: undefined,
		commit: undefined,
		phase: 'candidate',
		plan: undefined,
		packagedAppRun: undefined,
		qualityRun: undefined,
		root: scriptRoot,
		tag: undefined,
		workflowUrl:
			process.env.GITHUB_SERVER_URL &&
			process.env.GITHUB_REPOSITORY &&
			process.env.GITHUB_RUN_ID
				? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
				: undefined,
		writeNotes: undefined,
		writeRecord: undefined
	};
	const valueOptions = new Map([
		['--artifact-manifest', 'artifactManifest'],
		['--candidate-artifacts-json', 'candidateArtifactsJson'],
		['--candidate-metadata', 'candidateMetadata'],
		['--candidate-workflow-url', 'candidateWorkflowUrl'],
		['--checklist-json', 'checklistJson'],
		['--commit', 'commit'],
		['--phase', 'phase'],
		['--plan', 'plan'],
		['--packaged-app-run', 'packagedAppRun'],
		['--quality-run', 'qualityRun'],
		['--root', 'root'],
		['--tag', 'tag'],
		['--workflow-url', 'workflowUrl'],
		['--write-notes', 'writeNotes'],
		['--write-record', 'writeRecord']
	]);

	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];

		if (arg === '--help' || arg === '-h') {
			console.log(usage());
			process.exit(0);
		}

		if (arg === '--check-tag') {
			options.checkTag = true;
			continue;
		}

		const key = valueOptions.get(arg);
		if (!key) {
			throw new Error(`Unknown argument "${arg}".`);
		}

		const value = args[++index];
		if (!value) {
			throw new Error(`${arg} requires a value.`);
		}
		options[key] = value;
	}

	if (!options.plan) {
		throw new Error('--plan is required.');
	}
	if (!new Set(['candidate', 'publish', 'closeout']).has(options.phase)) {
		throw new Error('--phase must be candidate, publish, or closeout.');
	}
	if (options.phase !== 'candidate' && !options.checklistJson) {
		throw new Error(`${options.phase} validation requires --checklist-json.`);
	}
	if (options.writeRecord && !options.artifactManifest) {
		throw new Error('--write-record requires --artifact-manifest.');
	}
	if (options.writeRecord && !options.checklistJson) {
		throw new Error('--write-record requires --checklist-json.');
	}
	if (
		options.writeRecord &&
		(!options.qualityRun || !options.packagedAppRun) &&
		!options.candidateMetadata
	) {
		throw new Error(
			'--write-record requires metadata-bound candidate evidence or --quality-run and --packaged-app-run.'
		);
	}
	if (options.writeRecord && !options.workflowUrl) {
		throw new Error('--write-record requires --workflow-url.');
	}
	if (
		options.writeRecord &&
		options.candidateWorkflowUrl &&
		(!options.candidateArtifactsJson || !options.candidateMetadata)
	) {
		throw new Error(
			'--write-record with --candidate-workflow-url requires --candidate-artifacts-json and --candidate-metadata.'
		);
	}
	if (
		Boolean(options.candidateArtifactsJson) !==
		Boolean(options.candidateMetadata)
	) {
		throw new Error(
			'--candidate-artifacts-json and --candidate-metadata must be provided together.'
		);
	}

	options.root = resolve(options.root);
	for (const key of [
		'artifactManifest',
		'candidateArtifactsJson',
		'candidateMetadata',
		'checklistJson',
		'plan',
		'writeNotes',
		'writeRecord'
	]) {
		if (options[key] && !isAbsolute(options[key])) {
			options[key] = resolve(options.root, options[key]);
		}
	}

	return options;
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

function assert(condition, message) {
	if (!condition) {
		throw new Error(message);
	}
}

function requiredString(value, label) {
	assert(
		typeof value === 'string' && value.trim().length > 0,
		`${label} must be a non-empty string.`
	);
	return value.trim();
}

function exactKeys(value, allowed, label) {
	const unexpected = Object.keys(value).filter(key => !allowed.includes(key));

	assert(
		unexpected.length === 0,
		`${label} contains unexpected fields: ${unexpected.join(', ')}.`
	);
}

function parseSemver(version, label = 'version') {
	const match = semverPattern.exec(version);

	assert(match, `${label} must be valid SemVer, got "${version}".`);
	return {
		build: match[5],
		major: Number(match[1]),
		minor: Number(match[2]),
		patch: Number(match[3]),
		prerelease: match[4]
	};
}

function compareSemver(left, right) {
	for (const field of ['major', 'minor', 'patch']) {
		if (left[field] !== right[field]) {
			return left[field] < right[field] ? -1 : 1;
		}
	}

	if (left.prerelease === right.prerelease) {
		return 0;
	}
	if (!left.prerelease) {
		return 1;
	}
	if (!right.prerelease) {
		return -1;
	}

	const leftParts = left.prerelease.split('.');
	const rightParts = right.prerelease.split('.');
	for (
		let index = 0;
		index < Math.max(leftParts.length, rightParts.length);
		index += 1
	) {
		const leftPart = leftParts[index];
		const rightPart = rightParts[index];

		if (leftPart === undefined) {
			return -1;
		}
		if (rightPart === undefined) {
			return 1;
		}
		if (leftPart === rightPart) {
			continue;
		}

		const leftNumeric = /^\d+$/.test(leftPart);
		const rightNumeric = /^\d+$/.test(rightPart);
		if (leftNumeric && rightNumeric) {
			return Number(leftPart) < Number(rightPart) ? -1 : 1;
		}
		if (leftNumeric !== rightNumeric) {
			return leftNumeric ? -1 : 1;
		}
		return leftPart < rightPart ? -1 : 1;
	}

	return 0;
}

function assertHttpsUrl(value, label, predicate = () => true) {
	requiredString(value, label);
	let url;

	try {
		url = new URL(value);
	} catch {
		throw new Error(`${label} must be an absolute HTTPS URL.`);
	}

	assert(
		url.protocol === 'https:' && predicate(url),
		`${label} must be an approved HTTPS URL.`
	);
	return url;
}

function validatePlan(plan) {
	exactKeys(
		plan,
		[
			'$schema',
			'approvals',
			'channel',
			'checklistIssue',
			'compatibility',
			'firstRelease',
			'knownIssues',
			'previousKnownGoodVersion',
			'profile',
			'releaseDate',
			'releaseManager',
			'rollback',
			'schemaVersion',
			'tag',
			'version'
		],
		'release plan'
	);
	assert(plan.schemaVersion === 1, 'release plan schemaVersion must be 1.');
	const version = requiredString(plan.version, 'version');
	const parsedVersion = parseSemver(version);
	const tag = requiredString(plan.tag, 'tag');

	assert(
		plan.version === version,
		'version must not contain surrounding whitespace.'
	);
	assert(plan.tag === tag, 'tag must not contain surrounding whitespace.');
	assert(tag === `v${version}`, `tag must be exactly v${version}.`);
	assert(
		plan.channel === (parsedVersion.prerelease ? 'prerelease' : 'stable'),
		`channel must be ${
			parsedVersion.prerelease ? 'prerelease' : 'stable'
		} for ${version}.`
	);
	if (parsedVersion.prerelease) {
		assert(
			/^(?:beta|rc)\.(?:0|[1-9]\d*)$/.test(parsedVersion.prerelease),
			'Public prereleases must use beta.N or rc.N identifiers.'
		);
	}
	assert(
		plan.profile === profiles.unsigned || plan.profile === profiles.signed,
		'profile must be distributable-unsigned or signed.'
	);
	const parsedReleaseDate = new Date(`${plan.releaseDate}T00:00:00Z`);
	assert(
		/^\d{4}-\d{2}-\d{2}$/.test(plan.releaseDate) &&
			Number.isFinite(parsedReleaseDate.getTime()) &&
			parsedReleaseDate.toISOString().slice(0, 10) === plan.releaseDate,
		'releaseDate must be a valid YYYY-MM-DD date.'
	);

	const manager = requiredString(plan.releaseManager, 'releaseManager');
	assert(
		plan.releaseManager === manager,
		'The releaseManager handle must not contain surrounding whitespace.'
	);
	assert(
		/^@[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(manager),
		'releaseManager must be a GitHub @handle.'
	);
	assert(
		plan.approvals && typeof plan.approvals === 'object',
		'approvals is required.'
	);
	exactKeys(plan.approvals, ['releaseManager'], 'approvals');
	assert(
		plan.approvals.releaseManager === true,
		'releaseManager approval must be true.'
	);

	assertHttpsUrl(
		plan.checklistIssue,
		'checklistIssue',
		url =>
			url.hostname === 'github.com' &&
			/^\/twine-rs-labs\/twine\.rs\/issues\/\d+\/?$/.test(url.pathname)
	);

	assert(
		typeof plan.firstRelease === 'boolean',
		'firstRelease must be a boolean.'
	);
	if (plan.firstRelease) {
		assert(
			plan.previousKnownGoodVersion === null,
			'The first formal release must use null for previousKnownGoodVersion.'
		);
	} else {
		requiredString(plan.previousKnownGoodVersion, 'previousKnownGoodVersion');
		const previousVersion = parseSemver(
			plan.previousKnownGoodVersion,
			'previousKnownGoodVersion'
		);
		assert(
			compareSemver(previousVersion, parsedVersion) < 0,
			'previousKnownGoodVersion must precede version.'
		);
	}

	const compatibility = plan.compatibility;
	assert(
		compatibility && typeof compatibility === 'object',
		'compatibility is required.'
	);
	exactKeys(
		compatibility,
		[
			'backupRequired',
			'notes',
			'previousVersionCanOpenProjects',
			'projectFormat',
			'settingsMigration'
		],
		'compatibility'
	);
	assert(
		new Set(['unchanged', 'backward-compatible', 'breaking']).has(
			compatibility.projectFormat
		),
		'compatibility.projectFormat must be unchanged, backward-compatible, or breaking.'
	);
	assert(
		new Set(['none', 'reversible', 'irreversible']).has(
			compatibility.settingsMigration
		),
		'compatibility.settingsMigration must be none, reversible, or irreversible.'
	);
	assert(
		new Set(['yes', 'no', 'not-applicable']).has(
			compatibility.previousVersionCanOpenProjects
		),
		'compatibility.previousVersionCanOpenProjects must be yes, no, or not-applicable.'
	);
	assert(
		typeof compatibility.backupRequired === 'boolean',
		'compatibility.backupRequired must be a boolean.'
	);
	requiredString(compatibility.notes, 'compatibility.notes');

	if (plan.firstRelease) {
		assert(
			compatibility.previousVersionCanOpenProjects === 'not-applicable',
			'The first formal release must mark previous-version reopening not-applicable.'
		);
	} else {
		assert(
			compatibility.previousVersionCanOpenProjects !== 'not-applicable',
			'A release with a previous known-good version must state yes or no for reopening.'
		);
	}
	if (compatibility.projectFormat === 'breaking') {
		assert(
			compatibility.previousVersionCanOpenProjects === 'no',
			'A breaking project-format change must state that the previous version cannot reopen projects.'
		);
	}
	if (!plan.firstRelease && compatibility.projectFormat === 'unchanged') {
		assert(
			compatibility.previousVersionCanOpenProjects === 'yes',
			'An unchanged project format must remain readable by the previous version.'
		);
	}
	if (compatibility.settingsMigration === 'irreversible') {
		assert(
			compatibility.backupRequired,
			'An irreversible settings migration must require a backup.'
		);
	}
	if (compatibility.previousVersionCanOpenProjects === 'no') {
		assert(
			compatibility.backupRequired,
			'A release that prevents previous-version reopening must require a backup.'
		);
	}

	const previous = plan.previousKnownGoodVersion
		? parseSemver(plan.previousKnownGoodVersion, 'previousKnownGoodVersion')
		: undefined;
	if (
		plan.channel === 'stable' &&
		previous &&
		!previous.prerelease &&
		previous.major === parsedVersion.major &&
		previous.minor === parsedVersion.minor &&
		parsedVersion.patch > previous.patch
	) {
		assert(
			compatibility.projectFormat !== 'breaking',
			'A stable patch release must not intentionally break the project format.'
		);
	}

	const rollback = plan.rollback;
	assert(rollback && typeof rollback === 'object', 'rollback is required.');
	exactKeys(
		rollback,
		['application', 'evidence', 'projectData', 'tested'],
		'rollback'
	);
	requiredString(rollback.application, 'rollback.application');
	requiredString(rollback.projectData, 'rollback.projectData');
	assert(rollback.tested === true, 'rollback.tested must be true.');
	assertHttpsUrl(rollback.evidence, 'rollback.evidence');

	assert(Array.isArray(plan.knownIssues), 'knownIssues must be an array.');
	for (const [index, issue] of plan.knownIssues.entries()) {
		requiredString(issue, `knownIssues[${index}]`);
	}

	return {parsedVersion, version};
}

function workspaceVersions(root) {
	const packageJson = readJson(join(root, 'package.json'), 'package.json');
	const packageLock = readJson(
		join(root, 'package-lock.json'),
		'package-lock.json'
	);
	const cargoToml = readFileSync(join(root, 'Cargo.toml'), 'utf8');
	const cargoVersion = cargoToml.match(
		/\[workspace\.package\][\s\S]*?\nversion = "([^"]+)"/
	)?.[1];
	const cargoLock = readFileSync(join(root, 'Cargo.lock'), 'utf8');
	const cargoLockVersions = new Map();

	for (const block of cargoLock.split('[[package]]')) {
		const name = block.match(/\n?name = "([^"]+)"/)?.[1];
		const version = block.match(/\nversion = "([^"]+)"/)?.[1];

		if (name && version && workspaceCrateNames.includes(name)) {
			cargoLockVersions.set(name, version);
		}
	}

	return {
		cargoLockVersions,
		cargoVersion,
		packageJson,
		packageLock
	};
}

function validateWorkspaceVersion(root, version) {
	const versions = workspaceVersions(root);

	assert(
		versions.packageJson.version === version,
		`package.json version ${versions.packageJson.version} does not match ${version}.`
	);
	assert(
		versions.packageLock.version === version,
		`package-lock.json version ${versions.packageLock.version} does not match ${version}.`
	);
	assert(
		versions.packageLock.packages?.['']?.version === version,
		`package-lock.json root package version does not match ${version}.`
	);
	assert(
		versions.cargoVersion === version,
		`Cargo workspace version ${versions.cargoVersion} does not match ${version}.`
	);
	for (const crateName of workspaceCrateNames) {
		assert(
			versions.cargoLockVersions.get(crateName) === version,
			`Cargo.lock ${crateName} version does not match ${version}.`
		);
	}
}

function changelogEntry(root, plan) {
	const changelog = readFileSync(join(root, 'CHANGELOG.md'), 'utf8');
	const heading = `## [${plan.version}] - ${plan.releaseDate}`;
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex(line => line.trim() === heading);

	assert(
		start !== -1,
		`CHANGELOG.md must contain the exact heading "${heading}".`
	);
	let end = lines.length;
	for (let index = start + 1; index < lines.length; index += 1) {
		if (lines[index].startsWith('## ')) {
			end = index;
			break;
		}
	}
	const bodyLines = lines.slice(start + 1, end);

	while (
		bodyLines.length > 0 &&
		(bodyLines.at(-1).trim().length === 0 ||
			/^\[[^\]]+\]:\s+\S+/.test(bodyLines.at(-1)))
	) {
		bodyLines.pop();
	}
	const body = bodyLines.join('\n').trim();

	assert(body.length > 0, `${heading} must contain release notes.`);
	assert(!/\b(?:TBD|TODO)\b/i.test(body), `${heading} contains a placeholder.`);
	return body;
}

function git(root, args) {
	return execFileSync('git', ['-C', root, ...args], {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	}).trim();
}

function resolveCommit(root, commit) {
	const value = commit ?? git(root, ['rev-parse', 'HEAD']);

	assert(
		/^[0-9a-f]{40}$/i.test(value),
		`commit must be an exact 40-character Git commit, got "${value}".`
	);
	return value.toLocaleLowerCase();
}

function validateTag(root, tag, commit) {
	let type;
	let target;

	try {
		type = git(root, ['cat-file', '-t', `refs/tags/${tag}`]);
		target = git(root, ['rev-list', '-n', '1', `refs/tags/${tag}`]);
	} catch {
		throw new Error(`Annotated tag ${tag} does not exist locally.`);
	}
	assert(type === 'tag', `${tag} must be an annotated Git tag.`);
	assert(
		target.toLocaleLowerCase() === commit,
		`${tag} points to ${target}, expected ${commit}.`
	);
	assert(
		git(root, ['status', '--porcelain']).length === 0,
		'The release checkout must be clean.'
	);
}

function validateChecklist(plan, checklist, phase) {
	assert(
		checklist && typeof checklist === 'object',
		'checklist JSON must be an object.'
	);
	assert(
		checklist.url === plan.checklistIssue,
		'The fetched checklist URL does not match the release plan.'
	);
	const body = requiredString(checklist.body, 'checklist body');
	const marker = /^## Post-publication\r?$/m.exec(body);

	assert(
		marker,
		'The checklist issue is missing the Post-publication section.'
	);
	const prePublication = body.slice(0, marker.index);
	const preBoxes = [...prePublication.matchAll(/^- \[([ xX])\] /gm)];

	assert(
		preBoxes.length >= 20,
		'The checklist issue does not contain the complete pre-publication checklist.'
	);
	assert(
		preBoxes.every(match => match[1].toLocaleLowerCase() === 'x'),
		'Every checklist item before Post-publication must be checked before publication.'
	);

	if (phase === 'publish') {
		assert(
			checklist.state === 'OPEN',
			'The release checklist must remain open through post-publication verification.'
		);
	}
	if (phase === 'closeout') {
		const allBoxes = [...body.matchAll(/^- \[([ xX])\] /gm)];
		assert(
			allBoxes.length > preBoxes.length &&
				allBoxes.every(match => match[1].toLocaleLowerCase() === 'x'),
			'Every post-publication checklist item must be checked at closeout.'
		);
		assert(
			checklist.state === 'CLOSED',
			'The completed release checklist issue must be closed.'
		);
	}

	return {
		postPublicationComplete: phase === 'closeout',
		prePublicationComplete: true,
		state: checklist.state,
		url: checklist.url
	};
}

function sha256(path) {
	return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function validateArtifactManifest(path, plan, commit) {
	const manifest = readJson(path, 'artifact manifest');
	const expectedNames = requiredArtifactMatrix(plan.version, plan.profile)
		.map(distributionArtifactPath)
		.sort();
	const names = Array.isArray(manifest.artifacts)
		? manifest.artifacts.map(artifact => artifact.fileName).sort()
		: [];
	const expectedTargetManifests = [
		['win', 'x64'],
		['mac', 'x64'],
		['mac', 'arm64'],
		['linux', 'x64'],
		['linux', 'arm64']
	]
		.map(
			([platform, arch]) =>
				`provenance/${targetManifestName(plan.version, platform, arch)}`
		)
		.sort();
	const targetManifests = Array.isArray(manifest.targetManifests)
		? [...manifest.targetManifests].sort()
		: [];

	assert(
		manifest.schemaVersion === 1,
		'artifact manifest schemaVersion must be 1.'
	);
	assert(
		manifest.applicationVersion === plan.version,
		'artifact manifest applicationVersion does not match the plan.'
	);
	assert(
		manifest.profile === plan.profile,
		'artifact manifest profile does not match the plan.'
	);
	assert(
		manifest.sourceCommit?.toLocaleLowerCase() === commit,
		'artifact manifest sourceCommit does not match the release commit.'
	);
	assert(
		manifest.sourceTree === 'clean',
		'artifact manifest must record a clean source tree.'
	);
	assert(
		names.length === expectedNames.length &&
			expectedNames.every((name, index) => name === names[index]),
		'artifact manifest does not contain the exact supported artifact matrix.'
	);
	assert(
		targetManifests.length === expectedTargetManifests.length &&
			expectedTargetManifests.every(
				(fileName, index) => fileName === targetManifests[index]
			),
		'artifact manifest must retain the exact five target manifests.'
	);
	for (const artifact of manifest.artifacts) {
		assert(
			/^[0-9a-f]{64}$/.test(artifact.sha256) &&
				Number.isSafeInteger(artifact.size) &&
				artifact.size >= 0,
			`Artifact provenance is incomplete for ${artifact.fileName}.`
		);
	}

	return {
		...manifest,
		fileName: 'artifact-manifest.json',
		rootDirectory: dirname(path),
		sha256: sha256(path),
		size: statSync(path).size
	};
}

function retainedEvidence(rootDirectory) {
	return retainedEvidencePaths.map(fileName => {
		const path = join(rootDirectory, fileName);
		let size;

		try {
			size = statSync(path).size;
		} catch {
			throw new Error(`Retained release evidence is missing ${fileName}.`);
		}

		return {
			fileName,
			sha256: sha256(path),
			size
		};
	});
}

function retainedTargetManifests(artifactManifest) {
	return artifactManifest.targetManifests.map(fileName => {
		const path = join(artifactManifest.rootDirectory, fileName);
		let size;

		try {
			size = statSync(path).size;
		} catch {
			throw new Error(`Retained target provenance is missing ${fileName}.`);
		}

		return {
			fileName,
			sha256: sha256(path),
			size
		};
	});
}

function retainedCandidateProvenance(artifactsPath, metadataPath, commit) {
	const artifacts = readJson(artifactsPath, 'candidate artifacts response');
	const metadata = readJson(metadataPath, 'candidate metadata');
	assert(
		metadata.schemaVersion === 2 &&
			metadata.repository === 'twine-rs-labs/twine.rs' &&
			metadata.sourceCommit === commit,
		'Retained candidate metadata identity is invalid.'
	);
	assert(
		/^[1-9][0-9]*$/.test(String(metadata.workflowRunId)) &&
			metadata.workflowUrl ===
				`https://github.com/twine-rs-labs/twine.rs/actions/runs/${metadata.workflowRunId}`,
		'Retained candidate workflow URL is not bound to its run ID.'
	);
	const ciEvidence = validateCandidateCiEvidence(metadata.ciEvidence, {
		repository: metadata.repository,
		sourceCommit: commit
	});
	assert(
		typeof metadata.artifactName === 'string' &&
			metadata.artifactName.startsWith('desktop-pretag-'),
		'Candidate metadata artifactName is invalid.'
	);
	const matches = (artifacts.artifacts ?? []).filter(
		artifact => artifact.name === metadata.artifactName
	);

	assert(
		matches.length === 1,
		'Candidate artifacts response must contain exactly one metadata-bound pre-tag unit.'
	);
	const [artifact] = matches;
	assert(
		Number.isSafeInteger(artifact.id) && artifact.id > 0,
		'Candidate artifact ID is invalid.'
	);
	assert(
		typeof artifact.digest === 'string' &&
			/^sha256:[0-9a-f]{64}$/i.test(artifact.digest),
		'Candidate artifact digest is invalid.'
	);
	assert(
		Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0,
		'Candidate artifact size is invalid.'
	);

	return {
		artifact: {
			digest: artifact.digest.toLowerCase(),
			id: artifact.id,
			name: artifact.name,
			size: artifact.size_in_bytes
		},
		metadata: {
			fileName: basename(metadataPath),
			sha256: sha256(metadataPath),
			size: statSync(metadataPath).size
		},
		candidateWorkflowUrl: metadata.workflowUrl,
		ciEvidence
	};
}

function profileDescription(profile) {
	return profile === profiles.signed
		? 'Signed: Authenticode on Windows, Developer ID plus notarization on macOS, and native-platform signing recorded as not applicable on Linux.'
		: 'Deliberately unsigned: Windows has no verified publisher; macOS is ad-hoc signed and unnotarized. Verify checksums, while recognizing that checksums alone do not authenticate the publisher.';
}

function list(items, empty = 'None declared.') {
	return items.length > 0
		? items.map(item => `- ${item}`).join('\n')
		: `- ${empty}`;
}

function releaseNotes(plan, commit, changelog) {
	const previous = plan.previousKnownGoodVersion
		? `Twine RS ${plan.previousKnownGoodVersion}`
		: 'None — this is the first formal Twine RS release';

	return `**Status:** ${plan.channel === 'stable' ? 'Stable' : 'Prerelease'}
**Artifact profile:** \`${plan.profile}\`
**Source:** \`${plan.tag}\` at \`${commit}\`
**Release checklist:** ${plan.checklistIssue}

${profileDescription(plan.profile)}

## Changes

${changelog}

## Supported downloads

${list(expectedTargets)}

## Compatibility and migrations

- Project format: ${plan.compatibility.projectFormat}
- Settings migration: ${plan.compatibility.settingsMigration}
- Previous version can reopen saved projects: ${plan.compatibility.previousVersionCanOpenProjects}
- Pre-migration backup required: ${plan.compatibility.backupRequired ? 'yes' : 'no'}
- ${plan.compatibility.notes}

## Known issues

${list(plan.knownIssues)}

## Rollback and recovery

- Previous known-good release: ${previous}
- Application rollback: ${plan.rollback.application}
- Project-data rollback: ${plan.rollback.projectData}
- Recovery test evidence: ${plan.rollback.evidence}

## Support

The latest stable release is supported; prereleases receive best-effort support. See [SUPPORT.md](https://github.com/twine-rs-labs/twine.rs/blob/${plan.tag}/SUPPORT.md).

## Integrity and provenance

Download \`SHA256SUMS.txt\`, \`artifact-manifest.json\`, \`release-candidate.json\`, \`release-record.json\`, and the per-target manifests to inspect the hashes, exact source commit, promoted candidate, build profile, and observed signing state. Standalone license, notice, SBOM, and Chromium-license files accompany them. The complete evidence set is also retained in the release-evidence ZIP.
`;
}

function releaseRecord({
	artifactManifest,
	candidateProvenance,
	candidateWorkflowUrl,
	checklist,
	commit,
	packagedAppRun,
	plan,
	qualityRun,
	workflowUrl
}) {
	const boundCiEvidence = candidateProvenance?.ciEvidence;
	if (boundCiEvidence) {
		for (const [label, supplied, retained] of [
			[
				'candidate workflow',
				candidateWorkflowUrl,
				candidateProvenance.candidateWorkflowUrl
			],
			['quality run', qualityRun, boundCiEvidence.quality.url],
			['packaged-app run', packagedAppRun, boundCiEvidence.packagedElectron.url]
		]) {
			assert(
				!supplied || supplied === retained,
				`Supplied ${label} does not match retained candidate metadata.`
			);
		}
	}
	const validation = {
		qualityRun: boundCiEvidence?.quality.url ?? qualityRun,
		packagedAppRun: boundCiEvidence?.packagedElectron.url ?? packagedAppRun,
		recoveryTest: plan.rollback.evidence,
		releaseWorkflow: workflowUrl
	};
	if (candidateProvenance?.candidateWorkflowUrl ?? candidateWorkflowUrl) {
		validation.candidateWorkflow =
			candidateProvenance?.candidateWorkflowUrl ?? candidateWorkflowUrl;
	}

	const provenance = {
		artifactManifest: {
			fileName: artifactManifest.fileName,
			sha256: artifactManifest.sha256,
			size: artifactManifest.size
		},
		artifactCount: artifactManifest.artifacts.length,
		targetManifests: retainedTargetManifests(artifactManifest),
		evidenceFiles: retainedEvidence(artifactManifest.rootDirectory),
		artifacts: artifactManifest.artifacts.map(artifact => ({
			fileName: artifact.fileName,
			sha256: artifact.sha256,
			size: artifact.size
		}))
	};
	if (candidateProvenance) {
		provenance.candidateArtifact = candidateProvenance.artifact;
		provenance.candidateMetadata = candidateProvenance.metadata;
		provenance.candidateCiEvidence = candidateProvenance.ciEvidence;
	}

	return {
		schemaVersion: 1,
		generatedAt: new Date().toISOString(),
		version: plan.version,
		tag: plan.tag,
		channel: plan.channel,
		profile: plan.profile,
		sourceCommit: commit,
		releaseDate: plan.releaseDate,
		releaseManager: plan.releaseManager,
		approvals: plan.approvals,
		previousKnownGoodVersion: plan.previousKnownGoodVersion,
		compatibility: plan.compatibility,
		rollback: plan.rollback,
		knownIssues: plan.knownIssues,
		supportedTargets: expectedTargets,
		validation,
		checklist,
		provenance
	};
}

function writeText(path, contents) {
	mkdirSync(dirname(path), {recursive: true});
	writeFileSync(path, contents);
}

export function runReleaseCheck(options) {
	const plan = readJson(options.plan, 'release plan');
	const {version} = validatePlan(plan);
	const tag = options.tag ?? plan.tag;

	assert(tag === plan.tag, `requested tag ${tag} does not match ${plan.tag}.`);
	validateWorkspaceVersion(options.root, version);
	const changelog = changelogEntry(options.root, plan);
	const commit = resolveCommit(options.root, options.commit);
	for (const [label, value] of [
		['candidateWorkflow', options.candidateWorkflowUrl],
		['qualityRun', options.qualityRun],
		['packagedAppRun', options.packagedAppRun],
		['releaseWorkflow', options.workflowUrl]
	]) {
		if (value) {
			assertHttpsUrl(
				value,
				label,
				url =>
					url.hostname === 'github.com' &&
					/^\/twine-rs-labs\/twine\.rs\/actions\/runs\/\d+\/?$/.test(
						url.pathname
					)
			);
		}
	}

	if (options.checkTag) {
		validateTag(options.root, tag, commit);
	}

	const checklist = options.checklistJson
		? validateChecklist(
				plan,
				readJson(options.checklistJson, 'checklist JSON'),
				options.phase
			)
		: undefined;
	const artifactManifest = options.artifactManifest
		? validateArtifactManifest(options.artifactManifest, plan, commit)
		: undefined;
	const candidateProvenance = options.candidateArtifactsJson
		? retainedCandidateProvenance(
				options.candidateArtifactsJson,
				options.candidateMetadata,
				commit
			)
		: undefined;

	if (options.writeNotes) {
		writeText(options.writeNotes, releaseNotes(plan, commit, changelog));
	}
	if (options.writeRecord) {
		writeText(
			options.writeRecord,
			`${JSON.stringify(
				releaseRecord({
					artifactManifest,
					candidateProvenance,
					candidateWorkflowUrl: options.candidateWorkflowUrl,
					checklist,
					commit,
					packagedAppRun: options.packagedAppRun,
					plan,
					qualityRun: options.qualityRun,
					workflowUrl: options.workflowUrl
				}),
				null,
				2
			)}\n`
		);
	}

	return {
		channel: plan.channel,
		commit,
		plan,
		profile: plan.profile,
		tag,
		version
	};
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	try {
		const result = runReleaseCheck(parseArgs(process.argv.slice(2)));

		console.log(
			`release-check: ${result.tag} is valid for ${result.profile} (${result.commit})`
		);
	} catch (error) {
		console.error(
			`release-check: ${error instanceof Error ? error.message : error}`
		);
		process.exitCode = 1;
	}
}
