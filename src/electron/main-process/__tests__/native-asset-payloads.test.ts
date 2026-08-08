const limits = {
	maxFileBytes: 100,
	maxFileCount: 2,
	maxTotalEncodedBytes: 200
};
const packageLimits = {
	maxAssetFileBytes: 100,
	maxAssetFileCount: 2,
	maxAssetTotalBytes: 200
};
const baselines = [
	{
		expectedExists: true,
		expectedModifiedAtMs: 1,
		expectedSizeBytes: 3,
		path: 'assets/asset.png'
	}
];
const batch = {
	failures: [],
	payloads: [
		{
			bytes: Buffer.from([1, 2, 3]),
			encodedSizeBytes: 4,
			mediaType: 'image/png',
			modifiedAtMs: 1,
			path: 'assets/asset.png',
			sha256: 'a'.repeat(64),
			sizeBytes: 3
		}
	],
	totalEncodedBytes: 4,
	totalSourceBytes: 3
};

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {promise, reject, resolve};
}

async function loadAdapter(
	reader: jest.Mock,
	digestCapture?: jest.Mock,
	packageReader?: jest.Mock,
	packageInspector?: jest.Mock
) {
	const nativeRequire = jest.fn().mockReturnValue({
		captureProjectAssetDigests: digestCapture,
		inspectProjectPackageAssets: packageInspector,
		readProjectAssetPayloads: reader,
		readProjectPackageAssetPayloads: packageReader
	});

	jest.resetModules();
	jest.doMock('fs', () => ({existsSync: jest.fn(() => true)}));
	jest.doMock('module', () => ({
		createRequire: jest.fn(() => nativeRequire)
	}));

	return import('../native');
}

describe('readNativeProjectAssetPayloads()', () => {
	beforeEach(() => {
		process.env.TWINE_NATIVE = 'force';
	});

	afterEach(() => {
		delete process.env.TWINE_NATIVE;
	});

	it('queues a concurrent read and releases admission after success', async () => {
		const firstRead = deferred<typeof batch>();
		const reader = jest
			.fn()
			.mockReturnValueOnce(firstRead.promise)
			.mockResolvedValueOnce(batch);
		const {readNativeProjectAssetPayloads} = await loadAdapter(reader);
		const firstResult = readNativeProjectAssetPayloads(
			'/mock/project',
			baselines,
			limits
		);

		const secondResult = readNativeProjectAssetPayloads(
			'/mock/project',
			baselines,
			limits
		);
		await Promise.resolve();
		expect(reader).toHaveBeenCalledTimes(1);

		firstRead.resolve(batch);
		await expect(firstResult).resolves.toEqual({
			...batch,
			payloads: [
				{
					bytes: batch.payloads[0].bytes,
					encodedSizeBytes: 4,
					mediaType: 'image/png',
					path: 'assets/asset.png',
					sha256: 'a'.repeat(64),
					sizeBytes: 3
				}
			]
		});
		await expect(secondResult).resolves.toEqual(
			expect.objectContaining({totalSourceBytes: 3})
		);
		expect(reader).toHaveBeenCalledTimes(2);
	});

	it('releases admission after the native Promise rejects', async () => {
		const failedRead = deferred<typeof batch>();
		const reader = jest
			.fn()
			.mockReturnValueOnce(failedRead.promise)
			.mockResolvedValueOnce(batch);
		const {readNativeProjectAssetPayloads} = await loadAdapter(reader);
		const firstResult = readNativeProjectAssetPayloads(
			'/mock/project',
			baselines,
			limits
		);

		failedRead.reject(new Error('Native read failed.'));
		await expect(firstResult).rejects.toThrow('Native read failed.');
		await expect(
			readNativeProjectAssetPayloads('/mock/project', baselines, limits)
		).resolves.toEqual(expect.objectContaining({totalEncodedBytes: 4}));
	});

	it('releases admission after the native reader throws synchronously', async () => {
		const reader = jest
			.fn()
			.mockImplementationOnce(() => {
				throw new Error('Native call threw.');
			})
			.mockResolvedValueOnce(batch);
		const {readNativeProjectAssetPayloads} = await loadAdapter(reader);

		await expect(
			readNativeProjectAssetPayloads('/mock/project', baselines, limits)
		).rejects.toThrow('Native call threw.');
		await expect(
			readNativeProjectAssetPayloads('/mock/project', baselines, limits)
		).resolves.toEqual(expect.objectContaining({payloads: expect.any(Array)}));
	});
});

describe('readNativeProjectPackageAssetPayloads()', () => {
	beforeEach(() => {
		process.env.TWINE_NATIVE = 'force';
	});

	afterEach(() => {
		delete process.env.TWINE_NATIVE;
	});

	it('enforces the trusted baselines and preserves byte digests', async () => {
		const packageReader = jest.fn().mockResolvedValue(batch);
		const {readNativeProjectPackageAssetPayloads} = await loadAdapter(
			jest.fn(),
			undefined,
			packageReader
		);

		await expect(
			readNativeProjectPackageAssetPayloads(
				'/mock/project',
				baselines,
				packageLimits
			)
		).resolves.toEqual(
			expect.objectContaining({
				payloads: [
					expect.objectContaining({
						path: 'assets/asset.png',
						sha256: 'a'.repeat(64)
					})
				]
			})
		);
		expect(packageReader).toHaveBeenCalledWith(
			'/mock/project',
			baselines.map(baseline => ({...baseline, enforceBaseline: true})),
			packageLimits.maxAssetFileBytes,
			packageLimits.maxAssetFileCount,
			packageLimits.maxAssetTotalBytes
		);
	});

	it('shares admission between package inspection and byte reads', async () => {
		const pendingRead = deferred<typeof batch>();
		const packageReader = jest.fn().mockReturnValue(pendingRead.promise);
		const inspection = {
			failures: [],
			inventory: [{modifiedAtMs: 1, path: 'assets/asset.png', sizeBytes: 3}],
			scannedEntryCount: 1,
			truncated: false
		};
		const packageInspector = jest.fn().mockResolvedValue(inspection);
		const {
			inspectNativeProjectPackageAssets,
			readNativeProjectPackageAssetPayloads
		} = await loadAdapter(
			jest.fn(),
			undefined,
			packageReader,
			packageInspector
		);
		const read = readNativeProjectPackageAssetPayloads(
			'/mock/project',
			baselines,
			packageLimits
		);
		const inspect = inspectNativeProjectPackageAssets('/mock/project');

		await Promise.resolve();
		expect(packageInspector).not.toHaveBeenCalled();
		pendingRead.resolve(batch);
		await expect(read).resolves.toEqual(
			expect.objectContaining({totalSourceBytes: 3})
		);
		await expect(inspect).resolves.toEqual(inspection);
		expect(packageInspector).toHaveBeenCalledWith('/mock/project');
	});
});

describe('captureNativeProjectAssetDigests()', () => {
	beforeEach(() => {
		process.env.TWINE_NATIVE = 'force';
	});

	afterEach(() => {
		delete process.env.TWINE_NATIVE;
	});

	it('uses native hard embedding limits and propagates structured failures', async () => {
		const capture = jest.fn().mockResolvedValue({
			digests: [],
			failures: [{message: 'changed', path: 'assets/a.png', reason: 'changed'}],
			totalSourceBytes: 0
		});
		const {captureNativeProjectAssetDigests} = await loadAdapter(
			jest.fn(),
			capture
		);
		const requests = [
			{
				expectedModifiedAtMs: 1,
				expectedSizeBytes: 3,
				path: 'assets/a.png'
			}
		];

		await expect(
			captureNativeProjectAssetDigests('/mock/project', requests)
		).resolves.toEqual(
			expect.objectContaining({failures: [expect.any(Object)]})
		);
		expect(capture).toHaveBeenCalledWith(
			'/mock/project',
			requests,
			100,
			25 * 1024 * 1024
		);
	});

	it('admits one queued read, rejects a third as busy, and recovers', async () => {
		const digestBatch = {digests: [], failures: [], totalSourceBytes: 0};
		const firstCapture = deferred<typeof digestBatch>();
		const capture = jest
			.fn()
			.mockReturnValueOnce(firstCapture.promise)
			.mockResolvedValueOnce(digestBatch);
		const reader = jest.fn().mockResolvedValue(batch);
		const {
			captureNativeProjectAssetDigests,
			nativeAssetReadBusy,
			nativeAssetReadBusyCode,
			readNativeProjectAssetPayloads
		} = await loadAdapter(reader, capture);
		const request = [
			{
				expectedModifiedAtMs: 1,
				expectedSizeBytes: 3,
				path: 'assets/a.png'
			}
		];
		const first = captureNativeProjectAssetDigests('/mock/project', request);
		const second = captureNativeProjectAssetDigests('/mock/project', request);
		const payload = readNativeProjectAssetPayloads(
			'/mock/project',
			baselines,
			limits
		);

		await Promise.resolve();
		expect(capture).toHaveBeenCalledTimes(1);
		expect(reader).not.toHaveBeenCalled();
		await expect(payload).rejects.toThrow(
			'The referenced-media native reader is busy.'
		);
		await expect(payload).rejects.toMatchObject({
			code: nativeAssetReadBusyCode
		});
		await payload.catch(error => expect(nativeAssetReadBusy(error)).toBe(true));
		firstCapture.resolve(digestBatch);
		await expect(first).resolves.toEqual(digestBatch);
		await expect(second).resolves.toEqual(digestBatch);
		expect(capture).toHaveBeenCalledTimes(2);
		await expect(
			readNativeProjectAssetPayloads('/mock/project', baselines, limits)
		).resolves.toEqual(expect.objectContaining({totalSourceBytes: 3}));
		expect(reader).toHaveBeenCalledTimes(1);
	});

	it('releases admission after queued work rejects', async () => {
		const digestBatch = {digests: [], failures: [], totalSourceBytes: 0};
		const firstCapture = deferred<typeof digestBatch>();
		const capture = jest
			.fn()
			.mockReturnValueOnce(firstCapture.promise)
			.mockRejectedValueOnce(new Error('Queued capture failed.'))
			.mockResolvedValueOnce(digestBatch);
		const {captureNativeProjectAssetDigests} = await loadAdapter(
			jest.fn(),
			capture
		);
		const requests = [
			{
				expectedModifiedAtMs: 1,
				expectedSizeBytes: 3,
				path: 'assets/a.png'
			}
		];
		const first = captureNativeProjectAssetDigests('/mock/project', requests);
		const queued = captureNativeProjectAssetDigests('/mock/project', requests);

		firstCapture.resolve(digestBatch);
		await expect(first).resolves.toEqual(digestBatch);
		await expect(queued).rejects.toThrow('Queued capture failed.');
		await expect(
			captureNativeProjectAssetDigests('/mock/project', requests)
		).resolves.toEqual(digestBatch);
		expect(capture).toHaveBeenCalledTimes(3);
	});
});
