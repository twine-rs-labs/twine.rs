import assert from 'node:assert/strict';
import {mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import os from 'node:os';
import path from 'node:path';
import {after, test} from 'node:test';

const require = createRequire(import.meta.url);
const {
	assertNativeArtifact,
	createNativePackagingHooks,
	inspectNativeArtifact,
	nativeArtifactPath,
	nativeTargetTriple
} = require('../native-artifact.cjs');
const temporaryRoots = [];

after(async () => {
	await Promise.all(
		temporaryRoots.map(root => rm(root, {force: true, recursive: true}))
	);
});

function machO(arch) {
	const buffer = Buffer.alloc(32);

	buffer.writeUInt32LE(0xfeedfacf, 0);
	buffer.writeUInt32LE(arch === 'arm64' ? 0x0100000c : 0x01000007, 4);
	return buffer;
}

function elf(arch) {
	const buffer = Buffer.alloc(64);

	buffer.write('\u007fELF', 0, 'binary');
	buffer[4] = 2;
	buffer[5] = 1;
	buffer.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18);
	return buffer;
}

function portableExecutable(arch) {
	const buffer = Buffer.alloc(128);

	buffer.write('MZ', 0, 'ascii');
	buffer.writeUInt32LE(64, 0x3c);
	buffer.write('PE\u0000\u0000', 64, 'binary');
	buffer.writeUInt16LE(arch === 'arm64' ? 0xaa64 : 0x8664, 68);
	return buffer;
}

async function temporaryFile(contents) {
	const root = await mkdtemp(path.join(os.tmpdir(), 'twine-native-artifact-'));
	const filePath = path.join(root, 'twine_native.node');

	temporaryRoots.push(root);
	await writeFile(filePath, contents);
	return filePath;
}

test('native target paths and Rust triples are platform and architecture qualified', () => {
	assert.equal(nativeTargetTriple('darwin', 'arm64'), 'aarch64-apple-darwin');
	assert.equal(nativeTargetTriple('linux', 'x64'), 'x86_64-unknown-linux-gnu');
	assert.equal(nativeTargetTriple('win32', 'x64'), 'x86_64-pc-windows-msvc');
	assert.equal(
		nativeArtifactPath('/repo', 'linux', 'arm64'),
		path.join(
			'/repo',
			'target',
			'native-addon',
			'linux-arm64',
			'twine_native.node'
		)
	);
});

test('native artifact inspection recognizes supported executable formats', async () => {
	for (const [contents, expected] of [
		[machO('arm64'), {architectures: ['arm64'], format: 'Mach-O'}],
		[elf('x64'), {architectures: ['x64'], format: 'ELF'}],
		[portableExecutable('arm64'), {architectures: ['arm64'], format: 'PE'}]
	]) {
		assert.deepEqual(
			inspectNativeArtifact(await temporaryFile(contents)),
			expected
		);
	}
});

test('native artifact verification rejects an OS or CPU mismatch', async () => {
	const filePath = await temporaryFile(machO('arm64'));

	assert.throws(
		() => assertNativeArtifact(filePath, {arch: 'x64', platform: 'darwin'}),
		/packaging darwin-x64.*Mach-O arm64/
	);
	assert.throws(
		() => assertNativeArtifact(filePath, {arch: 'arm64', platform: 'linux'}),
		/packaging linux-arm64.*Mach-O arm64/
	);
});

test('electron-builder hooks reject mismatched staged and packaged addons', async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'twine-native-package-'));
	const stagedAddon = path.join(
		root,
		'electron-build',
		'main',
		'src',
		'electron',
		'main-process',
		'native',
		'twine_native.node'
	);
	let packagedAddon = machO('arm64');
	const {afterPack, beforePack} = createNativePackagingHooks({
		extractFile: () => packagedAddon,
		productName: 'Twine RS',
		rootDir: root
	});

	temporaryRoots.push(root);
	await mkdir(path.dirname(stagedAddon), {recursive: true});
	await writeFile(stagedAddon, machO('arm64'));
	assert.doesNotThrow(() =>
		beforePack({arch: 3, electronPlatformName: 'darwin'})
	);
	assert.throws(
		() => beforePack({arch: 1, electronPlatformName: 'darwin'}),
		/packaging darwin-x64.*Mach-O arm64/
	);
	assert.throws(
		() => beforePack({arch: 4, electronPlatformName: 'darwin'}),
		/Unsupported native addon architecture: universal/
	);
	assert.doesNotThrow(() =>
		afterPack({
			appOutDir: path.join(root, 'mac-arm64'),
			arch: 3,
			electronPlatformName: 'darwin'
		})
	);
	packagedAddon = machO('x64');
	assert.throws(
		() =>
			afterPack({
				appOutDir: path.join(root, 'mac-arm64'),
				arch: 3,
				electronPlatformName: 'darwin'
			}),
		/packaging darwin-arm64.*Mach-O x64/
	);
});

test('packaged addon lookup uses the target operating system separator', () => {
	let requestedAddonPath;
	const {afterPack} = createNativePackagingHooks({
		extractFile: (_asarPath, addonPath) => {
			requestedAddonPath = addonPath;
			return portableExecutable('x64');
		},
		productName: 'Twine RS',
		rootDir: '/repo'
	});

	afterPack({
		appOutDir: 'C:\\release\\win-unpacked',
		arch: 1,
		electronPlatformName: 'win32'
	});
	assert.equal(
		requestedAddonPath,
		path.win32.join(
			'electron-build',
			'main',
			'src',
			'electron',
			'main-process',
			'native',
			'twine_native.node'
		)
	);
});
