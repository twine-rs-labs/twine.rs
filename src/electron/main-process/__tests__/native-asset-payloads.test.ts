const limits = {
	maxFileBytes: 100,
	maxFileCount: 2,
	maxTotalEncodedBytes: 200
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

async function loadAdapter(reader: jest.Mock) {
	const nativeRequire = jest.fn().mockReturnValue({
		readProjectAssetPayloads: reader
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

	it('rejects a concurrent read and releases admission after success', async () => {
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

		await expect(
			readNativeProjectAssetPayloads('/mock/project', baselines, limits)
		).rejects.toThrow(
			'A referenced-media payload read is already in progress.'
		);
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
					sizeBytes: 3
				}
			]
		});
		await expect(
			readNativeProjectAssetPayloads('/mock/project', baselines, limits)
		).resolves.toEqual(expect.objectContaining({totalSourceBytes: 3}));
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
