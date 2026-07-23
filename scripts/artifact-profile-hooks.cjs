const {Buffer} = require('node:buffer');
const {createHash} = require('node:crypto');
const {execFileSync, spawnSync} = require('node:child_process');
const {
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync
} = require('node:fs');
const {tmpdir} = require('node:os');
const path = require('node:path');
const {
	expectedArtifacts,
	isDistributionProfile,
	isUpdaterMetadata,
	localArtifactNotice,
	localArtifactNoticeName,
	profiles,
	targetManifestName
} = require('./release-profile.cjs');

const manifestSchemaVersion = 1;

function commandOutput(file, args, dependencies) {
	const result = dependencies.spawnSync(file, args, {encoding: 'utf8'});

	return {
		ok: !result.error && result.status === 0,
		output: `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim()
	};
}

function hasEmbeddedWindowsSignature(artifactPath, dependencies) {
	let artifact;

	try {
		artifact = (dependencies.readFileSync ?? readFileSync)(artifactPath);
	} catch {
		return undefined;
	}

	if (
		!Buffer.isBuffer(artifact) ||
		artifact.length < 64 ||
		artifact[0] !== 0x4d ||
		artifact[1] !== 0x5a
	) {
		return undefined;
	}

	const peOffset = artifact.readUInt32LE(0x3c);

	if (
		peOffset > artifact.length - 24 ||
		artifact.readUInt32LE(peOffset) !== 0x00004550
	) {
		return undefined;
	}

	const optionalHeaderSize = artifact.readUInt16LE(peOffset + 20);
	const optionalHeaderOffset = peOffset + 24;

	if (
		optionalHeaderSize < 2 ||
		optionalHeaderOffset + optionalHeaderSize > artifact.length
	) {
		return undefined;
	}

	const optionalHeaderMagic = artifact.readUInt16LE(optionalHeaderOffset);
	const dataDirectoryOffset =
		optionalHeaderMagic === 0x10b
			? optionalHeaderOffset + 96
			: optionalHeaderMagic === 0x20b
				? optionalHeaderOffset + 112
				: undefined;

	if (
		dataDirectoryOffset === undefined ||
		dataDirectoryOffset + 40 > optionalHeaderOffset + optionalHeaderSize
	) {
		return undefined;
	}

	if (artifact.readUInt32LE(dataDirectoryOffset - 4) < 5) {
		return false;
	}

	const certificateTableOffset = artifact.readUInt32LE(
		dataDirectoryOffset + 32
	);
	const certificateTableSize = artifact.readUInt32LE(dataDirectoryOffset + 36);

	return certificateTableOffset !== 0 || certificateTableSize !== 0;
}

function inspectWindowsArtifact(artifactPath, dependencies) {
	if (hasEmbeddedWindowsSignature(artifactPath, dependencies) === false) {
		return {
			notarization: 'not-applicable',
			signing: 'unsigned',
			signingScope: 'installer',
			stapling: 'not-applicable'
		};
	}

	const script = [
		"$artifactPath = [Environment]::GetEnvironmentVariable('TWINE_ARTIFACT_PATH')",
		'$signature = Get-AuthenticodeSignature -LiteralPath $artifactPath',
		'[PSCustomObject]@{',
		'Status = [string]$signature.Status',
		'StatusMessage = [string]$signature.StatusMessage',
		'Subject = $signature.SignerCertificate.Subject',
		'Thumbprint = $signature.SignerCertificate.Thumbprint',
		'HasTimestamp = $null -ne $signature.TimeStamperCertificate',
		'} | ConvertTo-Json -Compress'
	].join('\n');
	const result = dependencies.spawnSync(
		'powershell.exe',
		['-NoProfile', '-NonInteractive', '-Command', script],
		{
			encoding: 'utf8',
			env: {...process.env, TWINE_ARTIFACT_PATH: artifactPath}
		}
	);

	if (result.error || result.status !== 0) {
		throw new Error(
			`Could not inspect Windows signature for ${artifactPath}: ${
				result.stderr || result.error?.message || 'unknown error'
			}`
		);
	}

	let signature;

	try {
		signature = JSON.parse(result.stdout);
	} catch {
		throw new Error(
			`Could not parse Windows signature inspection for ${artifactPath}.`
		);
	}

	if (signature.Status === 'NotSigned') {
		return {
			notarization: 'not-applicable',
			signing: 'unsigned',
			signingScope: 'installer',
			stapling: 'not-applicable'
		};
	}

	if (signature.Status !== 'Valid') {
		return {
			notarization: 'not-applicable',
			signing: 'invalid',
			signingScope: 'installer',
			signingStatus: signature.Status,
			signingStatusMessage: signature.StatusMessage,
			stapling: 'not-applicable'
		};
	}

	return {
		notarization: 'not-applicable',
		signerSubject: signature.Subject,
		signerThumbprint: signature.Thumbprint?.toUpperCase(),
		signing: 'authenticode',
		signingScope: 'installer',
		stapling: 'not-applicable',
		timestamped: signature.HasTimestamp === true
	};
}

function inspectMacArtifact(artifactPath, dependencies) {
	const mountRoot = dependencies.mkdtempSync(
		path.join(dependencies.tmpdir(), 'twine-rs-artifact-inspection-')
	);
	let attached = false;

	try {
		dependencies.execFileSync(
			'hdiutil',
			[
				'attach',
				artifactPath,
				'-nobrowse',
				'-readonly',
				'-mountpoint',
				mountRoot
			],
			{stdio: 'pipe'}
		);
		attached = true;

		const appPath = path.join(mountRoot, 'Twine RS.app');
		const verify = commandOutput(
			'/usr/bin/codesign',
			['--verify', '--deep', '--strict', appPath],
			dependencies
		);

		if (!verify.ok) {
			return {
				notarization: 'not-notarized',
				signing: 'unsigned',
				signingScope: 'app-inside-dmg',
				stapling: 'not-stapled'
			};
		}

		const display = commandOutput(
			'/usr/bin/codesign',
			['--display', '--verbose=4', appPath],
			dependencies
		);

		if (!display.ok) {
			throw new Error(
				`Could not inspect macOS signature details for ${artifactPath}.`
			);
		}

		const identifier = display.output.match(/^Identifier=(.+)$/im)?.[1]?.trim();
		const rawTeamIdentifier = display.output
			.match(/^TeamIdentifier=(.+)$/im)?.[1]
			?.trim();
		const teamIdentifier =
			rawTeamIdentifier && !/^not set$/i.test(rawTeamIdentifier)
				? rawTeamIdentifier
				: undefined;
		const authority = display.output.match(/^Authority=(.+)$/im)?.[1]?.trim();
		const signing = /^Signature=adhoc$/im.test(display.output)
			? 'ad-hoc'
			: /^Authority=Developer ID Application:/im.test(display.output)
				? 'developer-id'
				: 'other';
		const staple = commandOutput(
			'xcrun',
			['stapler', 'validate', appPath],
			dependencies
		);
		const assessment = commandOutput(
			'/usr/sbin/spctl',
			['--assess', '--type', 'execute', '--verbose=4', appPath],
			dependencies
		);

		return {
			authority,
			identifier,
			notarization:
				assessment.ok &&
				/source=Notarized Developer ID/i.test(assessment.output)
					? 'notarized'
					: 'not-notarized',
			signerTeamId: teamIdentifier,
			signing,
			signingScope: 'app-inside-dmg',
			stapling: staple.ok ? 'stapled' : 'not-stapled'
		};
	} finally {
		if (attached) {
			dependencies.execFileSync('hdiutil', ['detach', mountRoot], {
				stdio: 'pipe'
			});
		}
		dependencies.rmSync(mountRoot, {force: true, recursive: true});
	}
}

function inspectArtifact(artifactPath, platform, dependencies) {
	if (platform === 'linux') {
		return {
			notarization: 'not-applicable',
			signing: 'not-applicable',
			signingScope: 'not-applicable',
			stapling: 'not-applicable'
		};
	}

	if (platform === 'win') {
		return inspectWindowsArtifact(artifactPath, dependencies);
	}

	return inspectMacArtifact(artifactPath, dependencies);
}

function validateInspectionFields(platform, inspection) {
	const required = ['notarization', 'signing', 'signingScope', 'stapling'];
	const missing = required.filter(
		field => typeof inspection[field] !== 'string'
	);

	if (missing.length > 0) {
		throw new Error(
			`${platform} artifact inspection is missing ${missing.join(', ')}.`
		);
	}
}

function validateArtifactInspection(profile, platform, inspection, env) {
	validateInspectionFields(platform, inspection);

	if (platform === 'linux') {
		if (
			inspection.signing !== 'not-applicable' ||
			inspection.signingScope !== 'not-applicable' ||
			inspection.notarization !== 'not-applicable' ||
			inspection.stapling !== 'not-applicable'
		) {
			throw new Error(
				'Linux artifacts must record native-platform signing, scope, notarization, and stapling as not-applicable.'
			);
		}
		return;
	}

	if (profile === profiles.local) {
		if (
			(platform === 'win' &&
				[
					'signerSubject',
					'signerThumbprint',
					'signingStatus',
					'signingStatusMessage',
					'timestamped'
				].some(field => inspection[field] !== undefined)) ||
			(platform === 'mac' &&
				(inspection.authority !== undefined ||
					inspection.signerTeamId !== undefined))
		) {
			throw new Error(
				`${platform} local artifacts contain signing identity fields that are incompatible with the local profile${
					inspection.signingStatus
						? ` (Authenticode status ${inspection.signingStatus}${
								inspection.signingStatusMessage
									? `: ${inspection.signingStatusMessage}`
									: ''
							})`
						: ''
				}.`
			);
		}

		const validLocalState =
			platform === 'win'
				? inspection.signing === 'unsigned' &&
					inspection.signingScope === 'installer' &&
					inspection.notarization === 'not-applicable' &&
					inspection.stapling === 'not-applicable'
				: inspection.signing === 'ad-hoc' &&
					inspection.signingScope === 'app-inside-dmg' &&
					inspection.notarization === 'not-notarized' &&
					inspection.stapling === 'not-stapled';

		if (!validLocalState) {
			throw new Error(
				`${platform} local artifacts do not contain the required local-only trust state.`
			);
		}
		return;
	}

	if (
		platform === 'win' &&
		(inspection.signingScope !== 'installer' ||
			inspection.notarization !== 'not-applicable' ||
			inspection.stapling !== 'not-applicable')
	) {
		throw new Error(
			'Windows artifacts must record installer signing scope with notarization and stapling as not-applicable.'
		);
	}

	if (platform === 'mac' && inspection.signingScope !== 'app-inside-dmg') {
		throw new Error(
			'macOS artifacts must record signing scope as app-inside-dmg.'
		);
	}

	if (
		profile === profiles.unsigned &&
		((platform === 'win' &&
			[
				'signerSubject',
				'signerThumbprint',
				'signingStatus',
				'signingStatusMessage',
				'timestamped'
			].some(field => inspection[field] !== undefined)) ||
			(platform === 'mac' &&
				(inspection.authority !== undefined ||
					inspection.signerTeamId !== undefined)))
	) {
		throw new Error(
			`${platform} distributable-unsigned artifacts must not contain trusted signing identity fields.`
		);
	}

	if (profile === profiles.unsigned) {
		const expectedSigning = platform === 'mac' ? 'ad-hoc' : 'unsigned';

		if (inspection.signing !== expectedSigning) {
			throw new Error(
				`${platform} distributable-unsigned artifact must be ${expectedSigning}; found ${inspection.signing}.`
			);
		}

		if (
			platform === 'mac' &&
			(inspection.notarization !== 'not-notarized' ||
				inspection.stapling !== 'not-stapled')
		) {
			throw new Error(
				'distributable-unsigned macOS artifacts must be unnotarized and unstapled.'
			);
		}
		return;
	}

	if (platform === 'win') {
		if (inspection.signingStatus !== undefined) {
			throw new Error(
				'signed Windows artifacts must not record an invalid signing status.'
			);
		}

		if (inspection.signing !== 'authenticode') {
			throw new Error(
				`signed Windows artifact must have a valid Authenticode signature; found ${inspection.signing}.`
			);
		}

		if (inspection.signerSubject !== env.WINDOWS_SIGNER_SUBJECT) {
			throw new Error(
				`signed Windows artifact signer subject "${inspection.signerSubject}" does not match WINDOWS_SIGNER_SUBJECT.`
			);
		}

		if (
			inspection.signerThumbprint?.toUpperCase() !==
			env.WINDOWS_SIGNER_SHA1?.trim().toUpperCase()
		) {
			throw new Error(
				'signed Windows artifact certificate thumbprint does not match WINDOWS_SIGNER_SHA1.'
			);
		}

		if (inspection.timestamped !== true) {
			throw new Error('signed Windows artifact must contain a timestamp.');
		}
		return;
	}

	if (
		inspection.signing !== 'developer-id' ||
		inspection.identifier !== env.APPLE_APP_ID ||
		inspection.signerTeamId !== env.APPLE_TEAM_ID ||
		inspection.notarization !== 'notarized' ||
		inspection.stapling !== 'stapled'
	) {
		throw new Error(
			'signed macOS artifact must contain the expected Developer ID app, bundle identifier, team identifier, notarization, and stapled ticket.'
		);
	}

	if (inspection.authority !== env.CSC_NAME) {
		throw new Error(
			`signed macOS artifact authority "${inspection.authority}" does not match CSC_NAME.`
		);
	}
}

function sha256(filePath, dependencies) {
	return createHash('sha256')
		.update(dependencies.readFileSync(filePath))
		.digest('hex');
}

function sourceState(rootDir, env, dependencies) {
	const revision = dependencies.spawnSync('git', ['rev-parse', 'HEAD'], {
		cwd: rootDir,
		encoding: 'utf8'
	});
	const commit = revision.stdout?.trim();
	const status = dependencies.spawnSync(
		'git',
		['status', '--porcelain', '--untracked-files=all'],
		{cwd: rootDir, encoding: 'utf8'}
	);

	if (
		!commit ||
		revision.error ||
		revision.status !== 0 ||
		!status ||
		status.error ||
		status.status !== 0 ||
		!/^[0-9a-f]{40}$/i.test(commit)
	) {
		throw new Error('Could not record the exact source commit and tree state.');
	}

	if (env.GITHUB_SHA && env.GITHUB_SHA.trim() !== commit) {
		throw new Error('GITHUB_SHA does not match the checked-out source commit.');
	}

	return {
		commit,
		tree: status.stdout.trim().length === 0 ? 'clean' : 'dirty'
	};
}

const defaultDependencies = {
	execFileSync,
	inspectArtifact,
	mkdtempSync,
	readFileSync,
	rmSync,
	spawnSync,
	statSync,
	tmpdir,
	writeFileSync
};

function createArtifactProfileHook({
	arch,
	env = process.env,
	platform,
	profile,
	rootDir,
	version
}) {
	return async function afterAllArtifactBuild(
		buildResult,
		dependencies = defaultDependencies
	) {
		const targetMaps =
			buildResult.platformToTargets instanceof Map
				? [...buildResult.platformToTargets.values()]
				: [];

		if (
			buildResult.artifactPaths.length === 0 &&
			targetMaps.length > 0 &&
			targetMaps.every(
				targets =>
					targets.size === 0 ||
					[...targets.keys()].every(targetName => targetName === 'dir')
			)
		) {
			return [];
		}

		const updaterMetadata = buildResult.artifactPaths.filter(isUpdaterMetadata);

		if (updaterMetadata.length > 0) {
			throw new Error(
				`Updater metadata is disabled for every release profile: ${updaterMetadata
					.map(file => path.basename(file))
					.join(', ')}.`
			);
		}

		const expectedNames = expectedArtifacts(version, platform, arch, profile);
		const productArtifacts = buildResult.artifactPaths.filter(file =>
			path.basename(file).startsWith(`Twine-RS-${version}-`)
		);
		const artifacts = productArtifacts.filter(file =>
			expectedNames.includes(path.basename(file))
		);
		const actualNames = artifacts.map(file => path.basename(file)).sort();
		const unexpectedNames = productArtifacts
			.map(file => path.basename(file))
			.filter(name => !expectedNames.includes(name))
			.sort();

		if (
			actualNames.length !== expectedNames.length ||
			expectedNames.some(name => !actualNames.includes(name)) ||
			unexpectedNames.length > 0
		) {
			throw new Error(
				`Expected ${expectedNames.join(', ')} for ${platform}-${arch}; found ${
					actualNames.join(', ') || 'none'
				}${unexpectedNames.length > 0 ? `; unexpected target artifacts ${unexpectedNames.join(', ')}` : ''}.`
			);
		}

		const source = sourceState(rootDir, env, dependencies);

		if (isDistributionProfile(profile) && source.tree !== 'clean') {
			throw new Error(`${profile} artifacts require a clean source tree.`);
		}

		const entries = artifacts
			.map(file => {
				const inspection = dependencies.inspectArtifact(
					file,
					platform,
					dependencies
				);

				validateArtifactInspection(profile, platform, inspection, env);

				return {
					fileName: path.basename(file),
					sha256: sha256(file, dependencies),
					size: dependencies.statSync(file).size,
					...inspection
				};
			})
			.sort((left, right) => left.fileName.localeCompare(right.fileName));
		const manifest = {
			schemaVersion: manifestSchemaVersion,
			profile,
			applicationVersion: version,
			sourceCommit: source.commit,
			sourceTree: source.tree,
			buildDate: new Date().toISOString(),
			platform,
			architecture: arch,
			artifacts: entries
		};
		const manifestPath = path.join(
			buildResult.outDir,
			targetManifestName(version, platform, arch)
		);

		dependencies.writeFileSync(
			manifestPath,
			`${JSON.stringify(manifest, null, 2)}\n`
		);

		if (profile !== profiles.local) {
			return [manifestPath];
		}

		const noticePath = path.join(buildResult.outDir, localArtifactNoticeName);

		dependencies.writeFileSync(noticePath, localArtifactNotice);

		return [manifestPath, noticePath];
	};
}

module.exports = {
	createArtifactProfileHook,
	inspectArtifact,
	inspectWindowsArtifact,
	manifestSchemaVersion,
	validateArtifactInspection
};
