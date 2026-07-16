import {join} from 'path';
import {tmpdir} from 'os';

jest.mock('electron');

describe('Electron performance harness isolation', () => {
	const originalEnabled = process.env.TWINE_PERF;
	const originalUserData = process.env.TWINE_PERF_USER_DATA;
	const loadHarness = () => {
		let result: typeof import('../performance-harness') | undefined;

		jest.isolateModules(() => {
			result = jest.requireActual<typeof import('../performance-harness')>(
				'../performance-harness'
			);
		});
		return result!;
	};

	afterEach(() => {
		jest.resetModules();
		if (originalEnabled === undefined) {
			delete process.env.TWINE_PERF;
		} else {
			process.env.TWINE_PERF = originalEnabled;
		}
		if (originalUserData === undefined) {
			delete process.env.TWINE_PERF_USER_DATA;
		} else {
			process.env.TWINE_PERF_USER_DATA = originalUserData;
		}
	});

	it('does not expose a user-data override outside perf mode', () => {
		delete process.env.TWINE_PERF;
		delete process.env.TWINE_PERF_USER_DATA;

		const harness = loadHarness();

		expect(harness.performanceHarnessEnabled()).toBe(false);
		expect(harness.performanceHarnessUserDataPath()).toBeUndefined();
		expect(harness.performanceHarnessSessionDataPath()).toBeUndefined();
	});

	it('requires perf user data to be an absolute temporary path', () => {
		process.env.TWINE_PERF = '1';
		delete process.env.TWINE_PERF_USER_DATA;

		const harness = loadHarness();

		expect(() => harness.performanceHarnessUserDataPath()).toThrow(
			'TWINE_PERF_USER_DATA'
		);
	});

	it('accepts an isolated path inside the system temp folder', () => {
		const userData = join(tmpdir(), 'twine-rs-perf-test', 'user-data');

		process.env.TWINE_PERF = '1';
		process.env.TWINE_PERF_USER_DATA = userData;

		const harness = loadHarness();

		expect(harness.performanceHarnessEnabled()).toBe(true);
		expect(harness.performanceHarnessUserDataPath()).toBe(userData);
		expect(harness.performanceHarnessSessionDataPath()).toBe(
			join(userData, 'session')
		);
	});

	it('records correlated watcher trace stages only in perf mode', () => {
		process.env.TWINE_PERF = '1';
		process.env.TWINE_PERF_USER_DATA = join(
			tmpdir(),
			'twine-rs-perf-test',
			'user-data'
		);
		const harness = loadHarness();

		harness.resetMainPerformanceHarness();
		harness.recordWatcherTraceEvent({
			deltaId: 'delta-1',
			rootPath: '/tmp/project.twine.rs',
			stage: 'watcher-observed',
			timeEpochMs: 100
		});
		harness.recordWatcherTraceEvent({
			deltaId: 'delta-1',
			rootPath: '/tmp/project.twine.rs',
			stage: 'scan-started',
			timeEpochMs: 250
		});

		expect(harness.mainPerformanceHarnessSnapshot().watcherTraceEvents).toEqual(
			[
				expect.objectContaining({
					deltaId: 'delta-1',
					stage: 'watcher-observed',
					timeEpochMs: 100
				}),
				expect.objectContaining({
					deltaId: 'delta-1',
					stage: 'scan-started',
					timeEpochMs: 250
				})
			]
		);
	});

	it('includes native private memory in snapshots', () => {
		process.env.TWINE_PERF = '1';
		process.env.TWINE_PERF_USER_DATA = join(
			tmpdir(),
			'twine-rs-perf-test',
			'user-data'
		);
		const harness = loadHarness();
		const processMemory = {private: 120, residentSet: 140, shared: 20};

		expect(
			harness.mainPerformanceHarnessSnapshot(processMemory).processMemory
		).toEqual(processMemory);
	});
});
