const {createMacBuildHooks} = require('./scripts/electron-builder-hooks.cjs');
const {createNativePackagingHooks} = require('./scripts/native-artifact.cjs');
const {
	createCompliancePackagingHooks
} = require('./scripts/compliance-artifacts.cjs');
const {
	builderOutputDirectory,
	profiles,
	resolveReleaseProfile,
	validatePackagingProfile
} = require('./scripts/release-profile.cjs');
const {
	createArtifactProfileHook
} = require('./scripts/artifact-profile-hooks.cjs');
const pkg = require('./package.json');

const isPreview =
	/^\d+\.\d+\.\d+-/.test(pkg.version) || process.env.FORCE_PREVIEW;
const productName = 'Twine RS';
const artifactProductName = 'Twine-RS';
const releaseProfile = resolveReleaseProfile(process.env);
const releaseArch = process.arch;
const releasePlatform = process.platform;
const unsignedSuffix = releaseProfile === profiles.unsigned ? '-unsigned' : '';

validatePackagingProfile(releaseProfile, process.env, releasePlatform);

const macHooks = createMacBuildHooks({
	productName,
	profile: releaseProfile
});
const nativeHooks = createNativePackagingHooks({
	productName,
	rootDir: __dirname
});
const complianceHooks = createCompliancePackagingHooks({
	productName,
	rootDir: __dirname
});
const artifactProfileHook = createArtifactProfileHook({
	arch: releaseArch,
	platform:
		releasePlatform === 'darwin'
			? 'mac'
			: releasePlatform === 'win32'
				? 'win'
				: releasePlatform,
	profile: releaseProfile,
	rootDir: __dirname,
	version: pkg.version
});

function beforePack(context) {
	complianceHooks.beforePack(context);
	nativeHooks.beforePack(context);
}

async function afterPack(context) {
	complianceHooks.afterPack(context);
	nativeHooks.afterPack(context);
	await macHooks.afterPack(context);
}

module.exports = {
	beforePack,
	afterPack,
	afterSign: macHooks.afterSign,
	afterAllArtifactBuild: artifactProfileHook,
	appId: 'rs.twine.app',
	productName,
	directories: {
		output: builderOutputDirectory(releaseProfile, releasePlatform, releaseArch)
	},
	extraMetadata: {
		main: 'electron-build/main/src/electron/main-process/index.js',
		name: 'twine-rs',
		productName
	},
	files: [
		'electron-build/**/*',
		'!electron-build/compliance{,/**/*}',
		'node_modules/**/*',
		'LICENSE',
		{
			from: 'electron-build/compliance',
			to: '.',
			filter: [
				'THIRD_PARTY_NOTICES.md',
				'sbom.cdx.json',
				'LICENSES.chromium.html'
			]
		}
	],
	dmg: {
		writeUpdateInfo: false
	},
	linux: {
		artifactName: `${artifactProductName}-${pkg.version}-linux-\${arch}.\${ext}`,
		category: 'Development',
		icon: `icons/app-${isPreview ? 'preview' : 'release'}.png`,
		target: ['AppImage', 'zip']
	},
	mac: {
		artifactName: `${artifactProductName}-${pkg.version}-mac-\${arch}${unsignedSuffix}.\${ext}`,
		category: 'public.app-category.developer-tools',
		extendInfo: {
			NSAudioCaptureUsageDescription: null,
			NSBluetoothAlwaysUsageDescription: null,
			NSBluetoothPeripheralUsageDescription: null,
			NSCameraUsageDescription: null,
			NSMicrophoneUsageDescription: null
		},
		forceCodeSigning: releaseProfile === profiles.signed,
		identity: releaseProfile === profiles.signed ? process.env.CSC_NAME : null,
		icon: `icons/app-${isPreview ? 'preview' : 'release'}.png`,
		notarize: false,
		target: 'dmg'
	},
	nsis: {
		oneClick: false,
		allowToChangeInstallationDirectory: true,
		differentialPackage: false
	},
	win: {
		artifactName: `${artifactProductName}-${pkg.version}-win-\${arch}${unsignedSuffix}.\${ext}`,
		forceCodeSigning: releaseProfile === profiles.signed,
		icon: `icons/app-${isPreview ? 'preview' : 'release'}-no-padding.ico`,
		signExecutable: releaseProfile === profiles.signed,
		target: 'nsis'
	},
	publish: null
};
