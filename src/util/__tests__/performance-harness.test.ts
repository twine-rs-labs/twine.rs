import * as core from '../../core';
import {
	installPerformanceHarness,
	type TwinePerformanceWindow
} from '../performance-harness';

function deferred<T>() {
	let reject!: (error: Error) => void;
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return {promise, reject, resolve};
}

function workerMetric(kind: 'planDiagnosticFixes' | 'queryRefactorPlanDetail') {
	return {
		kind,
		wasmMemoryBytes: 456,
		workerRespondedAtEpochMs: 123
	} as any;
}

describe('performance harness model commits', () => {
	let harnessWindow: TwinePerformanceWindow;
	let native: NonNullable<TwinePerformanceWindow['twinePerformanceNative']>;
	let performanceHarness: jest.SpyInstance;

	beforeEach(() => {
		harnessWindow = window as TwinePerformanceWindow;
		native = {
			checkpoint: jest.fn(() => Promise.resolve()),
			collectGarbage: jest.fn(() => Promise.resolve()),
			reconcileProjectSession: jest.fn(),
			reset: jest.fn(() => Promise.resolve()),
			snapshot: jest.fn(() => Promise.resolve({}))
		};
		harnessWindow.twinePerformanceNative = native;
		performanceHarness = jest.spyOn(core, 'coreProjectHostPerformanceHarness');
	});

	afterEach(() => {
		performanceHarness.mockRestore();
		delete harnessWindow.twinePerformance;
		delete harnessWindow.twinePerformanceNative;
	});

	it('starts the deferred checkpoint at the exact worker response tuple', async () => {
		const modelCommit = deferred<any>();
		const checkpoint = deferred<void>();
		const applyModelCommit = jest.fn((...args: unknown[]) => {
			void args;
			return modelCommit.promise;
		});
		(native.checkpoint as jest.Mock).mockReturnValue(checkpoint.promise);
		performanceHarness.mockReturnValue({applyModelCommit});
		installPerformanceHarness();

		const operation = harnessWindow.twinePerformance!.refactor.applyModelCommit(
			'story-a',
			{
				expectedProjectRevision: 1,
				planId: 'plan-a',
				selection: {type: 'all'}
			},
			'worker-response'
		);
		const options = applyModelCommit.mock.calls[0]?.[2] as
			{onWorkerMetric?: (metric: Record<string, unknown>) => void} | undefined;
		expect(options?.onWorkerMetric).toEqual(expect.any(Function));
		options!.onWorkerMetric!({
			kind: 'applyRefactorPlan',
			wasmMemoryBytes: 456,
			workerRespondedAtEpochMs: 123
		});

		expect(native.checkpoint).toHaveBeenCalledWith(
			'worker-response',
			expect.objectContaining({
				workerResponseAtEpochMs: 123,
				workerWasmMemoryBytes: 456
			})
		);
		modelCommit.resolve({type: 'failure'});
		await operation.result;
		checkpoint.resolve();
		await operation.workerResponseCheckpoint;
	});

	it('rejects the checkpoint when the model commit settles without a worker response', async () => {
		performanceHarness.mockReturnValue({
			applyModelCommit: jest.fn(() => Promise.resolve({type: 'failure'}))
		});
		installPerformanceHarness();

		const operation = harnessWindow.twinePerformance!.refactor.applyModelCommit(
			'story-a',
			{
				expectedProjectRevision: 1,
				planId: 'plan-a',
				selection: {type: 'all'}
			},
			'worker-response'
		);
		const checkpoint = expect(
			operation.workerResponseCheckpoint
		).rejects.toThrow('was never observed');

		await operation.result;
		await checkpoint;
	});
});

describe('performance harness refactor plans', () => {
	let harnessWindow: TwinePerformanceWindow;
	let native: NonNullable<TwinePerformanceWindow['twinePerformanceNative']>;
	let performanceHarness: jest.SpyInstance;

	beforeEach(() => {
		harnessWindow = window as TwinePerformanceWindow;
		native = {
			checkpoint: jest.fn(() => Promise.resolve()),
			collectGarbage: jest.fn(() => Promise.resolve()),
			reconcileProjectSession: jest.fn(),
			reset: jest.fn(() => Promise.resolve()),
			snapshot: jest.fn(() => Promise.resolve({}))
		};
		harnessWindow.twinePerformanceNative = native;
		performanceHarness = jest.spyOn(core, 'coreProjectHostPerformanceHarness');
	});

	afterEach(() => {
		performanceHarness.mockRestore();
		delete harnessWindow.twinePerformance;
		delete harnessWindow.twinePerformanceNative;
	});

	it('settles the terminal native checkpoint after the completed plan result', async () => {
		const firstCheckpoint = deferred<void>();
		const checkpoint = deferred<void>();
		const complete = {
			summary: {planId: 'plan-a'},
			type: 'complete'
		} as any;
		(native.checkpoint as jest.Mock)
			.mockReturnValueOnce(firstCheckpoint.promise)
			.mockReturnValueOnce(checkpoint.promise);
		performanceHarness.mockReturnValue({
			planProjectReplace: jest.fn(async (_storyId, _request, options) => {
				await options.onProgress({type: 'pending'});
				await options.onProgress(complete);
				return complete;
			})
		});
		installPerformanceHarness();

		const operation = harnessWindow.twinePerformance!.refactor.plan(
			'story-a',
			{} as any
		);
		expect(native.checkpoint).toHaveBeenCalledWith(
			'refactor-plan-high-water',
			expect.any(Object)
		);
		let resultSettled = false;
		void operation.result.then(() => {
			resultSettled = true;
		});
		await Promise.resolve();
		expect(resultSettled).toBe(false);

		firstCheckpoint.resolve();
		await expect(operation.result).resolves.toBe(complete);
		expect(native.checkpoint).toHaveBeenCalledWith(
			'refactor-plan-high-water',
			expect.any(Object)
		);
		let settled = false;
		void operation.terminalCheckpoint.then(() => {
			settled = true;
		});
		await Promise.resolve();
		expect(settled).toBe(false);

		checkpoint.resolve();
		await expect(operation.terminalCheckpoint).resolves.toBeUndefined();
	});

	it('settles without a terminal checkpoint when the plan is cancelled', async () => {
		performanceHarness.mockReturnValue({
			planProjectReplace: jest.fn(() =>
				Promise.resolve({type: 'cancelled'} as any)
			)
		});
		installPerformanceHarness();

		const operation = harnessWindow.twinePerformance!.refactor.plan(
			'story-a',
			{} as any
		);
		await expect(operation.result).resolves.toEqual({type: 'cancelled'});
		await expect(operation.terminalCheckpoint).resolves.toBeUndefined();
		expect(native.checkpoint).not.toHaveBeenCalled();
	});
});

describe('performance harness diagnostic-fix observations', () => {
	let harnessWindow: TwinePerformanceWindow;
	let native: NonNullable<TwinePerformanceWindow['twinePerformanceNative']>;
	let performanceHarness: jest.SpyInstance;

	beforeEach(() => {
		harnessWindow = window as TwinePerformanceWindow;
		native = {
			checkpoint: jest.fn(() => Promise.resolve()),
			collectGarbage: jest.fn(() => Promise.resolve()),
			reconcileProjectSession: jest.fn(),
			reset: jest.fn(() => Promise.resolve()),
			snapshot: jest.fn(() => Promise.resolve({}))
		};
		harnessWindow.twinePerformanceNative = native;
		performanceHarness = jest.spyOn(core, 'coreProjectHostPerformanceHarness');
		core.resetCoreBridgeMetrics();
	});

	afterEach(() => {
		performanceHarness.mockRestore();
		core.resetCoreBridgeMetrics();
		delete harnessWindow.twinePerformance;
		delete harnessWindow.twinePerformanceNative;
	});

	it('captures diagnostic planning at the exact worker response without delaying its result', async () => {
		const planning = deferred<any>();
		const checkpoint = deferred<void>();
		const onWorkerMetric = jest.fn();
		const planDiagnosticFixes = jest.fn((...args: unknown[]) => {
			void args;
			return planning.promise;
		});
		(native.checkpoint as jest.Mock).mockReturnValue(checkpoint.promise);
		performanceHarness.mockReturnValue({planDiagnosticFixes});
		installPerformanceHarness();

		const operation =
			harnessWindow.twinePerformance!.refactor.planDiagnosticFixesObserved(
				'story-a',
				{} as any,
				'm4-plan-high-water',
				{onWorkerMetric}
			);
		const options = planDiagnosticFixes.mock.calls[0]?.[2] as
			{onWorkerMetric?: (metric: Record<string, unknown>) => void} | undefined;
		const metric = workerMetric('planDiagnosticFixes');
		options!.onWorkerMetric!(metric);
		planning.resolve({type: 'failure'});

		await expect(operation.result).resolves.toEqual({type: 'failure'});
		expect(onWorkerMetric).toHaveBeenCalledWith(metric);
		expect(native.checkpoint).toHaveBeenCalledWith(
			'm4-plan-high-water',
			expect.objectContaining({
				workerResponseAtEpochMs: 123,
				workerWasmMemoryBytes: 456
			})
		);
		let checkpointSettled = false;
		void operation.workerResponseCheckpoint.then(() => {
			checkpointSettled = true;
		});
		await Promise.resolve();
		expect(checkpointSettled).toBe(false);
		checkpoint.resolve();
		await expect(operation.workerResponseCheckpoint).resolves.toBeUndefined();
	});

	it('captures detail DTO delivery from its new bridge response', async () => {
		const detail = deferred<any>();
		const checkpoint = deferred<void>();
		performanceHarness.mockReturnValue({
			queryRefactorPlanDetailAsync: jest.fn(() => detail.promise)
		});
		(native.checkpoint as jest.Mock).mockReturnValue(checkpoint.promise);
		installPerformanceHarness();

		const operation = harnessWindow.twinePerformance!.refactor.detailObserved(
			'story-a',
			{} as any,
			'm4-detail-high-water'
		);
		core.recordCoreBridgeMetric(workerMetric('queryRefactorPlanDetail'));
		detail.resolve({type: 'failure'});

		await expect(operation.result).resolves.toEqual({type: 'failure'});
		expect(native.checkpoint).toHaveBeenCalledWith(
			'm4-detail-high-water',
			expect.objectContaining({
				workerResponseAtEpochMs: 123,
				workerWasmMemoryBytes: 456
			})
		);
		checkpoint.resolve();
		await expect(operation.workerResponseCheckpoint).resolves.toBeUndefined();
	});

	it('rejects a detail checkpoint without a new response metric', async () => {
		performanceHarness.mockReturnValue({
			queryRefactorPlanDetailAsync: jest.fn(() =>
				Promise.resolve({type: 'failure'})
			)
		});
		installPerformanceHarness();

		const operation = harnessWindow.twinePerformance!.refactor.detailObserved(
			'story-a',
			{} as any,
			'm4-detail-high-water'
		);

		await operation.result;
		await expect(operation.workerResponseCheckpoint).rejects.toThrow(
			'did not observe a new detail response'
		);
	});
});
