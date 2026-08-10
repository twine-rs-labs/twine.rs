import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmod, copyFile, mkdir, mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';

const execFileAsync = promisify(execFile);

export const wasmBindgenVersion = '0.2.125';

const releaseAssets = {
	'darwin-arm64': {
		sha256: '2b46fc01a6a2f5bcb24e5c5e92adf216a38ef4f57542b5291b44fa34f76ac6d2',
		target: 'aarch64-apple-darwin'
	},
	'darwin-x64': {
		sha256: '7e17f6656586a642d58cd77e63d696d8ef88df14ea4573c45af680111177e39b',
		target: 'x86_64-apple-darwin'
	},
	'linux-arm64': {
		sha256: '79dd073086ea0e47fe23ffae01e91c729445b59b41f046dbf83cd8f5d98899b0',
		target: 'aarch64-unknown-linux-gnu'
	},
	'linux-x64': {
		sha256: '21d81ef7414a0a585861a60ea4ae2b7970eccaed09d4a4e05f8bc4b159827dea',
		target: 'x86_64-unknown-linux-musl'
	},
	'win32-x64': {
		sha256: 'ddf9edc68a1ad546932f8bb65e4346caeb916a4822477e2c5b3c25941cc38a76',
		target: 'x86_64-pc-windows-msvc'
	}
};

async function downloadRelease(fetchImpl, release) {
	let failure;

	for (let attempt = 1; attempt <= 3; attempt += 1) {
		try {
			const response = await fetchImpl(release.url);

			if (response.ok) {
				return response;
			}

			failure = new Error(
				`Downloading ${release.name} failed with HTTP ${response.status}.`
			);
			if (response.status < 500 && response.status !== 429) {
				throw failure;
			}
		} catch (error) {
			failure = error;
		}

		if (attempt < 3) {
			await delay(attempt * 2_000);
		}
	}

	throw failure;
}

export async function extractReleaseArchive({
	archiveName,
	execFileImpl = execFileAsync,
	temporaryRoot
}) {
	await execFileImpl('tar', ['-xzf', archiveName, '-C', 'extract'], {
		cwd: temporaryRoot
	});
}

export function wasmBindgenReleaseAsset({
	arch = process.arch,
	platform = process.platform
} = {}) {
	const release = releaseAssets[`${platform}-${arch}`];

	if (!release) {
		throw new Error(
			`No pinned wasm-bindgen ${wasmBindgenVersion} binary for ${platform}-${arch}.`
		);
	}

	const name = `wasm-bindgen-${wasmBindgenVersion}-${release.target}.tar.gz`;

	return {
		...release,
		name,
		url: `https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${wasmBindgenVersion}/${name}`
	};
}

export async function installWasmBindgenCli({
	arch = process.arch,
	fetchImpl = fetch,
	platform = process.platform,
	root
}) {
	if (typeof root !== 'string' || !path.isAbsolute(root)) {
		throw new Error('A nonempty absolute --root is required.');
	}

	const release = wasmBindgenReleaseAsset({arch, platform});
	const temporaryRoot = await mkdtemp(
		path.join(tmpdir(), 'twine-wasm-bindgen-cli-')
	);

	try {
		const response = await downloadRelease(fetchImpl, release);
		const archive = Buffer.from(await response.arrayBuffer());
		const actualSha256 = createHash('sha256').update(archive).digest('hex');

		if (actualSha256 !== release.sha256) {
			throw new Error(
				`${release.name} SHA-256 mismatch: expected ${release.sha256}, received ${actualSha256}.`
			);
		}

		const archivePath = path.join(temporaryRoot, release.name);
		const extractRoot = path.join(temporaryRoot, 'extract');

		await mkdir(extractRoot);
		await writeFile(archivePath, archive);
		await extractReleaseArchive({
			archiveName: release.name,
			temporaryRoot
		});

		const bundleRoot = path.join(
			extractRoot,
			release.name.replace(/\.tar\.gz$/, '')
		);
		const executableSuffix = platform === 'win32' ? '.exe' : '';
		const binRoot = path.join(root, 'bin');

		await mkdir(binRoot, {recursive: true});
		for (const command of [
			'wasm-bindgen',
			'wasm-bindgen-test-runner',
			'wasm2es6js'
		]) {
			const executable = `${command}${executableSuffix}`;
			const destination = path.join(binRoot, executable);

			await copyFile(path.join(bundleRoot, executable), destination);
			await chmod(destination, 0o755);
		}
	} finally {
		await rm(temporaryRoot, {force: true, recursive: true});
	}
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))
) {
	const rootIndex = process.argv.indexOf('--root');
	const root = rootIndex >= 0 ? process.argv[rootIndex + 1] : undefined;

	await installWasmBindgenCli({root});
}
