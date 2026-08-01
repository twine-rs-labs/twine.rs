#!/usr/bin/env node
import {createHash} from 'node:crypto';
import {
	copyFileSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import {createRequire} from 'node:module';
import {basename, dirname, join, resolve, sep} from 'node:path';

const require = createRequire(import.meta.url);
const {
	distributionArtifactPath,
	isDistributionProfile,
	isUpdaterMetadata,
	localArtifactNotice,
	localArtifactNoticeName,
	profiles,
	requiredArtifactMatrix,
	targetManifestName,
	validProfiles
} = require('./release-profile.cjs');
const {manifestSchemaVersion} = require('./artifact-profile-hooks.cjs');

const guideName = 'WHICH TO DOWNLOAD.md';
const checksumsName = 'SHA256SUMS.txt';
const aggregateManifestName = 'artifact-manifest.json';
const localNoticeName = 'LOCAL-TEST-BUNDLE.txt';
const baseArtifactFields = [
	'fileName',
	'sha256',
	'size',
	'notarization',
	'signing',
	'signingScope',
	'stapling'
];

function parseArgs(args) {
	const options = {
		localTestBundle: false,
		output: undefined,
		profile: undefined,
		source: undefined
	};

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];

		if (arg === '--local-test-bundle') {
			options.localTestBundle = true;
			continue;
		}

		if (arg === '--profile' || arg === '--source' || arg === '--output') {
			const value = args[++index];

			if (!value) {
				throw new Error(`${arg} requires a value.`);
			}
			options[arg.slice(2)] = value;
			continue;
		}

		throw new Error(`Unknown argument "${arg}".`);
	}

	if (!validProfiles.has(options.profile)) {
		throw new Error(
			`--profile must explicitly name ${[...validProfiles].join(', ')}.`
		);
	}

	if (options.profile === profiles.local && !options.localTestBundle) {
		throw new Error(
			'Distribution assembly rejects the local profile. Use --local-test-bundle only for CI test retention.'
		);
	}

	if (options.profile !== profiles.local && options.localTestBundle) {
		throw new Error('--local-test-bundle accepts only the local profile.');
	}

	if (
		options.profile === profiles.unsigned &&
		process.env.ALLOW_UNSIGNED_DISTRIBUTION !== '1'
	) {
		throw new Error(
			'distributable-unsigned assembly requires ALLOW_UNSIGNED_DISTRIBUTION=1.'
		);
	}

	if (options.profile === profiles.signed) {
		const expectedIdentityKeys = [
			'APPLE_APP_ID',
			'APPLE_TEAM_ID',
			'CSC_NAME',
			'WINDOWS_SIGNER_SUBJECT',
			'WINDOWS_SIGNER_SHA1'
		];
		const missing = expectedIdentityKeys.filter(
			key =>
				typeof process.env[key] !== 'string' ||
				process.env[key].trim().length === 0
		);

		if (missing.length > 0) {
			throw new Error(
				`signed assembly is missing expected identity configuration: ${missing.join(
					', '
				)}.`
			);
		}

		if (!/^[0-9a-f]{40}$/i.test(process.env.WINDOWS_SIGNER_SHA1.trim())) {
			throw new Error(
				'WINDOWS_SIGNER_SHA1 must be the expected 40-character certificate thumbprint.'
			);
		}
	}

	const defaultSource = join(
		process.cwd(),
		'artifacts',
		'incoming',
		options.profile
	);
	const defaultOutput = options.localTestBundle
		? join(process.cwd(), 'artifacts', 'local-test-bundle')
		: join(process.cwd(), 'artifacts', options.profile);
	const source = resolve(options.source || defaultSource);
	const output = resolve(options.output || defaultOutput);
	const projectRoot = resolve(process.cwd());

	if (
		source === output ||
		source.startsWith(`${output}${sep}`) ||
		output.startsWith(`${source}${sep}`)
	) {
		throw new Error('Artifact source and output directories must not overlap.');
	}

	if (output === projectRoot || output === dirname(output)) {
		throw new Error(
			'Artifact output must not be the project or filesystem root.'
		);
	}

	return {
		...options,
		output,
		source
	};
}

function packageVersion() {
	const pkg = JSON.parse(
		readFileSync(join(process.cwd(), 'package.json'), 'utf8')
	);

	if (typeof pkg.version !== 'string') {
		throw new Error('package.json does not contain a release version.');
	}

	return pkg.version;
}

function safeFiles(directory) {
	try {
		return readdirSync(directory)
			.filter(name => statSync(join(directory, name)).isFile())
			.sort();
	} catch {
		throw new Error(`No artifact input directory exists at ${directory}.`);
	}
}

function sha256(filePath) {
	return createHash('sha256').update(readFileSync(filePath)).digest('hex');
}

function profileInspectionFields(profile, platform) {
	if (platform === 'linux') {
		return [];
	}

	if (platform === 'mac') {
		return profile === profiles.signed
			? ['authority', 'identifier', 'signerTeamId']
			: ['identifier'];
	}

	return profile === profiles.signed
		? ['signerSubject', 'signerThumbprint', 'timestamped']
		: [];
}

function validateInspection(profile, platform, artifact, env) {
	const allowed = new Set([
		...baseArtifactFields,
		...profileInspectionFields(profile, platform)
	]);
	const missing = baseArtifactFields.filter(
		field => !Object.hasOwn(artifact, field)
	);
	const unexpected = Object.keys(artifact).filter(field => !allowed.has(field));

	if (missing.length > 0 || unexpected.length > 0) {
		throw new Error(
			`${artifact.fileName ?? `${platform} artifact`} has an invalid inspection schema: ${[
				...missing.map(field => `missing ${field}`),
				...unexpected.map(field => `unexpected ${field}`)
			].join(', ')}.`
		);
	}

	if (platform === 'linux') {
		if (
			artifact.signing !== 'not-applicable' ||
			artifact.signingScope !== 'not-applicable' ||
			artifact.notarization !== 'not-applicable' ||
			artifact.stapling !== 'not-applicable'
		) {
			throw new Error(
				`${artifact.fileName} must record Linux native-platform signing, scope, notarization, and stapling as not-applicable.`
			);
		}
		return;
	}

	if (profile === profiles.local) {
		const validLocalState =
			platform === 'win'
				? artifact.signing === 'unsigned' &&
					artifact.signingScope === 'installer' &&
					artifact.notarization === 'not-applicable' &&
					artifact.stapling === 'not-applicable'
				: artifact.signing === 'ad-hoc' &&
					artifact.signingScope === 'app-inside-dmg' &&
					artifact.notarization === 'not-notarized' &&
					artifact.stapling === 'not-stapled';

		if (!validLocalState) {
			throw new Error(
				`${artifact.fileName} does not record the required local-only trust state.`
			);
		}
		return;
	}

	if (
		platform === 'win' &&
		(artifact.signingScope !== 'installer' ||
			artifact.notarization !== 'not-applicable' ||
			artifact.stapling !== 'not-applicable')
	) {
		throw new Error(
			`${artifact.fileName} must record installer signing scope with notarization and stapling as not-applicable.`
		);
	}

	if (platform === 'mac' && artifact.signingScope !== 'app-inside-dmg') {
		throw new Error(
			`${artifact.fileName} must record signing scope as app-inside-dmg.`
		);
	}

	if (profile === profiles.unsigned) {
		const signing = platform === 'mac' ? 'ad-hoc' : 'unsigned';

		if (artifact.signing !== signing) {
			throw new Error(
				`${artifact.fileName} must record signing as ${signing}.`
			);
		}

		if (
			platform === 'mac' &&
			(artifact.notarization !== 'not-notarized' ||
				artifact.stapling !== 'not-stapled')
		) {
			throw new Error(
				`${artifact.fileName} must be unnotarized and unstapled.`
			);
		}
		return;
	}

	if (
		platform === 'win' &&
		(artifact.signing !== 'authenticode' || artifact.timestamped !== true)
	) {
		throw new Error(
			`${artifact.fileName} must record valid timestamped Authenticode signing.`
		);
	}

	if (
		platform === 'win' &&
		(artifact.signerSubject !== env.WINDOWS_SIGNER_SUBJECT ||
			artifact.signerThumbprint?.toUpperCase() !==
				env.WINDOWS_SIGNER_SHA1.trim().toUpperCase())
	) {
		throw new Error(
			`${artifact.fileName} does not match the expected Windows signing identity.`
		);
	}

	if (
		platform === 'mac' &&
		(artifact.signing !== 'developer-id' ||
			artifact.notarization !== 'notarized' ||
			artifact.stapling !== 'stapled')
	) {
		throw new Error(
			`${artifact.fileName} must record Developer ID signing, notarization, and stapling.`
		);
	}

	if (
		platform === 'mac' &&
		(artifact.authority !== env.CSC_NAME ||
			artifact.identifier !== env.APPLE_APP_ID ||
			artifact.signerTeamId !== env.APPLE_TEAM_ID)
	) {
		throw new Error(
			`${artifact.fileName} does not match the expected macOS signing identity.`
		);
	}
}

function targetRequirements(version, profile) {
	return [
		{arch: 'x64', platform: 'win'},
		{arch: 'x64', platform: 'mac'},
		{arch: 'arm64', platform: 'mac'},
		{arch: 'x64', platform: 'linux'},
		{arch: 'arm64', platform: 'linux'}
	].map(target => ({
		...target,
		manifestName: targetManifestName(version, target.platform, target.arch),
		artifacts: requiredArtifactMatrix(version, profile)
			.filter(
				artifact =>
					artifact.platform === target.platform && artifact.arch === target.arch
			)
			.map(artifact => artifact.fileName)
	}));
}

function validateInputs({profile, source}, version) {
	const requirements = requiredArtifactMatrix(version, profile);
	const targetManifests = targetRequirements(version, profile);
	const expectedArtifacts = new Set(
		requirements.map(requirement => requirement.fileName)
	);
	const expectedManifests = new Set(
		targetManifests.map(target => target.manifestName)
	);
	const expectedInputs = new Set([
		...expectedArtifacts,
		...expectedManifests,
		...(profile === profiles.local ? [localArtifactNoticeName] : [])
	]);
	const files = safeFiles(source);
	const unexpected = files.filter(name => !expectedInputs.has(name));
	const missing = [...expectedInputs].filter(name => !files.includes(name));

	if (files.some(isUpdaterMetadata)) {
		throw new Error('Updater metadata is forbidden in every artifact profile.');
	}

	if (missing.length > 0 || unexpected.length > 0) {
		const problems = [
			...missing.map(name => `missing ${name}`),
			...unexpected.map(name => `unexpected input ${name}`)
		];

		throw new Error(
			`required desktop artifact matrix is incomplete:\n- ${problems.join(
				'\n- '
			)}`
		);
	}

	if (
		profile === profiles.local &&
		readFileSync(join(source, localArtifactNoticeName), 'utf8') !==
			localArtifactNotice
	) {
		throw new Error(
			'The local artifact transfer notice is missing or invalid.'
		);
	}

	const manifests = [];
	let sourceCommit;
	let sourceTree;

	for (const target of targetManifests) {
		const manifestPath = join(source, target.manifestName);
		let manifest;

		try {
			manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
		} catch {
			throw new Error(`Invalid JSON in ${target.manifestName}.`);
		}

		if (
			manifest.schemaVersion !== manifestSchemaVersion ||
			manifest.profile !== profile ||
			manifest.applicationVersion !== version ||
			manifest.platform !== target.platform ||
			manifest.architecture !== target.arch ||
			!Array.isArray(manifest.artifacts)
		) {
			throw new Error(
				`${target.manifestName} does not match the requested profile, version, or target.`
			);
		}

		if (
			typeof manifest.buildDate !== 'string' ||
			!Number.isFinite(Date.parse(manifest.buildDate))
		) {
			throw new Error(
				`${target.manifestName} does not record a valid build date.`
			);
		}

		if (isDistributionProfile(profile) && manifest.sourceTree !== 'clean') {
			throw new Error(
				`${target.manifestName} does not record a clean source tree.`
			);
		}

		if (!/^[0-9a-f]{40}$/i.test(manifest.sourceCommit)) {
			throw new Error(
				`${target.manifestName} does not record an exact source commit.`
			);
		}

		sourceCommit ??= manifest.sourceCommit;
		if (manifest.sourceCommit !== sourceCommit) {
			throw new Error('Target manifests do not share one source commit.');
		}
		sourceTree ??= manifest.sourceTree;
		if (manifest.sourceTree !== sourceTree) {
			throw new Error('Target manifests do not share one source tree state.');
		}

		const manifestNames = manifest.artifacts
			.map(artifact => artifact.fileName)
			.sort();
		const expectedNames = [...target.artifacts].sort();

		if (
			manifestNames.length !== expectedNames.length ||
			expectedNames.some((name, index) => name !== manifestNames[index])
		) {
			throw new Error(
				`${target.manifestName} does not declare the exact target artifacts.`
			);
		}

		for (const artifact of manifest.artifacts) {
			const artifactPath = join(source, artifact.fileName);

			if (
				!Number.isSafeInteger(artifact.size) ||
				artifact.size < 0 ||
				!/^[0-9a-f]{64}$/.test(artifact.sha256) ||
				artifact.sha256 !== sha256(artifactPath) ||
				artifact.size !== statSync(artifactPath).size
			) {
				throw new Error(
					`${target.manifestName} does not match ${artifact.fileName}.`
				);
			}

			validateInspection(profile, target.platform, artifact, process.env);
		}

		manifests.push({fileName: target.manifestName, manifest});
	}

	return {manifests, requirements, sourceCommit, sourceTree};
}

function destinationFor(requirement, root) {
	return join(root, ...distributionArtifactPath(requirement).split('/'));
}

function downloadPaths(requirements) {
	return requirements.map(distributionArtifactPath);
}

function preferredDownload(files, predicate) {
	return files.find(predicate) ?? files[0] ?? null;
}

function hasArchitecture(file, architecture) {
	const fileArchitectures =
		architecture === 'x64' ? ['x64', 'x86_64'] : [architecture];

	return fileArchitectures.some(fileArchitecture =>
		new RegExp(`-${fileArchitecture}(?:-unsigned)?\\.`).test(file)
	);
}

function downloadList(files, platform) {
	return files
		.map(file => `- \`${file}\`: ${downloadNote(file, platform)}`)
		.join('\n');
}

function downloadNote(file, platform) {
	const name = basename(file);
	const notes = [
		file.includes('/alternatives/')
			? 'alternative download'
			: 'recommended first download'
	];

	if (platform === 'windows') {
		notes.push('installer for 64-bit Windows');
	} else if (platform === 'mac') {
		notes.push(
			hasArchitecture(name, 'arm64')
				? 'Apple Silicon Mac build'
				: 'Intel Mac build'
		);
		notes.push('open the DMG and drag the app to Applications');
	} else {
		notes.push(
			hasArchitecture(name, 'arm64')
				? '64-bit ARM Linux'
				: '64-bit Intel/AMD Linux'
		);
		notes.push(
			name.endsWith('.AppImage')
				? 'mark executable if needed with `chmod +x`, then run it'
				: 'unzip first; use this if AppImage does not work'
		);
	}

	return `${notes.join('; ')}.`;
}

function releaseGuide(version, profile, requirements) {
	const downloads = downloadPaths(requirements);
	const windows = downloads.filter(file => file.startsWith('windows/'));
	const mac = downloads.filter(file => file.startsWith('mac/'));
	const linux = downloads.filter(file => file.startsWith('linux/'));
	const startHere = [
		`- Windows: \`${preferredDownload(windows, file => file.endsWith('.exe'))}\``,
		`- Mac (Apple Silicon): \`${preferredDownload(mac, file =>
			hasArchitecture(file, 'arm64')
		)}\``,
		`- Mac (Intel): \`${preferredDownload(mac, file =>
			hasArchitecture(file, 'x64')
		)}\``,
		`- Linux x64: \`${preferredDownload(
			linux,
			file => hasArchitecture(file, 'x64') && file.endsWith('.AppImage')
		)}\``,
		`- Linux ARM64: \`${preferredDownload(
			linux,
			file => hasArchitecture(file, 'arm64') && file.endsWith('.AppImage')
		)}\``
	].join('\n');
	const warning =
		profile === profiles.unsigned
			? `> **Unsigned distribution warning:** Windows will not show a verified publisher and SmartScreen may warn or block the installer. macOS will not recognize an Apple Developer ID publisher; these builds are ad-hoc signed, unnotarized, and may be blocked by Gatekeeper. Verify the SHA-256 checksum against \`${checksumsName}\` before running a download. A matching checksum confirms the downloaded bytes, not the identity of the publisher.\n\n`
			: `This bundle enforces trusted native-platform signing where applicable: Windows uses Authenticode and macOS uses Developer ID signing plus notarization. Linux native-platform signing is recorded as not-applicable. Signing claims remain specific to each artifact.\n\n`;

	return `# Which To Download

Twine RS ${version}

${warning}Most desktop users should use the file matching their operating system and CPU:

${startHere}

Use an \`alternatives/\` folder only when the primary package format is inconvenient.

## Windows

${downloadList(windows, 'windows')}

## Mac

${downloadList(mac, 'mac')}

## Linux

${downloadList(linux, 'linux')}

## Checksums and provenance

Use \`${checksumsName}\` to verify downloads. \`${aggregateManifestName}\` records the profile, source commit, and signing state bound to every artifact.
`;
}

function assemble(options, version, validation) {
	mkdirSync(dirname(options.output), {recursive: true});
	const temporaryOutput = mkdtempSync(
		join(dirname(options.output), '.twine-rs-artifact-assembly-')
	);

	try {
		const aggregateArtifacts = [];

		for (const requirement of validation.requirements) {
			const sourcePath = join(options.source, requirement.fileName);
			const destination = destinationFor(requirement, temporaryOutput);
			const targetManifest = validation.manifests.find(({manifest}) =>
				manifest.artifacts.some(
					artifact => artifact.fileName === requirement.fileName
				)
			)?.manifest;
			const sourceEntry = targetManifest?.artifacts.find(
				artifact => artifact.fileName === requirement.fileName
			);

			if (!targetManifest || !sourceEntry) {
				throw new Error(
					`Validated provenance is missing for ${requirement.fileName}.`
				);
			}
			const trustState = Object.fromEntries(
				[
					'notarization',
					'signing',
					'signingScope',
					'stapling',
					...profileInspectionFields(options.profile, targetManifest.platform)
				]
					.filter(field => Object.hasOwn(sourceEntry, field))
					.map(field => [field, sourceEntry[field]])
			);

			mkdirSync(dirname(destination), {recursive: true});
			copyFileSync(sourcePath, destination);
			aggregateArtifacts.push({
				fileName: destination
					.slice(temporaryOutput.length + 1)
					.replaceAll('\\', '/'),
				sha256: sha256(destination),
				size: statSync(destination).size,
				...trustState,
				platform: targetManifest.platform,
				architecture: targetManifest.architecture,
				buildDate: targetManifest.buildDate
			});
		}

		const provenanceDir = join(temporaryOutput, 'provenance');

		mkdirSync(provenanceDir, {recursive: true});
		for (const {fileName} of validation.manifests) {
			copyFileSync(
				join(options.source, fileName),
				join(provenanceDir, fileName)
			);
		}

		const checksumLines = aggregateArtifacts
			.sort((left, right) => left.fileName.localeCompare(right.fileName))
			.map(artifact => `${artifact.sha256}  ${artifact.fileName}`);

		writeFileSync(
			join(temporaryOutput, checksumsName),
			`${checksumLines.join('\n')}\n`
		);

		const aggregateManifest = {
			schemaVersion: manifestSchemaVersion,
			profile: options.profile,
			applicationVersion: version,
			sourceCommit: validation.sourceCommit,
			sourceTree: validation.sourceTree,
			buildDate: new Date().toISOString(),
			assembledAt: new Date().toISOString(),
			trustDefinition:
				options.profile === profiles.signed
					? 'trusted native-platform signing enforced where applicable; Windows and macOS signed; Linux not-applicable'
					: options.profile === profiles.unsigned
						? 'deliberately distributable without trusted Windows or macOS publisher signing'
						: 'local CI test artifacts; not distributable',
			artifacts: aggregateArtifacts,
			targetManifests: validation.manifests.map(
				({fileName}) => `provenance/${fileName}`
			)
		};

		writeFileSync(
			join(temporaryOutput, aggregateManifestName),
			`${JSON.stringify(aggregateManifest, null, 2)}\n`
		);

		if (options.localTestBundle) {
			writeFileSync(
				join(temporaryOutput, localNoticeName),
				[
					'Twine RS local CI test bundle',
					'',
					'This bundle uses the local artifact profile.',
					'It is retained only for install and runtime testing.',
					'It must not enter release assembly or be distributed to recipients.',
					''
				].join('\n')
			);
		} else {
			writeFileSync(
				join(temporaryOutput, guideName),
				releaseGuide(version, options.profile, validation.requirements)
			);
		}

		rmSync(options.output, {force: true, recursive: true});
		renameSync(temporaryOutput, options.output);
	} catch (error) {
		rmSync(temporaryOutput, {force: true, recursive: true});
		throw error;
	}
}

try {
	const options = parseArgs(process.argv.slice(2));
	const version = packageVersion();
	const validation = validateInputs(options, version);

	assemble(options, version, validation);
	console.log(
		options.localTestBundle
			? `organize-release: validated local test bundle at ${options.output}`
			: `organize-release: validated ${options.profile} distribution at ${options.output}`
	);
} catch (error) {
	console.error(`organize-release: ${error.message}`);
	process.exitCode = 1;
}
