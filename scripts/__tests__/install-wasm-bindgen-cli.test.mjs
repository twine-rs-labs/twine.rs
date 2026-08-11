import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {
	downloadRelease,
	extractReleaseArchive,
	installWasmBindgenCli,
	wasmBindgenReleaseAsset,
	wasmBindgenVersion
} from '../install-wasm-bindgen-cli.mjs';

const expectedAssets = [
	[
		'darwin',
		'arm64',
		'aarch64-apple-darwin',
		'2b46fc01a6a2f5bcb24e5c5e92adf216a38ef4f57542b5291b44fa34f76ac6d2'
	],
	[
		'darwin',
		'x64',
		'x86_64-apple-darwin',
		'7e17f6656586a642d58cd77e63d696d8ef88df14ea4573c45af680111177e39b'
	],
	[
		'linux',
		'arm64',
		'aarch64-unknown-linux-gnu',
		'79dd073086ea0e47fe23ffae01e91c729445b59b41f046dbf83cd8f5d98899b0'
	],
	[
		'linux',
		'x64',
		'x86_64-unknown-linux-musl',
		'21d81ef7414a0a585861a60ea4ae2b7970eccaed09d4a4e05f8bc4b159827dea'
	],
	[
		'win32',
		'x64',
		'x86_64-pc-windows-msvc',
		'ddf9edc68a1ad546932f8bb65e4346caeb916a4822477e2c5b3c25941cc38a76'
	]
];

const testRelease = {
	name: 'wasm-bindgen-test.tar.gz',
	url: 'https://example.invalid/wasm-bindgen-test.tar.gz'
};

test('maps every packaged runner to a checksum-pinned wasm-bindgen release', () => {
	for (const [platform, arch, target, sha256] of expectedAssets) {
		const release = wasmBindgenReleaseAsset({arch, platform});
		const name = `wasm-bindgen-${wasmBindgenVersion}-${target}.tar.gz`;

		assert.deepEqual(release, {
			name,
			sha256,
			target,
			url: `https://github.com/wasm-bindgen/wasm-bindgen/releases/download/${wasmBindgenVersion}/${name}`
		});
	}
});

test('rejects unsupported wasm-bindgen release targets', () => {
	assert.throws(
		() => wasmBindgenReleaseAsset({arch: 'arm64', platform: 'win32'}),
		/No pinned wasm-bindgen/
	);
});

test('does not retry permanent wasm-bindgen download client errors', async () => {
	let attempts = 0;
	const backoffs = [];

	await assert.rejects(
		downloadRelease(
			async () => {
				attempts += 1;
				return new Response(null, {status: 404});
			},
			testRelease,
			{delayImpl: async milliseconds => backoffs.push(milliseconds)}
		),
		/HTTP 404/
	);

	assert.equal(attempts, 1);
	assert.deepEqual(backoffs, []);
});

test('retries transient wasm-bindgen download server errors', async () => {
	const statuses = [503, 503, 200];
	const backoffs = [];

	const response = await downloadRelease(
		async () => new Response(null, {status: statuses.shift()}),
		testRelease,
		{delayImpl: async milliseconds => backoffs.push(milliseconds)}
	);

	assert.equal(response.status, 200);
	assert.deepEqual(statuses, []);
	assert.deepEqual(backoffs, [2_000, 4_000]);
});

test('retries wasm-bindgen download rate limits', async () => {
	let attempts = 0;
	const backoffs = [];

	const response = await downloadRelease(
		async () => {
			attempts += 1;
			return new Response(null, {status: attempts === 1 ? 429 : 200});
		},
		testRelease,
		{delayImpl: async milliseconds => backoffs.push(milliseconds)}
	);

	assert.equal(response.status, 200);
	assert.equal(attempts, 2);
	assert.deepEqual(backoffs, [2_000]);
});

test('retries wasm-bindgen download network failures', async () => {
	let attempts = 0;
	const backoffs = [];

	const response = await downloadRelease(
		async () => {
			attempts += 1;
			if (attempts === 1) {
				throw new Error('temporary network failure');
			}
			return new Response(null, {status: 200});
		},
		testRelease,
		{delayImpl: async milliseconds => backoffs.push(milliseconds)}
	);

	assert.equal(response.status, 200);
	assert.equal(attempts, 2);
	assert.deepEqual(backoffs, [2_000]);
});

test('extracts with relative paths so Windows drive letters are not parsed as hosts', async () => {
	const calls = [];

	await extractReleaseArchive({
		archiveName: 'wasm-bindgen-0.2.125-x86_64-pc-windows-msvc.tar.gz',
		execFileImpl: async (...args) => calls.push(args),
		temporaryRoot: String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\twine-wasm-bindgen-cli`
	});

	assert.deepEqual(calls, [
		[
			'tar',
			[
				'-xzf',
				'wasm-bindgen-0.2.125-x86_64-pc-windows-msvc.tar.gz',
				'-C',
				'extract'
			],
			{
				cwd: String.raw`C:\Users\RUNNER~1\AppData\Local\Temp\twine-wasm-bindgen-cli`
			}
		]
	]);
});

test('rejects a wasm-bindgen archive with the wrong checksum', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'twine-wasm-bindgen-test-'));

	try {
		await assert.rejects(
			installWasmBindgenCli({
				arch: 'arm64',
				fetchImpl: async () => new Response('tampered archive'),
				platform: 'darwin',
				root
			}),
			/SHA-256 mismatch/
		);
	} finally {
		await rm(root, {force: true, recursive: true});
	}
});
