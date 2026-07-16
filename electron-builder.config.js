const {
	createMacBuildHooks,
	hasCompleteNotarizationEnv
} = require('./scripts/electron-builder-hooks.cjs');
const pkg = require('./package.json');

const isPreview =
	/alpha|beta|pre/.test(pkg.version) || process.env.FORCE_PREVIEW;
const productName = 'Twine RS';
const artifactProductName = 'Twine-RS';
const {afterPack, afterSign} = createMacBuildHooks({productName});

module.exports = {
	afterPack,
	afterSign,
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
	files: ['electron-build/**/*', 'node_modules/**/*'],
	dmg: {
		writeUpdateInfo: false
	},
	linux: {
		artifactName: `${artifactProductName}-${pkg.version}-linux-\${arch}.\${ext}`,
		category: 'Development',
		icon: `icons/app-${isPreview ? 'preview' : 'release'}.png`,
		target: [
			{arch: ['arm64', 'x64'], target: 'AppImage'},
			{arch: ['arm64', 'x64'], target: 'zip'}
		]
	},
	mac: {
		artifactName: `${artifactProductName}-${pkg.version}-mac-universal.\${ext}`,
		category: 'public.app-category.developer-tools',
		forceCodeSigning: hasCompleteNotarizationEnv(process.env),
		icon: `icons/app-${isPreview ? 'preview' : 'release'}.png`,
		notarize: false,
		target: {arch: ['universal'], target: 'dmg'}
	},
	nsis: {
		oneClick: false,
		allowToChangeInstallationDirectory: true
	},
	win: {
		artifactName: `${artifactProductName}-${pkg.version}-win-\${arch}.\${ext}`,
		icon: `icons/app-${isPreview ? 'preview' : 'release'}-no-padding.ico`,
		target: {arch: ['x64'], target: 'nsis'}
	}
};
