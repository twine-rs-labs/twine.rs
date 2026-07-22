const {
	createMacBuildHooks,
	hasCompleteNotarizationEnv
} = require('./scripts/electron-builder-hooks.cjs');
const {createNativePackagingHooks} = require('./scripts/native-artifact.cjs');
const {
	createCompliancePackagingHooks
} = require('./scripts/compliance-artifacts.cjs');
const pkg = require('./package.json');

const isPreview =
	/alpha|beta|pre/.test(pkg.version) || process.env.FORCE_PREVIEW;
const productName = 'Twine RS';
const artifactProductName = 'Twine-RS';
const macHooks = createMacBuildHooks({productName});
const nativeHooks = createNativePackagingHooks({
	productName,
	rootDir: __dirname
});
const complianceHooks = createCompliancePackagingHooks({
	productName,
	rootDir: __dirname
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
	appId: 'rs.twine.app',
	productName,
	directories: {
		output: 'release'
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
		artifactName: `${artifactProductName}-${pkg.version}-mac-\${arch}.\${ext}`,
		category: 'public.app-category.developer-tools',
		extendInfo: {
			NSAudioCaptureUsageDescription: null,
			NSBluetoothAlwaysUsageDescription: null,
			NSBluetoothPeripheralUsageDescription: null,
			NSCameraUsageDescription: null,
			NSMicrophoneUsageDescription: null
		},
		forceCodeSigning: hasCompleteNotarizationEnv(process.env),
		icon: `icons/app-${isPreview ? 'preview' : 'release'}.png`,
		notarize: false,
		target: 'dmg'
	},
	nsis: {
		oneClick: false,
		allowToChangeInstallationDirectory: true
	},
	win: {
		artifactName: `${artifactProductName}-${pkg.version}-win-\${arch}.\${ext}`,
		icon: `icons/app-${isPreview ? 'preview' : 'release'}-no-padding.ico`,
		target: 'nsis'
	}
};
