import {
	configureWasmWorkerForTest,
	handleWasmWorkerRequestForTest,
	refactorPlanningTaskOwnerCountForTest
} from '../wasm/twine-wasm-worker';
import type {WasmWorkerRequest} from '../wasm/twine-wasm-protocol';

class TestSession {
	static beginCalls = 0;
	static lifecycleCalls: string[] = [];
	private currentRevision = 1;

	constructor() {}

	free() {
		TestSession.lifecycleCalls.push('free');
	}

	set_revision(revision: number) {
		this.currentRevision = revision;
	}

	set_asset_inventory() {}

	status() {
		return {
			canRedo: false,
			canUndo: false,
			dirty: false,
			redoKind: null,
			revision: this.currentRevision,
			undoKind: null
		};
	}

	revision() {
		return this.currentRevision;
	}

	performance_diagnostics() {
		return {};
	}

	sync_refactor_runtime() {}

	begin_passage_rename_plan() {
		TestSession.beginCalls++;
		return {task: {taskId: 'task-1'}, type: 'begun'};
	}

	continue_passage_rename_plan() {
		return {
			progress: {scannedPassageCount: 64, totalPassageCount: 129},
			task: {taskId: 'task-1'},
			type: 'pending'
		};
	}

	cancel_passage_rename_plan() {
		TestSession.lifecycleCalls.push('cancel');
		return true;
	}

	apply_refactor_plan() {
		return {
			failure: {code: 'invalid-selection', message: 'test failure'},
			type: 'failure'
		};
	}

	query_refactor_plan_detail() {
		return {page: {changes: []}, type: 'page'};
	}

	apply() {
		this.currentRevision++;
		return {label: 'unrelated mutation', patches: [], transactionId: 1n};
	}
}

class TestBootstrap {
	constructor() {}
	append_passages() {}
	finish() {
		return new TestSession();
	}
	free() {}
}

describe('WASM worker refactor cancellation', () => {
	beforeEach(() => {
		TestSession.beginCalls = 0;
		TestSession.lifecycleCalls = [];
		configureWasmWorkerForTest({
			BootstrapConstructor: TestBootstrap as never,
			SessionConstructor: TestSession as never
		});
	});

	afterEach(() => {
		configureWasmWorkerForTest({reset: true});
	});

	it('cancels the current session after a pending chunk and an unrelated revision change', async () => {
		const request = (value: unknown) =>
			handleWasmWorkerRequestForTest({
				...(value as object),
				id: 1
			} as WasmWorkerRequest);
		await request({
			assets: [],
			kind: 'replaceProject',
			revision: 1,
			sessionId: 'refactor-cancel',
			snapshot: {stories: []}
		});
		const synced = await request({
			kind: 'syncRefactorRuntime',
			revision: 1,
			runtime: {
				buffers: [],
				external: null,
				projectRevision: 1,
				provider: null
			},
			sessionId: 'refactor-cancel'
		});
		const epoch = (synced as any).result.refactorRuntimeEpoch;
		expect((synced as any).metrics).toEqual(
			expect.objectContaining({
				rustFinishedAtEpochMs: expect.any(Number),
				rustStartedAtEpochMs: expect.any(Number)
			})
		);
		const begun = await request({
			kind: 'beginPassageRenamePlan',
			refactorRuntimeEpoch: epoch,
			request: {afterName: 'Renamed', passageId: 'target', storyId: 'story'},
			revision: 1,
			sessionId: 'refactor-cancel'
		});
		expect((begun as any).metrics).toEqual(
			expect.objectContaining({
				rustFinishedAtEpochMs: expect.any(Number),
				rustStartedAtEpochMs: expect.any(Number)
			})
		);
		const task = (begun as any).result.task;
		const continued = await request({
			kind: 'continuePassageRenamePlan',
			sessionId: 'refactor-cancel',
			task
		});
		expect((continued as any).metrics).toEqual(
			expect.objectContaining({
				rustFinishedAtEpochMs: expect.any(Number),
				rustStartedAtEpochMs: expect.any(Number)
			})
		);
		const resynced = await request({
			kind: 'syncRefactorRuntime',
			revision: 1,
			runtime: {
				buffers: [],
				external: null,
				projectRevision: 1,
				provider: null
			},
			sessionId: 'refactor-cancel'
		});
		await request({
			command: {type: 'batch', commands: []},
			history: 'record',
			kind: 'apply',
			revision: 1,
			sessionId: 'refactor-cancel'
		});

		const cancelled = await request({
			kind: 'cancelPassageRenamePlan',
			sessionId: 'refactor-cancel',
			task
		});
		expect(cancelled).toMatchObject({ok: true, result: {cancelled: true}});
		expect((cancelled as any).metrics).toEqual(
			expect.objectContaining({
				rustFinishedAtEpochMs: expect.any(Number),
				rustStartedAtEpochMs: expect.any(Number)
			})
		);
		const applied = await request({
			applyRequest: {
				expectedProjectRevision: 2,
				planId: 'plan-1',
				selection: {type: 'all'}
			},
			kind: 'applyRefactorPlan',
			refactorRuntimeEpoch: (resynced as any).result.refactorRuntimeEpoch,
			revision: 2,
			sessionId: 'refactor-cancel'
		});
		expect((applied as any).metrics).toEqual(
			expect.objectContaining({
				rustFinishedAtEpochMs: expect.any(Number),
				rustStartedAtEpochMs: expect.any(Number)
			})
		);
		const detail = await request({
			cursor: {planId: 'plan-1'},
			kind: 'queryRefactorPlanDetail',
			revision: 2,
			sessionId: 'refactor-cancel'
		});
		expect((detail as any).metrics).toEqual(
			expect.objectContaining({
				rustFinishedAtEpochMs: expect.any(Number),
				rustStartedAtEpochMs: expect.any(Number)
			})
		);
	});

	it('keeps pending tasks session-owned across runtime sync and replacement', async () => {
		const request = (value: unknown) =>
			handleWasmWorkerRequestForTest({
				...(value as object),
				id: 1
			} as WasmWorkerRequest);
		const sessionId = 'planner-owner';
		await request({
			assets: [],
			kind: 'replaceProject',
			revision: 1,
			sessionId,
			snapshot: {stories: []}
		});
		const synced = await request({
			kind: 'syncRefactorRuntime',
			revision: 1,
			runtime: {
				buffers: [],
				external: null,
				projectRevision: 1,
				provider: null
			},
			sessionId
		});
		const begun = await request({
			kind: 'beginPassageRenamePlan',
			refactorRuntimeEpoch: (synced as any).result.refactorRuntimeEpoch,
			request: {afterName: 'Renamed', passageId: 'target', storyId: 'story'},
			revision: 1,
			sessionId
		});
		const task = (begun as any).result.task;
		expect(refactorPlanningTaskOwnerCountForTest()).toBe(1);
		await request({
			kind: 'syncRefactorRuntime',
			revision: 1,
			runtime: {
				buffers: [],
				external: null,
				projectRevision: 1,
				provider: {
					capabilityRevision: 2,
					formatVersion: '1',
					identifier: 'provider'
				}
			},
			sessionId
		});
		expect(
			await request({kind: 'continuePassageRenamePlan', sessionId, task})
		).toMatchObject({
			ok: true,
			result: {type: 'pending'}
		});
		await request({
			assets: [],
			kind: 'replaceProject',
			revision: 1,
			sessionId,
			snapshot: {stories: []}
		});
		expect(refactorPlanningTaskOwnerCountForTest()).toBe(0);
		expect(
			await request({kind: 'continuePassageRenamePlan', sessionId, task})
		).toMatchObject({
			ok: true,
			result: {type: 'cancelled'}
		});
		expect(
			await request({kind: 'cancelPassageRenamePlan', sessionId, task})
		).toMatchObject({
			ok: true,
			result: {cancelled: false}
		});
		expect(
			await request({
				kind: 'continuePassageRenamePlan',
				sessionId: 'missing',
				task
			})
		).toMatchObject({
			ok: true,
			result: {type: 'cancelled'}
		});
		expect(
			await request({
				kind: 'cancelPassageRenamePlan',
				sessionId: 'missing',
				task
			})
		).toMatchObject({
			ok: true,
			result: {cancelled: false}
		});
		const nextSync = await request({
			kind: 'syncRefactorRuntime',
			revision: 1,
			runtime: {
				buffers: [],
				external: null,
				projectRevision: 1,
				provider: null
			},
			sessionId
		});
		expect(
			await request({
				kind: 'beginPassageRenamePlan',
				refactorRuntimeEpoch: (nextSync as any).result.refactorRuntimeEpoch,
				request: {afterName: 'Later', passageId: 'target', storyId: 'story'},
				revision: 1,
				sessionId
			})
		).toMatchObject({ok: true, result: {type: 'begun'}});
		expect(refactorPlanningTaskOwnerCountForTest()).toBe(1);
		await request({kind: 'removeSession', sessionId});
		expect(refactorPlanningTaskOwnerCountForTest()).toBe(0);
		expect(TestSession.lifecycleCalls.slice(-2)).toEqual(['cancel', 'free']);
	});

	it('frees a failed partial bootstrap without replacing its valid session', async () => {
		const request = (value: unknown) =>
			handleWasmWorkerRequestForTest({
				...(value as object),
				id: 1
			} as WasmWorkerRequest);
		const sessionId = 'partial-bootstrap';
		await request({
			assets: [],
			kind: 'replaceProject',
			revision: 1,
			sessionId,
			snapshot: {stories: []}
		});
		await request({
			assets: [],
			kind: 'beginProjectBootstrap',
			revision: 2,
			sessionId,
			snapshot: {stories: []}
		});
		expect(
			await request({kind: 'abortProjectBootstrap', sessionId})
		).toMatchObject({
			ok: true,
			result: {aborted: true}
		});
		expect(
			await request({kind: 'status', revision: 1, sessionId})
		).toMatchObject({ok: true, result: {revision: 1}});
		expect(
			await request({
				assets: [],
				kind: 'beginProjectBootstrap',
				revision: 2,
				sessionId,
				snapshot: {stories: []}
			})
		).toMatchObject({ok: true, result: {accepted: true}});
	});

	it('rejects an oversized UTF-8 planner request before calling WASM', async () => {
		const request = (value: unknown) =>
			handleWasmWorkerRequestForTest({
				...(value as object),
				id: 1
			} as WasmWorkerRequest);
		const response = await request({
			kind: 'beginPassageRenamePlan',
			refactorRuntimeEpoch: 0,
			request: {
				afterName: '😀'.repeat(16_383) + 'abc',
				passageId: 'p',
				storyId: 's'
			},
			revision: 1,
			sessionId: 'missing-session'
		});
		expect(response).toMatchObject({
			ok: true,
			result: {failure: {code: 'plan-too-large'}, type: 'failure'}
		});
		expect(TestSession.beginCalls).toBe(0);
	});

	it('reports worker JS heap at the response boundary and releases the probe owner', async () => {
		const request = (value: unknown) =>
			handleWasmWorkerRequestForTest({
				...(value as object),
				id: 1
			} as WasmWorkerRequest);
		const originalMemory = (performance as Performance & {memory?: unknown})
			.memory;

		Object.defineProperty(performance, 'memory', {
			configurable: true,
			value: {usedJSHeapSize: 12_345}
		});
		try {
			const retained = await request({
				action: 'retain',
				bytes: 1024 * 1024,
				kind: 'performanceProbeWorkerJs'
			});
			expect(retained).toMatchObject({
				metrics: {workerJsHeapUsedBytes: 12_345},
				ok: true,
				result: {allocatedBytes: 1024 * 1024, retained: true}
			});

			const released = await request({
				action: 'release',
				kind: 'performanceProbeWorkerJs'
			});
			expect(released).toMatchObject({
				ok: true,
				result: {allocatedBytes: 0, retained: false}
			});
		} finally {
			Object.defineProperty(performance, 'memory', {
				configurable: true,
				value: originalMemory
			});
		}
	});
});
