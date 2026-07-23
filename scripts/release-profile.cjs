const path = require('node:path');

const profiles = Object.freeze({
	local: 'local',
	signed: 'signed',
	unsigned: 'distributable-unsigned'
});
const validProfiles = new Set(Object.values(profiles));
const distributionProfiles = new Set([profiles.unsigned, profiles.signed]);
const localArtifactNoticeName = 'LOCAL-TEST-ONLY.txt';
const localArtifactNotice = [
	'Twine RS local test artifact',
	'',
	'This archive was produced by the local release profile.',
	'It is for install and runtime testing only and must not be distributed.',
	'Its local-profile manifest cannot satisfy distributable-unsigned or signed assembly.',
	''
].join('\n');

function hasValue(env, key) {
	return typeof env[key] === 'string' && env[key].trim().length > 0;
}

function resolveReleaseProfile(env = process.env, {allowDefault = true} = {}) {
	const value = env.TWINE_RELEASE_PROFILE?.trim();

	if (!value && allowDefault) {
		return profiles.local;
	}

	if (!validProfiles.has(value)) {
		throw new Error(
			`TWINE_RELEASE_PROFILE must be one of ${[...validProfiles].join(
				', '
			)}${allowDefault ? `; defaulting is allowed only to ${profiles.local}` : ''}.`
		);
	}

	return value;
}

function normalizePlatform(platform = process.platform) {
	switch (platform) {
		case 'darwin':
		case 'mac':
			return 'mac';
		case 'win32':
		case 'windows':
		case 'win':
			return 'win';
		case 'linux':
			return 'linux';
		default:
			throw new Error(`Unsupported release platform "${platform}".`);
	}
}

function normalizeArch(arch = process.arch) {
	if (arch !== 'x64' && arch !== 'arm64') {
		throw new Error(`Unsupported release architecture "${arch}".`);
	}

	return arch;
}

function missingValues(env, keys) {
	return keys.filter(key => !hasValue(env, key));
}

function validatePackagingProfile(
	profile,
	env = process.env,
	platform = process.platform
) {
	if (!validProfiles.has(profile)) {
		throw new Error(`Unknown release profile "${profile}".`);
	}

	const normalizedPlatform = normalizePlatform(platform);

	if (
		profile === profiles.unsigned &&
		env.ALLOW_UNSIGNED_DISTRIBUTION !== '1'
	) {
		throw new Error(
			'distributable-unsigned requires ALLOW_UNSIGNED_DISTRIBUTION=1.'
		);
	}

	if (profile === profiles.unsigned) {
		const forbidden =
			normalizedPlatform === 'mac'
				? ['CSC_LINK', 'CSC_NAME']
				: normalizedPlatform === 'win'
					? ['CSC_LINK', 'WIN_CSC_LINK']
					: [];
		const present = forbidden.filter(key => hasValue(env, key));

		if (present.length > 0) {
			throw new Error(
				`distributable-unsigned rejects trusted signing input: ${present.join(
					', '
				)}.`
			);
		}
	}

	if (profile !== profiles.signed || normalizedPlatform === 'linux') {
		return;
	}

	if (normalizedPlatform === 'mac') {
		const required = [
			'APPLE_APP_ID',
			'APPLE_ID',
			'APPLE_ID_PASSWORD',
			'APPLE_TEAM_ID',
			'CSC_NAME'
		];
		const missing = missingValues(env, required);

		if (missing.length > 0) {
			throw new Error(
				`signed macOS packaging is missing ${missing.join(', ')}.`
			);
		}

		if (!env.CSC_NAME.trim().startsWith('Developer ID Application:')) {
			throw new Error(
				'signed macOS packaging requires CSC_NAME to identify the expected Developer ID Application identity.'
			);
		}
	}

	if (normalizedPlatform === 'win') {
		const signingLink = hasValue(env, 'WIN_CSC_LINK')
			? 'WIN_CSC_LINK'
			: 'CSC_LINK';
		const signingPassword = hasValue(env, 'WIN_CSC_KEY_PASSWORD')
			? 'WIN_CSC_KEY_PASSWORD'
			: 'CSC_KEY_PASSWORD';
		const missing = missingValues(env, [
			signingLink,
			signingPassword,
			'WINDOWS_SIGNER_SUBJECT',
			'WINDOWS_SIGNER_SHA1'
		]);

		if (missing.length > 0) {
			throw new Error(
				`signed Windows packaging is missing ${missing.join(', ')}.`
			);
		}

		if (!/^[0-9a-f]{40}$/i.test(env.WINDOWS_SIGNER_SHA1.trim())) {
			throw new Error(
				'WINDOWS_SIGNER_SHA1 must be the expected 40-character certificate thumbprint.'
			);
		}
	}
}

function artifactName({arch, extension, platform, profile, version}) {
	const unsignedSuffix =
		profile === profiles.unsigned && (platform === 'mac' || platform === 'win')
			? '-unsigned'
			: '';

	return `Twine-RS-${version}-${platform}-${arch}${unsignedSuffix}.${extension}`;
}

function expectedArtifacts(version, platform, arch, profile) {
	const normalizedPlatform = normalizePlatform(platform);
	const normalizedArch = normalizeArch(arch);
	const requirements =
		normalizedPlatform === 'win'
			? [{extension: 'exe'}]
			: normalizedPlatform === 'mac'
				? [{extension: 'dmg'}]
				: [{extension: 'AppImage'}, {extension: 'zip'}];

	return requirements.map(({extension}) =>
		artifactName({
			arch: normalizedArch,
			extension,
			platform: normalizedPlatform,
			profile,
			version
		})
	);
}

function requiredArtifactMatrix(version, profile) {
	return [
		{arch: 'x64', extension: 'exe', platform: 'win'},
		{arch: 'x64', extension: 'dmg', platform: 'mac'},
		{arch: 'arm64', extension: 'dmg', platform: 'mac'},
		{arch: 'x64', extension: 'AppImage', platform: 'linux'},
		{arch: 'x64', extension: 'zip', platform: 'linux'},
		{arch: 'arm64', extension: 'AppImage', platform: 'linux'},
		{arch: 'arm64', extension: 'zip', platform: 'linux'}
	].map(requirement => ({
		...requirement,
		fileName: artifactName({...requirement, profile, version}),
		label: `${requirement.platform}-${requirement.arch}.${requirement.extension}`
	}));
}

function targetManifestName(version, platform, arch) {
	return `Twine-RS-${version}-${normalizePlatform(platform)}-${normalizeArch(
		arch
	)}.artifact-manifest.json`;
}

function builderOutputDirectory(
	profile,
	platform = process.platform,
	arch = process.arch
) {
	const target = `${normalizePlatform(platform)}-${normalizeArch(arch)}`;

	if (profile === profiles.local) {
		return path.join('artifacts', 'local', target);
	}

	return path.join('artifacts', 'staging', profile, target);
}

function isDistributionProfile(profile) {
	return distributionProfiles.has(profile);
}

function isUpdaterMetadata(name) {
	return name.endsWith('.blockmap') || /\.ya?ml$/i.test(path.basename(name));
}

module.exports = {
	artifactName,
	builderOutputDirectory,
	expectedArtifacts,
	isDistributionProfile,
	isUpdaterMetadata,
	localArtifactNotice,
	localArtifactNoticeName,
	normalizeArch,
	normalizePlatform,
	profiles,
	requiredArtifactMatrix,
	resolveReleaseProfile,
	targetManifestName,
	validatePackagingProfile,
	validProfiles
};
