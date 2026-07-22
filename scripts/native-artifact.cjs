const {readFileSync} = require('node:fs');
const path = require('node:path');

const electronBuilderArchNames = new Map([
	[1, 'x64'],
	[3, 'arm64'],
	[4, 'universal']
]);
const supportedPlatforms = new Set(['darwin', 'linux', 'win32']);
const supportedArchitectures = new Set(['arm64', 'x64']);

function normalizePlatform(platform) {
	if (!supportedPlatforms.has(platform)) {
		throw new Error(`Unsupported native addon platform: ${platform}`);
	}

	return platform;
}

function normalizeArchitecture(arch) {
	const normalized =
		typeof arch === 'number' ? electronBuilderArchNames.get(arch) : arch;

	if (!supportedArchitectures.has(normalized)) {
		throw new Error(`Unsupported native addon architecture: ${normalized}`);
	}

	return normalized;
}

function nativeTargetTriple(platform, arch) {
	const normalizedPlatform = normalizePlatform(platform);
	const normalizedArch = normalizeArchitecture(arch);
	const cpu = normalizedArch === 'arm64' ? 'aarch64' : 'x86_64';

	switch (normalizedPlatform) {
		case 'darwin':
			return `${cpu}-apple-darwin`;
		case 'linux':
			return `${cpu}-unknown-linux-gnu`;
		case 'win32':
			return `${cpu}-pc-windows-msvc`;
	}
}

function nativeLibraryName(platform) {
	switch (normalizePlatform(platform)) {
		case 'darwin':
			return 'libtwine_native.dylib';
		case 'linux':
			return 'libtwine_native.so';
		case 'win32':
			return 'twine_native.dll';
	}
}

function nativeArtifactPath(rootDir, platform, arch) {
	const normalizedPlatform = normalizePlatform(platform);
	const normalizedArch = normalizeArchitecture(arch);

	return path.join(
		rootDir,
		'target',
		'native-addon',
		`${normalizedPlatform}-${normalizedArch}`,
		'twine_native.node'
	);
}

function cpuArchitecture(cpuType) {
	switch (cpuType >>> 0) {
		case 0x01000007:
			return 'x64';
		case 0x0100000c:
			return 'arm64';
		default:
			return undefined;
	}
}

function inspectMachO(buffer) {
	if (buffer.length < 8) {
		return undefined;
	}

	const littleEndianMagic = buffer.readUInt32LE(0);

	if (littleEndianMagic === 0xfeedfacf) {
		const arch = cpuArchitecture(buffer.readUInt32LE(4));

		return arch ? {architectures: [arch], format: 'Mach-O'} : undefined;
	}

	const bigEndianMagic = buffer.readUInt32BE(0);

	if (bigEndianMagic !== 0xcafebabe && bigEndianMagic !== 0xcafebabf) {
		return undefined;
	}

	const entrySize = bigEndianMagic === 0xcafebabf ? 32 : 20;
	const count = buffer.readUInt32BE(4);
	const architectures = new Set();

	if (count > 32 || buffer.length < 8 + count * entrySize) {
		return undefined;
	}

	for (let index = 0; index < count; index++) {
		const arch = cpuArchitecture(buffer.readUInt32BE(8 + index * entrySize));

		if (arch) {
			architectures.add(arch);
		}
	}

	return architectures.size > 0
		? {architectures: [...architectures].sort(), format: 'Mach-O'}
		: undefined;
}

function inspectElf(buffer) {
	if (
		buffer.length < 20 ||
		buffer[0] !== 0x7f ||
		buffer.toString('ascii', 1, 4) !== 'ELF'
	) {
		return undefined;
	}

	const littleEndian = buffer[5] === 1;
	const bigEndian = buffer[5] === 2;

	if (!littleEndian && !bigEndian) {
		return undefined;
	}

	const machine = littleEndian
		? buffer.readUInt16LE(18)
		: buffer.readUInt16BE(18);
	const arch = machine === 62 ? 'x64' : machine === 183 ? 'arm64' : undefined;

	return arch ? {architectures: [arch], format: 'ELF'} : undefined;
}

function inspectPortableExecutable(buffer) {
	if (buffer.length < 64 || buffer.toString('ascii', 0, 2) !== 'MZ') {
		return undefined;
	}

	const peOffset = buffer.readUInt32LE(0x3c);

	if (
		peOffset > buffer.length - 6 ||
		buffer.toString('binary', peOffset, peOffset + 4) !== 'PE\u0000\u0000'
	) {
		return undefined;
	}

	const machine = buffer.readUInt16LE(peOffset + 4);
	const arch =
		machine === 0x8664 ? 'x64' : machine === 0xaa64 ? 'arm64' : undefined;

	return arch ? {architectures: [arch], format: 'PE'} : undefined;
}

function inspectNativeBuffer(buffer, label = 'Native addon') {
	const result =
		inspectMachO(buffer) ??
		inspectElf(buffer) ??
		inspectPortableExecutable(buffer);

	if (!result) {
		throw new Error(
			`${label} is not a recognized x64/ARM64 Mach-O, ELF, or PE binary.`
		);
	}

	return result;
}

function inspectNativeArtifact(filePath) {
	return inspectNativeBuffer(
		readFileSync(filePath),
		`Native addon ${filePath}`
	);
}

function assertNativeBuffer(buffer, {arch, label = 'Native addon', platform}) {
	const normalizedPlatform = normalizePlatform(platform);
	const normalizedArch = normalizeArchitecture(arch);
	const expectedFormat = {
		darwin: 'Mach-O',
		linux: 'ELF',
		win32: 'PE'
	}[normalizedPlatform];
	const result = inspectNativeBuffer(buffer, label);

	if (
		result.format !== expectedFormat ||
		!result.architectures.includes(normalizedArch)
	) {
		throw new Error(
			`Native addon target mismatch: packaging ${normalizedPlatform}-${normalizedArch}, ` +
				`but ${label} is ${result.format} ${result.architectures.join('/')}.`
		);
	}

	return result;
}

function assertNativeArtifact(filePath, target) {
	return assertNativeBuffer(readFileSync(filePath), {
		...target,
		label: filePath
	});
}

function createNativePackagingHooks({
	extractFile = require('@electron/asar').extractFile,
	productName,
	rootDir
}) {
	function targetFromContext(context) {
		return {
			arch: normalizeArchitecture(context.arch),
			platform: normalizePlatform(context.electronPlatformName)
		};
	}

	function beforePack(context) {
		const {arch, platform} = targetFromContext(context);
		const stagedAddon = path.join(
			rootDir,
			'electron-build',
			'main',
			'src',
			'electron',
			'main-process',
			'native',
			'twine_native.node'
		);

		assertNativeArtifact(stagedAddon, {arch, platform});
		console.log(
			`native-package-check: verified ${platform}-${arch} addon at ${stagedAddon}`
		);
	}

	function afterPack(context) {
		const {arch, platform} = targetFromContext(context);
		const resourcesDir =
			platform === 'darwin'
				? path.join(
						context.appOutDir,
						`${productName}.app`,
						'Contents',
						'Resources'
					)
				: path.join(context.appOutDir, 'resources');
		const asarPath = path.join(resourcesDir, 'app.asar');
		const archivePath = platform === 'win32' ? path.win32 : path.posix;
		const addonPath = archivePath.join(
			'electron-build',
			'main',
			'src',
			'electron',
			'main-process',
			'native',
			'twine_native.node'
		);
		const packagedAddon = extractFile(asarPath, addonPath);

		assertNativeBuffer(packagedAddon, {
			arch,
			label: `${asarPath}/${addonPath}`,
			platform
		});
		console.log(
			`native-package-check: verified packaged ${platform}-${arch} addon in ${asarPath}`
		);
	}

	return {afterPack, beforePack};
}

module.exports = {
	assertNativeArtifact,
	assertNativeBuffer,
	createNativePackagingHooks,
	inspectNativeArtifact,
	inspectNativeBuffer,
	nativeArtifactPath,
	nativeLibraryName,
	nativeTargetTriple,
	normalizeArchitecture,
	normalizePlatform
};
