import {render, renderHook, waitFor} from '@testing-library/react';
import * as React from 'react';
import {
	bootstrapStory,
	CoreAssetInventoryEntry,
	deleteStoryCommand,
	metadataStory,
	movePassagesCommand,
	PatchBatch,
	queryGraphProjectionCommand,
	registerStoryDocuments,
	renameStoryTagCommand,
	renameStoryCommand,
	replaceStoryCommand,
	setStoryFormatCommand,
	setStorySnapToGridCommand,
	setStoryZoomCommand,
	StoryCommand,
	updatePassageTextCommand,
	updateStoryScriptCommand,
	updateStoryStylesheetCommand
} from '..';
import {
	knownAssetInventoryForStory,
	replaceKnownAssetInventoryForStory,
	applyStoryTagRenameAcrossHosts,
	coreProjectHostPerformanceSnapshot,
	CoreProjectHost,
	CoreProjectHostContext,
	CoreProjectHostProvider,
	ProjectScopedCoreProjectHost,
	StoreCoreProjectHost,
	useCoreProjectHost,
	useCoreProjectSession
} from '../project-host';
import {reducer as storiesReducer} from '../../store/stories/reducer';
import {
	StoriesContext,
	StoriesState,
	StoryWithDocuments
} from '../../store/stories';
import {StoriesActionOrThunk} from '../../store/stories';
import {markProjectStoryHydration} from '../../store/project-hydration';
import {
	deleteProjectMetadata,
	saveProjectMetadata
} from '../../store/project-metadata';
import {fakePassage, fakeStory} from '../../test-util';
import {createTestCoreSessionClient} from '../../test-util/test-core-session-client';
import {PersistenceQuitCoordinator} from '../../store/persistence/electron-ipc/persistence-quit-coordinator';
import {
	bindPersistenceCompletion,
	rejectPersistenceCompletion
} from '../../store/persistence/completion';
import {saveMiddleware as saveLocalStories} from '../../store/persistence/local-storage/stories/save-middleware';
import {load as loadLocalStories} from '../../store/persistence/local-storage/stories/load';
import {saveMiddleware as saveElectronStories} from '../../store/persistence/electron-ipc/stories/save-middleware';
import {load as loadElectronStories} from '../../store/persistence/electron-ipc/stories/load';
import {TwineElectronWindow} from '../../electron/shared';
import {ProjectFolderSaveOptions} from '../../store/persistence/project-folder-save-hints';
import {
	doUpdateTransaction,
	savePassage,
	saveStory
} from '../../store/persistence/local-storage/stories/save';
import {
	readStorageManifest,
	readStoredPassageTexts,
	storageManifestKey
} from '../../store/persistence/local-storage/stories/storage';
import {workbenchBufferCoordinator} from '../../util/workbench-buffer-coordinator';
import * as rendererPerformance from '../../util/performance';
import {rendererQuitQuiescence} from '../../util/renderer-quit-quiescence';
import {MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1} from '../refactor-limits';
import type {PlanDiagnosticFixesRequest} from '../bindings/PlanDiagnosticFixesRequest';

describe('StoreCoreProjectHost asset commands', () => {
	function batch(patches: PatchBatch['patches'], label = 'Rust Command') {
		return {
			label,
			patches,
			transactionId: BigInt(1)
		};
	}

	function asset(path: string): CoreAssetInventoryEntry {
		return {
			durationMs: null,
			exists: true,
			height: null,
			kind: 'image',
			missing: false,
			modifiedAt: null,
			normalizedPath: path,
			path,
			previewUrl: null,
			publish: {
				copy: true,
				outputPath: path,
				reason: 'Copy asset into published output'
			},
			referenceCount: 0,
			references: [],
			sizeBytes: null,
			snippet: {
				label: path,
				mediaType: 'image/png',
				text: `<img src="${path}" alt="">`
			},
			thumbnailUrl: null,
			unused: true,
			width: null
		};
	}

	function fakeWasmClient(
		apply: (command: StoryCommand, revision: number) => Promise<PatchBatch>
	) {
		const status = (revision: number) => ({
			canRedo: false,
			canUndo: true,
			dirty: true,
			redoKind: null,
			revision,
			undoKind: 'editPassage' as const
		});

		return {
			acknowledgeSaved: jest.fn(),
			apply: jest.fn(
				async (
					_sessionId: string,
					command: StoryCommand,
					revision: number
				) => ({
					batch: await apply(command, revision),
					revision: revision + 1,
					status: status(revision + 1)
				})
			),
			applyRefactorPlan: jest.fn(),
			planDiagnosticFixes: jest.fn(),
			beginPassageRenamePlan: jest.fn(),
			beginProjectReplacePlan: jest.fn(),
			beginProjectBootstrap: jest.fn(),
			appendProjectBootstrap: jest.fn(),
			abortProjectBootstrap: jest.fn(),
			cancelPassageRenamePlan: jest.fn(),
			cancelProjectReplacePlan: jest.fn(),
			continuePassageRenamePlan: jest.fn(),
			continueProjectReplacePlan: jest.fn(),
			syncRefactorRuntime: jest.fn(),
			cachedGraphProjection: jest.fn(),
			cachedStoryIndex: jest.fn(),
			enabled: true,
			lastGraphProjection: jest.fn(),
			ingestExternalDelta: jest.fn(),
			mode: 'wasm-worker',
			queryGraphProjection: jest.fn(),
			queryStoryIndex: jest.fn(),
			redo: jest.fn(),
			finishProjectBootstrap: jest.fn(),
			replaceProject: jest.fn().mockResolvedValue(undefined),
			undo: jest.fn()
		};
	}

	it('returns external conflicts without dispatching a patch batch', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		wasmClient.ingestExternalDelta.mockResolvedValue({
			batch: null,
			conflicts: [
				{
					field: 'passage:story:start:text',
					message: 'changed locally and on disk',
					passageId: 'start',
					path: null,
					storyId: 'story'
				}
			],
			historyRecorded: false,
			outcome: 'conflict',
			revision: 1,
			status: {
				canRedo: false,
				canUndo: false,
				dirty: true,
				redoKind: null,
				revision: 1,
				undoKind: null
			}
		});
		const context = hostWithStory({wasmClient});
		const result = await context.host.ingestExternalDelta(context.story.id, {
			changes: [],
			id: 'disk-change'
		});

		expect(result.outcome).toBe('conflict');
		expect(context.dispatch).not.toHaveBeenCalled();
		expect(wasmClient.ingestExternalDelta).toHaveBeenCalledWith(
			'library',
			{changes: [], id: 'disk-change'},
			1,
			undefined
		);
	});

	it('marks the scoped worker response and patch dispatch for a mutation token', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const previousNative = (window as any).twinePerformanceNative;
		const mark = jest.spyOn(rendererPerformance, 'markPerformance');

		(window as any).twinePerformanceNative = {};
		rendererPerformance.resetRendererPerformance();
		try {
			await context.host.applyStoryCommand(
				updatePassageTextCommand(context.story.id, context.start.id, 'updated')
			);
			const event = rendererPerformance
				.performanceEventSnapshot()
				.find(candidate => candidate.name === 'mutation-applied');
			const token = event?.detail?.performanceToken;

			if (typeof token !== 'string') {
				throw new Error('Mutation event did not carry a performance token.');
			}
			for (const name of [
				`mutation-submit-${token}`,
				`mutation-worker-response-${token}`,
				`mutation-patch-dispatch-${token}`
			]) {
				expect(mark).toHaveBeenCalledWith(name);
			}
		} finally {
			mark.mockRestore();
			rendererPerformance.resetRendererPerformance();
			(window as any).twinePerformanceNative = previousNative;
		}
	});

	it('applies external disk patches without scheduling frontend persistence', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});

		wasmClient.ingestExternalDelta.mockResolvedValue({
			batch: batch([
				{
					changes: {
						layout: null,
						name: null,
						tags: null,
						text: 'from disk'
					},
					passage_id: 'start',
					story_id: context.story.id,
					type: 'passageUpdated'
				}
			]),
			conflicts: [],
			historyRecorded: true,
			outcome: 'applied',
			revision: 2,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: false,
				redoKind: null,
				revision: 2,
				undoKind: 'externalChanges'
			}
		});

		await context.host.ingestExternalDelta(context.story.id, {
			changes: [],
			id: 'disk-change'
		});

		expect(context.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				persistence: 'skip',
				type: 'applyCorePatchBatch'
			}),
			'undoChange.externalChanges'
		);
	});

	it('rejects refactor apply when a buffer changes during runtime synchronization', async () => {
		const order: string[] = [];
		let bufferRevision = 5;
		let syncCount = 0;
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		wasmClient.syncRefactorRuntime = jest.fn(
			async (
				_sessionId: string,
				runtime: {buffers: Array<{bufferId: string; registrationId: string}>}
			) => {
				expect(runtime.buffers).toEqual([
					expect.objectContaining({
						bufferId: 'passage:start',
						registrationId: expect.stringContaining('buffer-registration-')
					})
				]);
				if (syncCount++ === 0) bufferRevision++;
				return syncCount;
			}
		);
		wasmClient.applyRefactorPlan = jest.fn(
			async (_sessionId: string, _request: unknown, epoch: number) => {
				order.push('wasm');
				expect(epoch).toBe(2);
				return {
					batch: batch([
						{
							changes: {
								layout: null,
								name: null,
								tags: null,
								text: 'after refactor'
							},
							passage_id: 'start',
							story_id: context.story.id,
							type: 'passageUpdated'
						}
					]),
					revision: 2,
					status: {
						canRedo: false,
						canUndo: true,
						dirty: true,
						redoKind: null,
						revision: 2,
						undoKind: 'refactor'
					},
					type: 'applied'
				};
			}
		);
		const unregister = workbenchBufferCoordinator.register({
			bufferId: 'passage:start',
			closeAdmission: () => {
				order.push('close');
			},
			flush: () => {
				order.push('flush');
			},
			hasPendingChanges: () => false,
			reopenAdmission: () => {
				order.push('reopen');
			},
			revision: () => bufferRevision,
			storyId: context.story.id
		});

		try {
			await expect(
				context.host.applyRefactorPlan(context.story.id, {
					expectedProjectRevision: 1,
					planId: 'plan-1',
					selection: {type: 'all'}
				})
			).resolves.toEqual({
				failure: {
					code: 'buffer-changed',
					message: 'Workbench buffers changed while preparing refactor runtime.'
				},
				type: 'failure'
			});
			expect(wasmClient.syncRefactorRuntime).toHaveBeenCalledTimes(1);
			expect(wasmClient.applyRefactorPlan).not.toHaveBeenCalled();
			expect(order).toEqual(['close', 'flush', 'reopen']);
		} finally {
			unregister();
		}
	});

	it('plans diagnostic fixes only after stable runtime synchronization', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const request: PlanDiagnosticFixesRequest = {
			selection: {excludedDiagnosticIds: [], type: 'allSafe'},
			storyId: context.story.id
		};
		const onWorkerMetric = jest.fn();
		wasmClient.syncRefactorRuntime.mockResolvedValue(7);
		wasmClient.planDiagnosticFixes.mockResolvedValue({
			summary: {planId: 'diagnostic-plan'},
			type: 'complete'
		});

		await expect(
			context.host.planDiagnosticFixes(
				context.story.id,
				{...request, ignoredUnknown: 'not forwarded'} as any,
				{onWorkerMetric}
			)
		).resolves.toEqual({
			summary: {planId: 'diagnostic-plan'},
			type: 'complete'
		});
		expect(wasmClient.syncRefactorRuntime).toHaveBeenCalledWith(
			'library',
			expect.objectContaining({projectRevision: 1}),
			1
		);
		expect(wasmClient.planDiagnosticFixes).toHaveBeenCalledWith(
			'library',
			request,
			7,
			1,
			{onWorkerMetric}
		);
	});

	it('reopens editor admission while diagnostic materialization remains queued in the worker', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const order: string[] = [];
		let resolvePlan!: (result: any) => void;
		wasmClient.syncRefactorRuntime.mockResolvedValue(7);
		wasmClient.planDiagnosticFixes.mockReturnValue(
			new Promise(resolve => (resolvePlan = resolve))
		);
		const unregister = workbenchBufferCoordinator.register({
			bufferId: 'passage:start',
			closeAdmission: () => {
				order.push('close');
			},
			flush: () => {
				order.push('flush');
			},
			hasPendingChanges: () => false,
			reopenAdmission: () => {
				order.push('reopen');
			},
			revision: () => 1,
			storyId: context.story.id
		});

		try {
			const planning = context.host.planDiagnosticFixes(
				context.story.id,
				{
					selection: {excludedDiagnosticIds: [], type: 'allSafe'},
					storyId: context.story.id
				},
				{onPlanningStarted: () => order.push('started')}
			);

			await waitFor(() =>
				expect(wasmClient.planDiagnosticFixes).toHaveBeenCalledTimes(1)
			);
			expect(order).toEqual(['close', 'flush', 'reopen', 'started']);
			const mutation = context.host.applyStoryCommand(
				updatePassageTextCommand(
					context.story.id,
					context.start.id,
					'accepted while planning'
				)
			);
			expect(wasmClient.apply).not.toHaveBeenCalled();
			resolvePlan({summary: {planId: 'diagnostic-plan'}, type: 'complete'});
			await planning;
			await mutation;
			expect(wasmClient.apply).toHaveBeenCalledTimes(1);
		} finally {
			unregister();
		}
	});

	it('rejects diagnostic-fix planning when buffers change or the Rust boundary is unavailable', async () => {
		let bufferRevision = 1;
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const request: PlanDiagnosticFixesRequest = {
			selection: {excludedDiagnosticIds: [], type: 'allSafe'},
			storyId: context.story.id
		};
		wasmClient.syncRefactorRuntime.mockImplementation(async () => {
			bufferRevision++;
			return 1;
		});
		const unregister = workbenchBufferCoordinator.register({
			bufferId: 'passage:start',
			closeAdmission: jest.fn(),
			flush: jest.fn(),
			hasPendingChanges: () => false,
			reopenAdmission: jest.fn(),
			revision: () => bufferRevision,
			storyId: context.story.id
		});

		try {
			await expect(
				context.host.planDiagnosticFixes(context.story.id, request)
			).resolves.toMatchObject({failure: {code: 'buffer-changed'}});
			expect(wasmClient.planDiagnosticFixes).not.toHaveBeenCalled();
		} finally {
			unregister();
		}

		(wasmClient as any).planDiagnosticFixes = undefined;
		await expect(
			context.host.planDiagnosticFixes(context.story.id, request)
		).rejects.toThrow('Rust diagnostic-fix planning boundary is unavailable');
	});

	it('returns cancelled when an abort follows a pending plan chunk and an unrelated mutation', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const controller = new AbortController();

		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.beginPassageRenamePlan = jest.fn().mockResolvedValue({
			task: {taskId: 'task-1'},
			type: 'begun'
		});
		wasmClient.continuePassageRenamePlan = jest.fn(async () => {
			await context.host.applyStoryCommand(
				updatePassageTextCommand(
					context.story.id,
					context.start.id,
					'unrelated'
				)
			);
			return {
				progress: {scannedPassageCount: 64, totalPassageCount: 129},
				task: {taskId: 'task-1'},
				type: 'pending'
			};
		});
		wasmClient.cancelPassageRenamePlan = jest.fn().mockResolvedValue(true);

		await expect(
			context.host.planPassageRename(
				context.story.id,
				{
					afterName: 'Renamed',
					passageId: context.start.id,
					storyId: context.story.id
				},
				{
					onProgress: () => controller.abort(),
					signal: controller.signal
				}
			)
		).resolves.toEqual({type: 'cancelled'});
		expect(wasmClient.cancelPassageRenamePlan).toHaveBeenCalledWith('library', {
			taskId: 'task-1'
		});
	});

	it('plans project replace through the same cancellable runtime boundary and cancels once', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const controller = new AbortController();
		const request = {
			includePassageNames: false,
			includePassageText: true,
			includeScript: true,
			includeStylesheet: true,
			matchCase: false,
			query: 'before',
			replacement: 'after',
			storyId: context.story.id,
			useRegexes: false
		};

		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.beginProjectReplacePlan.mockResolvedValue({
			task: {taskId: 'replace-task-1'},
			type: 'begun'
		});
		wasmClient.continueProjectReplacePlan.mockResolvedValue({
			progress: {scannedPassageCount: 128, totalPassageCount: 256},
			task: {taskId: 'replace-task-1'},
			type: 'pending'
		});
		wasmClient.cancelProjectReplacePlan.mockResolvedValue(true);

		await expect(
			context.host.planProjectReplace(context.story.id, request, {
				onProgress: () => controller.abort(),
				signal: controller.signal
			})
		).resolves.toEqual({type: 'cancelled'});
		expect(wasmClient.beginProjectReplacePlan).toHaveBeenCalledWith(
			'library',
			request,
			expect.any(Number),
			1
		);
		expect(wasmClient.cancelProjectReplacePlan).toHaveBeenCalledTimes(1);
		expect(wasmClient.cancelProjectReplacePlan).toHaveBeenCalledWith(
			'library',
			{
				taskId: 'replace-task-1'
			}
		);
	});

	it('awaits pending planner backpressure, yields a task, then observes cancellation', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const controller = new AbortController();
		let releasePending: (() => void) | undefined;
		const scheduler = (globalThis as any).scheduler;
		const yieldTask = jest.fn().mockResolvedValue(undefined);

		(globalThis as any).scheduler = {yield: yieldTask};
		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.beginPassageRenamePlan.mockResolvedValue({
			task: {taskId: 'task-1'},
			type: 'begun'
		});
		wasmClient.continuePassageRenamePlan.mockResolvedValue({
			progress: {scannedPassageCount: 128, totalPassageCount: 256},
			task: {taskId: 'task-1'},
			type: 'pending'
		});
		wasmClient.cancelPassageRenamePlan.mockResolvedValue(true);

		try {
			const planning = context.host.planPassageRename(
				context.story.id,
				{
					afterName: 'Renamed',
					passageId: context.start.id,
					storyId: context.story.id
				},
				{
					signal: controller.signal,
					onProgress: () =>
						new Promise<void>(resolve => {
							releasePending = resolve;
						})
				}
			);
			await waitFor(() =>
				expect(wasmClient.continuePassageRenamePlan).toHaveBeenCalledTimes(1)
			);
			expect(yieldTask).not.toHaveBeenCalled();
			controller.abort();
			releasePending?.();
			await expect(planning).resolves.toEqual({type: 'cancelled'});
			expect(yieldTask).toHaveBeenCalledTimes(1);
			expect(wasmClient.continuePassageRenamePlan).toHaveBeenCalledTimes(1);
		} finally {
			(globalThis as any).scheduler = scheduler;
		}
	});

	it('cancels a begun planner task when progress fails so a later plan can run', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const request = {
			afterName: 'Renamed',
			passageId: context.start.id,
			storyId: context.story.id
		};

		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.beginPassageRenamePlan.mockResolvedValue({
			task: {taskId: 'task-1'},
			type: 'begun'
		});
		wasmClient.continuePassageRenamePlan
			.mockResolvedValueOnce({
				progress: {scannedPassageCount: 128, totalPassageCount: 256},
				task: {taskId: 'task-1'},
				type: 'pending'
			})
			.mockResolvedValueOnce({
				summary: {planId: 'plan-2'},
				type: 'complete'
			});
		wasmClient.cancelPassageRenamePlan.mockResolvedValue(true);

		await expect(
			context.host.planPassageRename(context.story.id, request, {
				onProgress: () => Promise.reject(new Error('progress failed'))
			})
		).rejects.toThrow('progress failed');
		expect(wasmClient.cancelPassageRenamePlan).toHaveBeenCalledTimes(1);
		await expect(
			context.host.planPassageRename(context.story.id, request)
		).resolves.toEqual({summary: {planId: 'plan-2'}, type: 'complete'});
	});

	it('cancels a begun planner task when its task yield fails', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const scheduler = (globalThis as any).scheduler;
		const request = {
			afterName: 'Renamed',
			passageId: context.start.id,
			storyId: context.story.id
		};

		(globalThis as any).scheduler = {
			yield: jest
				.fn()
				.mockRejectedValueOnce(new Error('yield failed'))
				.mockResolvedValue(undefined)
		};
		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.beginPassageRenamePlan.mockResolvedValue({
			task: {taskId: 'task-1'},
			type: 'begun'
		});
		wasmClient.continuePassageRenamePlan
			.mockResolvedValueOnce({
				progress: {scannedPassageCount: 128, totalPassageCount: 256},
				task: {taskId: 'task-1'},
				type: 'pending'
			})
			.mockResolvedValueOnce({
				summary: {planId: 'plan-2'},
				type: 'complete'
			});
		wasmClient.cancelPassageRenamePlan.mockResolvedValue(true);

		try {
			await expect(
				context.host.planPassageRename(context.story.id, request)
			).rejects.toThrow('yield failed');
			expect(wasmClient.cancelPassageRenamePlan).toHaveBeenCalledTimes(1);
			await expect(
				context.host.planPassageRename(context.story.id, request)
			).resolves.toEqual({summary: {planId: 'plan-2'}, type: 'complete'});
		} finally {
			(globalThis as any).scheduler = scheduler;
		}
	});

	async function flushCommand() {
		for (let i = 0; i < 8; i++) {
			await Promise.resolve();
		}
	}

	function hostWithStory(
		options: {
			metadataStoreAfterConstruction?: boolean;
			text?: string;
			wasmClient?: any;
		} = {}
	) {
		const story = fakeStory(0);
		const start = fakePassage({
			id: 'start',
			name: 'Start',
			story: story.id,
			text: options.text ?? ''
		});
		let stories: StoriesState = [{...story, passages: [start]}];
		const hostRef: {current?: StoreCoreProjectHost} = {};
		const applyAction = (action: StoriesActionOrThunk) => {
			if (typeof action === 'function') {
				action(applyAction, () => stories);
			} else {
				stories = storiesReducer(stories, action);
			}
		};
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			applyAction(action);

			hostRef.current?.update(stories, dispatch);
		});
		const host = new StoreCoreProjectHost(stories, dispatch, {
			wasmClient: options.wasmClient
		});
		if (options.metadataStoreAfterConstruction) {
			stories = stories.map(story => ({
				...story,
				passages: story.passages.map(passage => ({...passage, text: ''}))
			}));
		}

		hostRef.current = host;

		return {
			dispatch,
			get stories() {
				return stories;
			},
			host,
			start,
			story
		};
	}

	it('rejects semantic navigation when the Rust worker is unavailable', async () => {
		const wasmClient = {
			...fakeWasmClient(async () => batch([])),
			enabled: false
		};
		const {host, start, story} = hostWithStory({wasmClient});

		await expect(
			host.queryPassageReferencesPageAsync(story.id, start.id)
		).rejects.toThrow('Rust semantic navigation is unavailable.');
		await expect(
			host.queryDefinitionAsync({
				expectedRevision: host.sessionStatus().revision,
				name: start.name,
				storyId: story.id,
				symbolKind: 'passage'
			})
		).rejects.toThrow('Rust semantic navigation is unavailable.');
	});

	it('releases bootstrap passage bodies after async session initialization', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({text: 'Bootstrap body', wasmClient});

		await context.host.ensureSessionReady();

		expect(wasmClient.replaceProject).toHaveBeenCalledWith(
			'library',
			expect.objectContaining({
				stories: [
					expect.objectContaining({
						passages: [expect.objectContaining({text: 'Bootstrap body'})]
					})
				]
			}),
			1
		);
		expect(
			context.host.performanceDiagnostics().passageTextCharacterCount
		).toBe(0);
	});

	it('prevalidates duplicate admissions without leaking document ownership', async () => {
		const context = hostWithStory({wasmClient: createTestCoreSessionClient()});
		const story = {...fakeStory(), id: 'duplicate-admission'};

		story.passages = story.passages.map(passage => ({
			...passage,
			story: story.id
		}));

		await expect(
			context.host.admitProjectStories([story, story], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toThrow('already belongs to this core project session');
		expect(bootstrapStory(story.id)).toBeUndefined();
		await expect(
			context.host.admitProjectStories([story], {
				history: 'skip',
				persistence: 'skip'
			})
		).resolves.toBeDefined();
	});

	it('accepts mixed document and metadata passages after initialization', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({text: 'Bootstrap body', wasmClient});
		const metadataPassage = fakePassage({
			id: 'new-passage',
			story: context.story.id,
			text: ''
		});
		Reflect.deleteProperty(metadataPassage, 'text');

		await context.host.ensureSessionReady();

		expect(() =>
			context.host.update(
				[
					{
						...context.story,
						passages: [context.start, metadataPassage]
					}
				],
				context.dispatch
			)
		).not.toThrow();
		expect(
			context.host.performanceDiagnostics().passageTextCharacterCount
		).toBe(0);
	});

	it('retains bootstrap passage bodies when initialization fails so retry is safe', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));

		wasmClient.replaceProject
			.mockRejectedValueOnce(new Error('initialization failed'))
			.mockResolvedValueOnce(undefined);
		const context = hostWithStory({text: 'Retry body', wasmClient});

		await expect(context.host.ensureSessionReady()).rejects.toThrow(
			'initialization failed'
		);
		expect(
			context.host.performanceDiagnostics().passageTextCharacterCount
		).toBe(10);
		await context.host.ensureSessionReady();
		expect(
			wasmClient.replaceProject.mock.calls[1][1].stories[0].passages[0].text
		).toBe('Retry body');
		expect(
			context.host.performanceDiagnostics().passageTextCharacterCount
		).toBe(0);
	});

	it('releases bootstrap passage bodies after synchronous initialization', async () => {
		const wasmClient = createTestCoreSessionClient();
		const context = hostWithStory({
			metadataStoreAfterConstruction: true,
			text: 'Sync body',
			wasmClient
		});

		await context.host.applyStoryCommand(
			updatePassageTextCommand(context.story.id, context.start.id, 'Next body')
		);

		expect(
			context.host.performanceDiagnostics().passageTextCharacterCount
		).toBe(0);
	});

	it('replaces documents in an already-running core session', async () => {
		const wasmClient = createTestCoreSessionClient();
		const context = hostWithStory({text: 'Original body', wasmClient});

		await context.host.ensureSessionReady();
		await context.host.applyStoryCommand(
			replaceStoryCommand(context.story.id, {
				...context.story,
				passages: [
					{
						...context.start,
						id: 'imported-start',
						story: context.story.id,
						text: 'Imported replacement body'
					}
				],
				startPassage: 'imported-start'
			}),
			undefined
		);

		await expect(
			context.host.queryPassageDocumentAsync(context.story.id, 'imported-start')
		).resolves.toEqual(
			expect.objectContaining({text: 'Imported replacement body'})
		);
		expect(context.stories[0].passages).toEqual([
			expect.objectContaining({id: 'imported-start', text: ''})
		]);
		expect(context.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				documentUpdates: [
					{
						passageId: 'imported-start',
						storyId: context.story.id,
						text: 'Imported replacement body',
						type: 'passageText'
					}
				],
				type: 'applyCorePatchBatch'
			}),
			undefined
		);
	});

	it('sends commands to Rust and applies only returned passage patches', async () => {
		const apply = jest.fn(async (command: StoryCommand) =>
			batch([
				{
					changes: {layout: null, name: null, tags: null, text: 'from-rust'},
					passage_id: 'start',
					story_id: (command as any).story_id,
					type: 'passageUpdated'
				},
				{dirty: true, type: 'dirtyStateChanged'}
			])
		);
		const wasmClient = fakeWasmClient(apply);
		const context = hostWithStory({wasmClient});
		const command = updatePassageTextCommand(
			context.story.id,
			'start',
			'from-command'
		);

		context.host.applyStoryCommand(command);
		await flushCommand();

		expect(wasmClient.replaceProject).toHaveBeenCalledWith(
			'library',
			expect.objectContaining({
				stories: [expect.objectContaining({id: context.story.id})]
			}),
			1
		);
		expect(apply).toHaveBeenCalledWith(command, 1);
		expect(
			context.host.performanceDiagnostics().passageTextCharacterCount
		).toBe(0);
		expect(context.host.isDirty()).toBe(true);
		expect(context.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [],
				documentUpdates: [
					{
						passageId: 'start',
						storyId: context.story.id,
						text: 'from-rust',
						type: 'passageText'
					}
				],
				type: 'applyCorePatchBatch'
			}),
			'undoChange.editPassage'
		);
	});

	it('emits an incremental passage layout save hint for move patches', async () => {
		const wasmClient = fakeWasmClient(async command =>
			batch([
				{
					changes: {
						layout: {height: 100, left: 320, top: 180, width: 100},
						name: null,
						tags: null,
						text: null
					},
					passage_id: 'start',
					story_id: (command as any).story_id,
					type: 'passageUpdated'
				}
			])
		);
		const context = hostWithStory({wasmClient});

		await context.host.applyStoryCommand(
			movePassagesCommand(context.story.id, [
				{
					bounds: {height: 100, left: 320, top: 180, width: 100},
					passageId: 'start'
				}
			])
		);

		expect(context.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				persistenceHints: [
					{
						passageId: 'start',
						storyId: context.story.id,
						type: 'passageLayout'
					}
				],
				type: 'applyCorePatchBatch'
			}),
			'undoChange.movePassage'
		);
	});

	it('does not resolve a persisted command until its exact save completes', async () => {
		const persistenceError = new Error('project save failed');
		const context = hostWithStory();
		const persisted = context.host.applyStoryCommandPersisted(
			updatePassageTextCommand(
				context.story.id,
				context.start.id,
				'persisted worker text'
			)
		);

		await flushCommand();
		const action = context.dispatch.mock.calls
			.map(([candidate]) => candidate)
			.find(
				candidate =>
					typeof candidate !== 'function' &&
					candidate.type === 'applyCorePatchBatch' &&
					candidate.persistenceToken
			);

		expect(action).toEqual(
			expect.objectContaining({persistenceToken: expect.any(String)})
		);
		bindPersistenceCompletion((action as any).persistenceToken, {
			completion: Promise.reject(persistenceError),
			persisted: true
		});
		await expect(persisted).rejects.toBe(persistenceError);
	});

	it('does not complete project admission before its exact persistence barrier', async () => {
		const story = fakeStory(1);
		let finishPersistence!: () => void;
		const persistence = new Promise<void>(resolve => {
			finishPersistence = resolve;
		});
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			if (
				typeof action !== 'function' &&
				action.type === 'applyCorePatchBatch' &&
				action.persistenceToken
			) {
				bindPersistenceCompletion(action.persistenceToken, {
					completion: persistence,
					persisted: true
				});
			}
		});
		const host = new StoreCoreProjectHost([], dispatch);
		let completed = false;
		const admission = host
			.admitProjectStories([story], {
				history: 'skip',
				persistence: 'save',
				persistenceBarrier: true
			})
			.then(() => {
				completed = true;
			});

		await flushCommand();
		expect(completed).toBe(false);
		finishPersistence();
		await admission;
		expect(completed).toBe(true);
	});

	it('compensates Core admission when its persistence barrier rejects', async () => {
		const story = fakeStory(1);
		const persistenceError = new Error('manifest commit failed');
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			if (
				typeof action !== 'function' &&
				action.type === 'applyCorePatchBatch' &&
				action.persistenceToken
			) {
				bindPersistenceCompletion(action.persistenceToken, {
					completion: Promise.reject(persistenceError),
					persisted: true
				});
			}
		});
		const host = new StoreCoreProjectHost([], dispatch);

		await expect(
			host.admitProjectStories([story], {
				history: 'skip',
				persistence: 'save',
				persistenceBarrier: true
			})
		).rejects.toBe(persistenceError);
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [
					expect.objectContaining({storyId: story.id, type: 'deleteStory'})
				],
				persistence: 'skip',
				type: 'applyCorePatchBatch'
			}),
			undefined
		);
	});

	it('retains Core ownership when failed admission compensation is incomplete', async () => {
		const story = {...fakeStory(1), id: 'incomplete-admission-rollback'};
		const persistenceError = new Error('manifest commit failed');
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			if (
				typeof action !== 'function' &&
				action.type === 'applyCorePatchBatch' &&
				action.persistenceToken
			) {
				bindPersistenceCompletion(action.persistenceToken, {
					completion: Promise.reject(persistenceError),
					persisted: true
				});
			}
		});
		const host = new StoreCoreProjectHost([], dispatch);
		const originalApply = host.applyStoryCommand.bind(host);
		const apply = jest
			.spyOn(host, 'applyStoryCommand')
			.mockImplementation((command, options) =>
				command.type === 'batch' &&
				command.commands.every(candidate => candidate.type === 'deleteStory')
					? Promise.reject(new Error('Core rollback failed'))
					: originalApply(command, options)
			);

		await expect(
			host.admitProjectStories([story], {
				history: 'skip',
				persistence: 'save',
				persistenceBarrier: true
			})
		).rejects.toEqual(
			expect.objectContaining({code: 'CORE_ADMISSION_ROLLBACK_INCOMPLETE'})
		);
		await expect(
			host.admitProjectStories([story], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toThrow('already belongs to this core project session');
		expect(bootstrapStory(story.id)).toEqual(
			expect.objectContaining({id: story.id})
		);
		apply.mockRestore();
	});

	it('retains original documents when failed deletion compensation is incomplete', async () => {
		const story = {...fakeStory(1), id: 'incomplete-deletion-rollback'};
		const persistenceError = new Error('manifest commit failed');

		registerStoryDocuments(story);
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			if (
				typeof action !== 'function' &&
				action.type === 'applyCorePatchBatch' &&
				action.persistenceToken
			) {
				bindPersistenceCompletion(action.persistenceToken, {
					completion: Promise.reject(persistenceError),
					persisted: true
				});
			}
		});
		const host = new StoreCoreProjectHost([story], dispatch);
		const originalApply = host.applyStoryCommand.bind(host);
		const apply = jest
			.spyOn(host, 'applyStoryCommand')
			.mockImplementation((command, options) =>
				command.type === 'batch' &&
				command.commands.every(candidate => candidate.type === 'createStory')
					? Promise.reject(new Error('Core restore failed'))
					: originalApply(command, options)
			);

		await expect(
			host.deleteProjectStories([story.id], {
				history: 'skip',
				persistence: 'save',
				persistenceBarrier: true
			})
		).rejects.toEqual(
			expect.objectContaining({code: 'CORE_DELETION_ROLLBACK_INCOMPLETE'})
		);
		expect(bootstrapStory(story.id)).toEqual(
			expect.objectContaining({id: story.id})
		);
		await expect(
			host.admitProjectStories([story], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toThrow('already belongs to this core project session');
		apply.mockRestore();
	});

	it('resolves a persisted command only after the local manifest commit', async () => {
		window.localStorage.clear();
		const story = fakeStory(0);
		const start = fakePassage({
			id: 'local-persisted-start',
			name: 'Start',
			story: story.id,
			text: 'before'
		});
		let stories: StoriesState = [{...story, passages: [start]}];
		const hostRef: {current?: StoreCoreProjectHost} = {};

		doUpdateTransaction(transaction => {
			saveStory(transaction, stories[0]);
			savePassage(transaction, start);
		});
		saveLocalStories(stories, {state: stories, type: 'init'});
		const initialRevision = readStorageManifest().revision;
		const originalSetItem = Storage.prototype.setItem;
		let manifestCommitted = false;
		const setItem = jest
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(function (this: Storage, key: string, value: string) {
				const result = originalSetItem.call(this, key, value);

				if (key === storageManifestKey) {
					manifestCommitted = true;
				}
				return result;
			});
		const applyAction = (action: StoriesActionOrThunk) => {
			if (typeof action === 'function') {
				action(applyAction, () => stories);
				return;
			}
			const nextStories = storiesReducer(stories, action);
			const persistence = saveLocalStories(nextStories, action);

			stories = nextStories;
			if (action.type === 'applyCorePatchBatch' && action.persistenceToken) {
				bindPersistenceCompletion(action.persistenceToken, persistence);
			}
			hostRef.current?.update(stories, dispatch);
		};
		const dispatch = jest.fn(applyAction);
		const host = new StoreCoreProjectHost(stories, dispatch);

		hostRef.current = host;

		await host.applyStoryCommandPersisted(
			updatePassageTextCommand(story.id, start.id, 'after manifest commit')
		);

		expect(manifestCommitted).toBe(true);
		expect(readStorageManifest().revision).not.toBe(initialRevision);
		expect(readStoredPassageTexts(story.id).get(start.id)).toBe(
			'after manifest commit'
		);
		setItem.mockRestore();
		window.localStorage.clear();
	});

	function localPersistenceHarness(
		story: StoryWithDocuments,
		wasmClient?: any
	) {
		window.localStorage.clear();
		let stories: StoriesState = [story];
		let remainingManifestFailures = 0;
		const hostRef: {current?: StoreCoreProjectHost} = {};

		registerStoryDocuments(story);
		doUpdateTransaction(transaction => {
			saveStory(transaction, story);
			for (const passage of story.passages) {
				savePassage(transaction, passage);
			}
		});
		const originalSetItem = Storage.prototype.setItem;
		const setItem = jest
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(function (this: Storage, key: string, value: string) {
				if (key === storageManifestKey && remainingManifestFailures > 0) {
					remainingManifestFailures--;
					throw new Error('manifest unavailable');
				}
				return originalSetItem.call(this, key, value);
			});
		const applyAction = (action: StoriesActionOrThunk) => {
			if (typeof action === 'function') {
				action(applyAction, () => stories);
				return;
			}
			const nextStories = storiesReducer(stories, action);

			stories = nextStories;
			try {
				const persistence = saveLocalStories(nextStories, action);

				if (action.type === 'applyCorePatchBatch' && action.persistenceToken) {
					bindPersistenceCompletion(action.persistenceToken, persistence);
				}
			} catch (error) {
				if (action.type === 'applyCorePatchBatch' && action.persistenceToken) {
					rejectPersistenceCompletion(action.persistenceToken, error);
				}
			}
			hostRef.current?.update(stories, dispatch);
		};
		const dispatch = jest.fn(applyAction);
		const host = new StoreCoreProjectHost(stories, dispatch, {wasmClient});

		hostRef.current = host;
		return {
			cleanup() {
				setItem.mockRestore();
				window.localStorage.clear();
			},
			dispatch,
			host,
			get stories() {
				return stories;
			},
			setManifestFailures(count: number) {
				remainingManifestFailures = count;
			}
		};
	}

	function electronPersistenceHarness(
		story: StoryWithDocuments,
		wasmClient?: any
	) {
		window.localStorage.clear();
		const rootPath = `/native/${story.id}.twine.rs`;
		let stories: StoriesState = [story];
		let remainingSaveFailures = 0;
		let durableScript = story.script;
		let durableStylesheet = story.stylesheet;
		const durablePassageText = new Map(
			story.passages.map(passage => [passage.id, passage.text])
		);
		const durablePassageName = new Map(
			story.passages.map(passage => [passage.id, passage.name])
		);
		const hostRef: {current?: StoreCoreProjectHost} = {};

		registerStoryDocuments(story);
		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const saveProjectFolder = jest.fn(
			async (
				_rootPath: string,
				savedStory: StoryWithDocuments,
				options?: ProjectFolderSaveOptions
			): Promise<undefined> => {
				if (remainingSaveFailures > 0) {
					remainingSaveFailures--;
					throw new Error('native save unavailable');
				}
				for (const passage of savedStory.passages) {
					durablePassageText.set(passage.id, passage.text);
					durablePassageName.set(passage.id, passage.name);
				}
				for (const update of options?.documentUpdates ?? []) {
					if (update.type === 'script') {
						durableScript = update.text;
					} else if (update.type === 'stylesheet') {
						durableStylesheet = update.text;
					}
				}
				return undefined;
			}
		);
		const loadStories = jest.fn(async () => ({
			status: 'loaded' as const,
			stories: [
				{
					kind: 'native-project' as const,
					passageTextLoaded: true,
					rootPath,
					story: {
						...story,
						script: durableScript,
						stylesheet: durableStylesheet,
						passages: story.passages.map(passage => ({
							...passage,
							name: durablePassageName.get(passage.id) ?? passage.name,
							text: durablePassageText.get(passage.id) ?? ''
						}))
					},
					storyIds: [story.id]
				}
			]
		}));

		(window as TwineElectronWindow).twineElectron = {
			loadStories,
			saveProjectFolder,
			saveStoryHtml: jest.fn(async () => undefined)
		} as unknown as NonNullable<TwineElectronWindow['twineElectron']>;
		saveElectronStories(stories, {state: stories, type: 'init'}, []);
		const applyAction = (action: StoriesActionOrThunk) => {
			if (typeof action === 'function') {
				action(applyAction, () => stories);
				return;
			}
			const nextStories = storiesReducer(stories, action);

			stories = nextStories;
			try {
				const persistence = saveElectronStories(nextStories, action, []);

				if (action.type === 'applyCorePatchBatch' && action.persistenceToken) {
					bindPersistenceCompletion(action.persistenceToken, persistence);
				}
			} catch (error) {
				if (action.type === 'applyCorePatchBatch' && action.persistenceToken) {
					rejectPersistenceCompletion(action.persistenceToken, error);
				}
			}
			hostRef.current?.update(stories, dispatch);
		};
		const dispatch = jest.fn(applyAction);
		const host = new StoreCoreProjectHost(stories, dispatch, {wasmClient});

		hostRef.current = host;
		return {
			cleanup() {
				deleteProjectMetadata(story.id);
				delete (window as TwineElectronWindow).twineElectron;
				window.localStorage.clear();
			},
			dispatch,
			host,
			load: loadElectronStories,
			setSaveFailures(count: number) {
				remainingSaveFailures = count;
			}
		};
	}

	it('retries the exact failed persistence batch after Core already accepted the text', async () => {
		window.localStorage.clear();
		const story = {...fakeStory(0), id: 'retry-persisted-core-text'};
		const start = fakePassage({
			id: 'retry-persisted-start',
			name: 'Start',
			story: story.id,
			text: 'durable before'
		});
		let stories: StoriesState = [{...story, passages: [start]}];
		const hostRef: {current?: StoreCoreProjectHost} = {};

		registerStoryDocuments({...story, passages: [start]});
		doUpdateTransaction(transaction => {
			saveStory(transaction, stories[0]);
			savePassage(transaction, start);
		});
		saveLocalStories(stories, {state: stories, type: 'init'});
		const originalSetItem = Storage.prototype.setItem;
		let failNextManifest = true;
		const setItem = jest
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(function (this: Storage, key: string, value: string) {
				if (key === storageManifestKey && failNextManifest) {
					failNextManifest = false;
					throw new Error('manifest unavailable');
				}
				return originalSetItem.call(this, key, value);
			});
		const applyAction = (action: StoriesActionOrThunk) => {
			if (typeof action === 'function') {
				action(applyAction, () => stories);
				return;
			}
			const nextStories = storiesReducer(stories, action);

			stories = nextStories;
			try {
				const persistence = saveLocalStories(nextStories, action);

				if (action.type === 'applyCorePatchBatch' && action.persistenceToken) {
					bindPersistenceCompletion(action.persistenceToken, persistence);
				}
			} catch (error) {
				if (action.type === 'applyCorePatchBatch' && action.persistenceToken) {
					rejectPersistenceCompletion(action.persistenceToken, error);
				}
			}
			hostRef.current?.update(stories, dispatch);
		};
		const dispatch = jest.fn(applyAction);
		const host = new StoreCoreProjectHost(stories, dispatch);

		hostRef.current = host;
		await expect(
			host.applyStoryCommandPersisted(
				updatePassageTextCommand(story.id, start.id, 'retry survives reload')
			)
		).rejects.toThrow('manifest unavailable');
		expect(
			(await host.queryPassageDocumentAsync(story.id, start.id)).text
		).toBe('retry survives reload');
		expect(readStoredPassageTexts(story.id).get(start.id)).toBe(
			'durable before'
		);

		const target = {
			passageId: start.id,
			storyId: story.id,
			type: 'passageText' as const
		};

		await expect(host.retryStoryPersistence(target)).resolves.toBe(true);
		expect(readStoredPassageTexts(story.id).get(start.id)).toBe(
			'retry survives reload'
		);
		await expect(host.retryStoryPersistence(target)).resolves.toBe(false);

		setItem.mockRestore();
		window.localStorage.clear();
	});

	it('keeps a committed refactor intact while browser persistence retries its exact batch', async () => {
		const story = {...fakeStory(0), id: 'refactor-local-retry'};
		const start = fakePassage({
			id: 'refactor-local-start',
			name: 'Start',
			story: story.id,
			text: '[[Target]]'
		});
		const target = fakePassage({
			id: 'refactor-local-target',
			name: 'Target',
			story: story.id,
			text: 'before'
		});
		const wasmClient = fakeWasmClient(async () => batch([]));

		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.applyRefactorPlan.mockResolvedValue({
			batch: batch([
				{
					changes: {layout: null, name: 'Renamed', tags: null, text: null},
					passage_id: target.id,
					story_id: story.id,
					type: 'passageUpdated'
				},
				{
					changes: {layout: null, name: null, tags: null, text: '[[Renamed]]'},
					passage_id: start.id,
					story_id: story.id,
					type: 'passageUpdated'
				}
			]),
			revision: 2,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: true,
				redoKind: null,
				revision: 2,
				undoKind: 'refactor'
			},
			type: 'applied'
		});
		const harness = localPersistenceHarness(
			{...story, passages: [start, target]},
			wasmClient
		);

		try {
			harness.setManifestFailures(1);
			await expect(
				harness.host.applyRefactorPlan(story.id, {
					expectedProjectRevision: 1,
					planId: 'refactor-plan',
					selection: {type: 'all'}
				})
			).rejects.toThrow('manifest unavailable');
			expect(wasmClient.applyRefactorPlan).toHaveBeenCalledTimes(1);
			expect(wasmClient.applyRefactorPlan.mock.calls[0]).toHaveLength(4);
			expect(
				harness.stories[0].passages.find(passage => passage.id === target.id)
			).toEqual(expect.objectContaining({name: 'Renamed'}));
			expect(readStoredPassageTexts(story.id).get(start.id)).toBe('[[Target]]');

			await expect(
				harness.host.retryStoryPersistence({
					passageId: start.id,
					storyId: story.id,
					type: 'passageText'
				})
			).resolves.toBe(true);
			await expect(
				harness.host.retryStoryPersistence({
					passageId: start.id,
					storyId: story.id,
					type: 'passageText'
				})
			).resolves.toBe(false);
			expect(wasmClient.applyRefactorPlan).toHaveBeenCalledTimes(1);
			expect(readStoredPassageTexts(story.id).get(start.id)).toBe(
				'[[Renamed]]'
			);
			const [loaded] = await loadLocalStories();
			expect(loaded.passages.find(passage => passage.id === target.id)).toEqual(
				expect.objectContaining({name: 'Renamed'})
			);
		} finally {
			harness.cleanup();
		}
	});

	it('applies and undoes a performance model commit without scheduling persistence', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const onWorkerMetric = jest.fn();
		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.applyRefactorPlan.mockResolvedValue({
			batch: batch([
				{
					changes: {
						layout: null,
						name: null,
						tags: null,
						text: 'model commit'
					},
					passage_id: context.start.id,
					story_id: context.story.id,
					type: 'passageUpdated'
				}
			]),
			receipt: {textEdits: []},
			revision: 2,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: true,
				redoKind: null,
				revision: 2,
				undoKind: 'refactor'
			},
			type: 'applied'
		});

		await expect(
			context.host.applyModelCommit(
				context.story.id,
				{
					expectedProjectRevision: 1,
					planId: 'performance-plan',
					selection: {type: 'all'}
				},
				{onWorkerMetric}
			)
		).resolves.toEqual(
			expect.objectContaining({
				receipt: {textEdits: []},
				type: 'applied'
			})
		);

		const action = context.dispatch.mock.calls
			.map(([candidate]) => candidate)
			.find(
				candidate =>
					typeof candidate !== 'function' &&
					candidate.type === 'applyCorePatchBatch'
			);
		expect(action).toEqual(
			expect.objectContaining({
				actions: expect.any(Array),
				persistence: 'skip',
				persistenceToken: undefined,
				revision: 2,
				type: 'applyCorePatchBatch'
			})
		);
		expect(wasmClient.applyRefactorPlan).toHaveBeenCalledTimes(1);
		expect(wasmClient.applyRefactorPlan).toHaveBeenLastCalledWith(
			expect.any(String),
			{
				expectedProjectRevision: 1,
				planId: 'performance-plan',
				selection: {type: 'all'}
			},
			expect.any(Number),
			expect.any(Number),
			{onWorkerMetric}
		);

		context.dispatch.mockClear();
		wasmClient.undo.mockResolvedValue({
			batch: batch([
				{
					changes: {
						layout: null,
						name: null,
						tags: null,
						text: 'Start'
					},
					passage_id: context.start.id,
					story_id: context.story.id,
					type: 'passageUpdated'
				}
			]),
			revision: 3,
			status: {
				canRedo: true,
				canUndo: false,
				dirty: true,
				redoKind: 'refactor',
				revision: 3,
				undoKind: null
			}
		});

		await expect(context.host.undoModelCommit()).resolves.toBeDefined();
		expect(context.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				persistence: 'skip',
				persistenceToken: undefined,
				revision: 3,
				type: 'applyCorePatchBatch'
			}),
			undefined
		);
	});

	it('retries a committed refactor through the Electron persistence receipt without reapplying it', async () => {
		const story = {...fakeStory(0), id: 'refactor-electron-retry'};
		const start = fakePassage({
			id: 'refactor-electron-start',
			name: 'Start',
			story: story.id,
			text: '[[Target]]'
		});
		const target = fakePassage({
			id: 'refactor-electron-target',
			name: 'Target',
			story: story.id,
			text: 'before'
		});
		const wasmClient = fakeWasmClient(async () => batch([]));

		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.applyRefactorPlan.mockResolvedValue({
			batch: batch([
				{
					changes: {layout: null, name: 'Renamed', tags: null, text: null},
					passage_id: target.id,
					story_id: story.id,
					type: 'passageUpdated'
				},
				{
					changes: {layout: null, name: null, tags: null, text: '[[Renamed]]'},
					passage_id: start.id,
					story_id: story.id,
					type: 'passageUpdated'
				}
			]),
			revision: 2,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: true,
				redoKind: null,
				revision: 2,
				undoKind: 'refactor'
			},
			type: 'applied'
		});
		const harness = electronPersistenceHarness(
			{...story, passages: [start, target]},
			wasmClient
		);

		try {
			harness.setSaveFailures(1);
			await expect(
				harness.host.applyRefactorPlan(story.id, {
					expectedProjectRevision: 1,
					planId: 'refactor-plan',
					selection: {type: 'all'}
				})
			).rejects.toThrow('native save unavailable');
			expect(wasmClient.applyRefactorPlan).toHaveBeenCalledTimes(1);
			let [loaded] = await harness.load();
			expect(
				(
					loaded.passages.find(
						passage => passage.id === start.id
					) as unknown as {
						text: string;
					}
				)?.text
			).toBe('[[Target]]');

			await expect(
				harness.host.retryStoryPersistence({
					passageId: start.id,
					storyId: story.id,
					type: 'passageText'
				})
			).resolves.toBe(true);
			expect(wasmClient.applyRefactorPlan).toHaveBeenCalledTimes(1);
			[loaded] = await harness.load();
			expect(
				(
					loaded.passages.find(
						passage => passage.id === start.id
					) as unknown as {
						text: string;
					}
				)?.text
			).toBe('[[Renamed]]');
			expect(loaded.passages.find(passage => passage.id === target.id)).toEqual(
				expect.objectContaining({name: 'Renamed'})
			);
		} finally {
			harness.cleanup();
		}
	});

	it('retries a rename-only refactor from its passage metadata receipt without reapplying it', async () => {
		const story = {...fakeStory(0), id: 'refactor-local-rename-only'};
		const target = fakePassage({
			id: 'refactor-local-rename-only-target',
			name: 'Target',
			story: story.id,
			text: 'before'
		});
		const wasmClient = fakeWasmClient(async () => batch([]));

		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.applyRefactorPlan.mockResolvedValue({
			batch: batch([
				{
					changes: {layout: null, name: 'Renamed', tags: null, text: null},
					passage_id: target.id,
					story_id: story.id,
					type: 'passageUpdated'
				}
			]),
			revision: 2,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: true,
				redoKind: null,
				revision: 2,
				undoKind: 'refactor'
			},
			type: 'applied'
		});
		const harness = localPersistenceHarness(
			{...story, passages: [target]},
			wasmClient
		);
		const metadataTarget = {
			passageId: target.id,
			storyId: story.id,
			type: 'passageMetadata' as const
		};

		try {
			harness.setManifestFailures(1);
			await expect(
				harness.host.applyRefactorPlan(story.id, {
					expectedProjectRevision: 1,
					planId: 'rename-only-plan',
					selection: {type: 'all'}
				})
			).rejects.toThrow('manifest unavailable');

			await expect(
				harness.host.retryStoryPersistence(metadataTarget)
			).resolves.toBe(true);
			const retryAction = harness.dispatch.mock.calls.at(-1)?.[0];
			expect(retryAction).toEqual(
				expect.objectContaining({
					actions: [],
					persistenceHints: [metadataTarget],
					type: 'applyCorePatchBatch'
				})
			);
			expect(wasmClient.applyRefactorPlan).toHaveBeenCalledTimes(1);
			const [loaded] = await loadLocalStories();
			expect(loaded.passages[0]).toEqual(
				expect.objectContaining({name: 'Renamed'})
			);
			await expect(
				harness.host.retryStoryPersistence(metadataTarget)
			).resolves.toBe(false);
		} finally {
			harness.cleanup();
		}
	});

	it.each(['passage text', 'passage metadata'] as const)(
		'retries a grouped refactor from its %s alias with every still-current target',
		async alias => {
			const story = {...fakeStory(0), id: `refactor-grouped-${alias}`};
			const start = fakePassage({
				id: `refactor-grouped-start-${alias}`,
				name: 'Start',
				story: story.id,
				text: '[[Target]]'
			});
			const target = fakePassage({
				id: `refactor-grouped-target-${alias}`,
				name: 'Target',
				story: story.id,
				text: 'before'
			});
			const wasmClient = fakeWasmClient(async () => batch([]));
			wasmClient.syncRefactorRuntime.mockResolvedValue(1);
			wasmClient.applyRefactorPlan.mockResolvedValue({
				batch: batch([
					{
						changes: {layout: null, name: 'Renamed', tags: null, text: null},
						passage_id: target.id,
						story_id: story.id,
						type: 'passageUpdated'
					},
					{
						changes: {
							layout: null,
							name: null,
							tags: null,
							text: '[[Renamed]]'
						},
						passage_id: start.id,
						story_id: story.id,
						type: 'passageUpdated'
					}
				]),
				revision: 2,
				status: {
					canRedo: false,
					canUndo: true,
					dirty: true,
					redoKind: null,
					revision: 2,
					undoKind: 'refactor'
				},
				type: 'applied'
			});
			const harness = localPersistenceHarness(
				{...story, passages: [start, target]},
				wasmClient
			);
			const textTarget = {
				passageId: start.id,
				storyId: story.id,
				type: 'passageText' as const
			};
			const metadataTarget = {
				passageId: target.id,
				storyId: story.id,
				type: 'passageMetadata' as const
			};

			try {
				harness.setManifestFailures(1);
				await expect(
					harness.host.applyRefactorPlan(story.id, {
						expectedProjectRevision: 1,
						planId: `grouped-${alias}`,
						selection: {type: 'all'}
					})
				).rejects.toThrow('manifest unavailable');
				await expect(
					harness.host.retryStoryPersistence(
						alias === 'passage text' ? textTarget : metadataTarget
					)
				).resolves.toBe(true);
				expect(harness.dispatch.mock.calls.at(-1)?.[0]).toEqual(
					expect.objectContaining({
						actions: [],
						documentUpdates: [
							expect.objectContaining({
								passageId: start.id,
								text: '[[Renamed]]',
								type: 'passageText'
							})
						],
						persistenceHints: expect.arrayContaining([
							textTarget,
							metadataTarget
						])
					})
				);
				const [loaded] = await loadLocalStories();
				expect(
					(loaded.passages.find(passage => passage.id === start.id) as any).text
				).toBe('[[Renamed]]');
				expect(
					loaded.passages.find(passage => passage.id === target.id)
				).toEqual(expect.objectContaining({name: 'Renamed'}));
				await expect(
					harness.host.retryStoryPersistence(textTarget)
				).resolves.toBe(false);
				await expect(
					harness.host.retryStoryPersistence(metadataTarget)
				).resolves.toBe(false);
			} finally {
				harness.cleanup();
			}
		}
	);

	it('retries only the remaining grouped refactor target after a newer text save succeeds', async () => {
		const story = {...fakeStory(0), id: 'refactor-grouped-partial-success'};
		const start = fakePassage({
			id: 'refactor-partial-start',
			name: 'Start',
			story: story.id,
			text: '[[Target]]'
		});
		const target = fakePassage({
			id: 'refactor-partial-target',
			name: 'Target',
			story: story.id,
			text: 'before'
		});
		const wasmClient = fakeWasmClient(async command =>
			command.type === 'updatePassageText'
				? batch([
						{
							changes: {
								layout: null,
								name: null,
								tags: null,
								text: command.text
							},
							passage_id: command.passage_id,
							story_id: command.story_id,
							type: 'passageUpdated'
						}
					])
				: batch([])
		);
		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.applyRefactorPlan.mockResolvedValue({
			batch: batch([
				{
					changes: {layout: null, name: 'Renamed', tags: null, text: null},
					passage_id: target.id,
					story_id: story.id,
					type: 'passageUpdated'
				},
				{
					changes: {layout: null, name: null, tags: null, text: '[[Renamed]]'},
					passage_id: start.id,
					story_id: story.id,
					type: 'passageUpdated'
				}
			]),
			revision: 2,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: true,
				redoKind: null,
				revision: 2,
				undoKind: 'refactor'
			},
			type: 'applied'
		});
		const harness = localPersistenceHarness(
			{...story, passages: [start, target]},
			wasmClient
		);
		const textTarget = {
			passageId: start.id,
			storyId: story.id,
			type: 'passageText' as const
		};
		const metadataTarget = {
			passageId: target.id,
			storyId: story.id,
			type: 'passageMetadata' as const
		};

		try {
			harness.setManifestFailures(1);
			await expect(
				harness.host.applyRefactorPlan(story.id, {
					expectedProjectRevision: 1,
					planId: 'partial-success',
					selection: {type: 'all'}
				})
			).rejects.toThrow('manifest unavailable');
			await harness.host.applyStoryCommandPersisted(
				updatePassageTextCommand(story.id, start.id, 'newer durable text')
			);

			await expect(
				harness.host.retryStoryPersistence(metadataTarget)
			).resolves.toBe(true);
			expect(harness.dispatch.mock.calls.at(-1)?.[0]).toEqual(
				expect.objectContaining({
					actions: [],
					documentUpdates: [],
					persistenceHints: [metadataTarget]
				})
			);
			const [loaded] = await loadLocalStories();
			expect(
				(loaded.passages.find(passage => passage.id === start.id) as any).text
			).toBe('newer durable text');
			expect(loaded.passages.find(passage => passage.id === target.id)).toEqual(
				expect.objectContaining({name: 'Renamed'})
			);
			await expect(
				harness.host.retryStoryPersistence(textTarget)
			).resolves.toBe(false);
			await expect(
				harness.host.retryStoryPersistence(metadataTarget)
			).resolves.toBe(false);
		} finally {
			harness.cleanup();
		}
	});

	it('lets a newer same-story full save clear grouped aliases without letting an older revision clear a newer receipt', async () => {
		const story = {...fakeStory(0), id: 'refactor-grouped-full-success'};
		const start = fakePassage({
			id: 'refactor-full-start',
			name: 'Start',
			story: story.id,
			text: '[[Target]]'
		});
		const target = fakePassage({
			id: 'refactor-full-target',
			name: 'Target',
			story: story.id,
			text: 'before'
		});
		const wasmClient = fakeWasmClient(async command => {
			if (command.type === 'updateStoryScript') {
				return batch([
					{
						changes: {name: null},
						story_id: command.story_id,
						type: 'projectMetadataUpdated'
					}
				]);
			}
			if (command.type === 'updatePassageText') {
				return batch([
					{
						changes: {layout: null, name: null, tags: null, text: command.text},
						passage_id: command.passage_id,
						story_id: command.story_id,
						type: 'passageUpdated'
					}
				]);
			}
			return batch([]);
		});
		wasmClient.syncRefactorRuntime.mockResolvedValue(1);
		wasmClient.applyRefactorPlan.mockResolvedValue({
			batch: batch([
				{
					changes: {layout: null, name: 'Renamed', tags: null, text: null},
					passage_id: target.id,
					story_id: story.id,
					type: 'passageUpdated'
				},
				{
					changes: {layout: null, name: null, tags: null, text: '[[Renamed]]'},
					passage_id: start.id,
					story_id: story.id,
					type: 'passageUpdated'
				}
			]),
			revision: 2,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: true,
				redoKind: null,
				revision: 2,
				undoKind: 'refactor'
			},
			type: 'applied'
		});
		const harness = localPersistenceHarness(
			{...story, passages: [start, target]},
			wasmClient
		);
		const textTarget = {
			passageId: start.id,
			storyId: story.id,
			type: 'passageText' as const
		};
		const metadataTarget = {
			passageId: target.id,
			storyId: story.id,
			type: 'passageMetadata' as const
		};

		try {
			harness.setManifestFailures(1);
			await expect(
				harness.host.applyRefactorPlan(story.id, {
					expectedProjectRevision: 1,
					planId: 'full-success',
					selection: {type: 'all'}
				})
			).rejects.toThrow('manifest unavailable');
			await harness.host.applyStoryCommandPersisted(
				updateStoryScriptCommand(story.id, story.script)
			);

			await expect(
				harness.host.retryStoryPersistence(textTarget)
			).resolves.toBe(false);
			await expect(
				harness.host.retryStoryPersistence(metadataTarget)
			).resolves.toBe(false);
			harness.setManifestFailures(1);
			await expect(
				harness.host.applyStoryCommandPersisted(
					updatePassageTextCommand(story.id, start.id, 'newer retry text')
				)
			).rejects.toThrow('manifest unavailable');
			const failed = (harness.host as any).failedPersistenceByTarget as Map<
				string,
				unknown
			>;
			(harness.host as any).clearFailedPersistenceTargets([textTarget], 2);
			expect(failed.size).toBe(1);
			await expect(
				harness.host.retryStoryPersistence(textTarget)
			).resolves.toBe(true);
			const [loaded] = await loadLocalStories();
			expect(
				(loaded.passages.find(passage => passage.id === start.id) as any).text
			).toBe('newer retry text');
		} finally {
			harness.cleanup();
		}
	});

	it('retains a failed passage receipt when a sibling passage persists', async () => {
		const story = {...fakeStory(0), id: 'retry-sibling-success'};
		const passageA = fakePassage({
			id: 'retry-sibling-a',
			name: 'A',
			story: story.id,
			text: 'A before'
		});
		const passageB = fakePassage({
			id: 'retry-sibling-b',
			name: 'B',
			story: story.id,
			text: 'B before'
		});
		const harness = localPersistenceHarness({
			...story,
			passages: [passageA, passageB]
		});
		const targetA = {
			passageId: passageA.id,
			storyId: story.id,
			type: 'passageText' as const
		};

		try {
			harness.setManifestFailures(1);
			await expect(
				harness.host.applyStoryCommandPersisted(
					updatePassageTextCommand(story.id, passageA.id, 'A after')
				)
			).rejects.toThrow('manifest unavailable');
			await harness.host.applyStoryCommandPersisted(
				updatePassageTextCommand(story.id, passageB.id, 'B after')
			);

			await expect(harness.host.retryStoryPersistence(targetA)).resolves.toBe(
				true
			);
			const [loaded] = await loadLocalStories();

			expect(
				(
					loaded.passages.find(
						passage => passage.id === passageA.id
					) as unknown as {
						text: string;
					}
				)?.text
			).toBe('A after');
			expect(
				(
					loaded.passages.find(
						passage => passage.id === passageB.id
					) as unknown as {
						text: string;
					}
				)?.text
			).toBe('B after');
		} finally {
			harness.cleanup();
		}
	});

	it('keeps independent receipts when two sibling passages fail', async () => {
		const story = {...fakeStory(0), id: 'retry-sibling-failures'};
		const passageA = fakePassage({
			id: 'retry-failed-a',
			name: 'A',
			story: story.id,
			text: 'A before'
		});
		const passageB = fakePassage({
			id: 'retry-failed-b',
			name: 'B',
			story: story.id,
			text: 'B before'
		});
		const harness = localPersistenceHarness({
			...story,
			passages: [passageA, passageB]
		});
		const target = (passageId: string) => ({
			passageId,
			storyId: story.id,
			type: 'passageText' as const
		});

		try {
			harness.setManifestFailures(2);
			await expect(
				harness.host.applyStoryCommandPersisted(
					updatePassageTextCommand(story.id, passageA.id, 'A after')
				)
			).rejects.toThrow('manifest unavailable');
			await expect(
				harness.host.applyStoryCommandPersisted(
					updatePassageTextCommand(story.id, passageB.id, 'B after')
				)
			).rejects.toThrow('manifest unavailable');

			await expect(
				harness.host.retryStoryPersistence(target(passageA.id))
			).resolves.toBe(true);
			let [loaded] = await loadLocalStories();

			expect(
				(
					loaded.passages.find(
						passage => passage.id === passageA.id
					) as unknown as {
						text: string;
					}
				)?.text
			).toBe('A after');
			expect(
				(
					loaded.passages.find(
						passage => passage.id === passageB.id
					) as unknown as {
						text: string;
					}
				)?.text
			).toBe('B before');
			await expect(
				harness.host.retryStoryPersistence(target(passageB.id))
			).resolves.toBe(true);
			[loaded] = await loadLocalStories();
			expect(
				(
					loaded.passages.find(
						passage => passage.id === passageB.id
					) as unknown as {
						text: string;
					}
				)?.text
			).toBe('B after');
		} finally {
			harness.cleanup();
		}
	});

	it('clears only a failed receipt superseded by a successful write to the same passage', async () => {
		const story = {...fakeStory(0), id: 'retry-same-passage'};
		const passage = fakePassage({
			id: 'retry-same-passage-start',
			name: 'Start',
			story: story.id,
			text: 'before'
		});
		const harness = localPersistenceHarness({...story, passages: [passage]});
		const target = {
			passageId: passage.id,
			storyId: story.id,
			type: 'passageText' as const
		};

		try {
			harness.setManifestFailures(1);
			await expect(
				harness.host.applyStoryCommandPersisted(
					updatePassageTextCommand(story.id, passage.id, 'failed value')
				)
			).rejects.toThrow('manifest unavailable');
			await harness.host.applyStoryCommandPersisted(
				updatePassageTextCommand(story.id, passage.id, 'durable value')
			);

			await expect(harness.host.retryStoryPersistence(target)).resolves.toBe(
				false
			);
			const [loaded] = await loadLocalStories();

			expect((loaded.passages[0] as unknown as {text: string}).text).toBe(
				'durable value'
			);
		} finally {
			harness.cleanup();
		}
	});

	it.each(['fail then succeed', 'fail then fail'] as const)(
		'keeps Electron sibling receipts when writes %s and reloads the exact durable documents',
		async sequence => {
			const story = {...fakeStory(0), id: `electron-retry-${sequence}`};
			const passageA = fakePassage({
				id: `electron-a-${sequence}`,
				name: 'A',
				story: story.id,
				text: 'A before'
			});
			const passageB = fakePassage({
				id: `electron-b-${sequence}`,
				name: 'B',
				story: story.id,
				text: 'B before'
			});
			const harness = electronPersistenceHarness({
				...story,
				passages: [passageA, passageB]
			});
			const target = (passageId: string) => ({
				passageId,
				storyId: story.id,
				type: 'passageText' as const
			});

			try {
				harness.setSaveFailures(sequence === 'fail then fail' ? 2 : 1);
				await expect(
					harness.host.applyStoryCommandPersisted(
						updatePassageTextCommand(story.id, passageA.id, 'A after')
					)
				).rejects.toThrow('native save unavailable');
				const second = harness.host.applyStoryCommandPersisted(
					updatePassageTextCommand(story.id, passageB.id, 'B after')
				);

				if (sequence === 'fail then fail') {
					await expect(second).rejects.toThrow('native save unavailable');
				} else {
					await second;
				}

				await expect(
					harness.host.retryStoryPersistence(target(passageA.id))
				).resolves.toBe(true);
				let [loaded] = await harness.load();

				expect(
					(
						loaded.passages.find(({id}) => id === passageA.id) as unknown as {
							text: string;
						}
					).text
				).toBe('A after');
				expect(
					(
						loaded.passages.find(({id}) => id === passageB.id) as unknown as {
							text: string;
						}
					).text
				).toBe(sequence === 'fail then fail' ? 'B before' : 'B after');

				if (sequence === 'fail then fail') {
					await expect(
						harness.host.retryStoryPersistence(target(passageB.id))
					).resolves.toBe(true);
					[loaded] = await harness.load();
					expect(
						(
							loaded.passages.find(({id}) => id === passageB.id) as unknown as {
								text: string;
							}
						).text
					).toBe('B after');
				}
			} finally {
				harness.cleanup();
			}
		}
	);

	it('keeps independent Electron receipts for script and stylesheet documents', async () => {
		const story = {
			...fakeStory(0),
			id: 'electron-retry-story-source',
			script: 'script before',
			stylesheet: 'stylesheet before'
		};
		const harness = electronPersistenceHarness({...story, passages: []});

		try {
			harness.setSaveFailures(2);
			await expect(
				harness.host.applyStoryCommandPersisted(
					updateStoryScriptCommand(story.id, 'script after')
				)
			).rejects.toThrow('native save unavailable');
			await expect(
				harness.host.applyStoryCommandPersisted(
					updateStoryStylesheetCommand(story.id, 'stylesheet after')
				)
			).rejects.toThrow('native save unavailable');

			await expect(
				harness.host.retryStoryPersistence({storyId: story.id, type: 'script'})
			).resolves.toBe(true);
			let [loaded] = await harness.load();

			expect(loaded.script).toBe('script after');
			expect(loaded.stylesheet).toBe('stylesheet before');
			await expect(
				harness.host.retryStoryPersistence({
					storyId: story.id,
					type: 'stylesheet'
				})
			).resolves.toBe(true);
			[loaded] = await harness.load();
			expect(loaded.stylesheet).toBe('stylesheet after');
		} finally {
			harness.cleanup();
		}
	});

	it('drains an admitted worker mutation through synchronous persistence registration and blocks later mutations', async () => {
		let finishApply: (batch: PatchBatch) => void = () => {};
		let finishPersistence: () => void = () => {};
		const wasmClient = fakeWasmClient(
			() =>
				new Promise<PatchBatch>(resolve => {
					finishApply = resolve;
				})
		);
		const story = fakeStory(1);
		const persistence = new Promise<void>(resolve => {
			finishPersistence = resolve;
		});
		const coordinator = new PersistenceQuitCoordinator();
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			expect(coordinator.allowsPersistenceMutation()).toBe(true);
			if (
				typeof action !== 'function' &&
				action.type === 'applyCorePatchBatch'
			) {
				coordinator.track(persistence);
			}
		});
		const host = new ProjectScopedCoreProjectHost([story], dispatch);
		const storeHost = [
			...((host as any).hosts as Map<string, any>).values()
		][0];

		storeHost.wasmClient = wasmClient;
		const command = updatePassageTextCommand(
			story.id,
			story.passages[0].id,
			'worker text'
		);
		const admitted = host.applyStoryCommand(command);

		await flushCommand();
		expect(wasmClient.apply).toHaveBeenCalledTimes(1);
		const prepared = jest.fn();
		const preparation = coordinator.prepare('quit-worker').then(prepared);

		await expect(host.applyStoryCommand(command)).rejects.toThrow(
			'Core mutations are frozen'
		);
		expect(wasmClient.apply).toHaveBeenCalledTimes(1);
		finishApply(
			batch([
				{
					changes: {
						layout: null,
						name: null,
						tags: null,
						text: 'worker text'
					},
					passage_id: story.passages[0].id,
					story_id: story.id,
					type: 'passageUpdated'
				}
			])
		);
		await admitted;
		await Promise.resolve();
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [],
				persistenceHints: [expect.objectContaining({type: 'passageText'})],
				type: 'applyCorePatchBatch'
			}),
			'undoChange.editPassage'
		);
		expect(prepared).not.toHaveBeenCalled();
		finishPersistence();
		await preparation;
		expect(prepared).toHaveBeenCalledTimes(1);

		coordinator.cancel('quit-worker');
		const reopened = host.applyStoryCommand(command);

		await flushCommand();
		expect(wasmClient.apply).toHaveBeenCalledTimes(2);
		finishApply(batch([]));
		await reopened;
		host.dispose();
	});

	it('exposes a lifecycle barrier for admitted worker mutations', async () => {
		let finishApply: (batch: PatchBatch) => void = () => {};
		const wasmClient = fakeWasmClient(
			() =>
				new Promise<PatchBatch>(resolve => {
					finishApply = resolve;
				})
		);
		const story = fakeStory(1);
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = [
			...((host as any).hosts as Map<string, any>).values()
		][0];

		storeHost.wasmClient = wasmClient;
		const admitted = host.applyStoryCommand(
			updatePassageTextCommand(story.id, story.passages[0].id, 'worker text')
		);

		await flushCommand();
		let drained = false;
		const drain = host.drainMutations().then(() => {
			drained = true;
		});

		await Promise.resolve();
		expect(drained).toBe(false);
		finishApply(batch([]));
		await admitted;
		await drain;
		expect(drained).toBe(true);
		host.dispose();
	});

	it('drains a scoped refactor apply before disposing its shared worker', async () => {
		const story = fakeStory(1);
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = [
			...((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		][0];
		let resolveApply!: (value: any) => void;
		const pending = new Promise<any>(resolve => {
			resolveApply = resolve;
		});
		jest.spyOn(storeHost, 'applyRefactorPlan').mockReturnValue(pending);
		const dispose = jest.spyOn((host as any).client, 'dispose');
		const apply = host.applyRefactorPlan(story.id, {
			expectedProjectRevision: 1,
			planId: 'pending-plan',
			selection: {type: 'all'}
		});

		await Promise.resolve();
		host.dispose();
		expect(dispose).not.toHaveBeenCalled();
		resolveApply({
			failure: {code: 'buffer-changed', message: 'stale'},
			type: 'failure'
		});
		await expect(apply).resolves.toEqual(
			expect.objectContaining({type: 'failure'})
		);
		await Promise.resolve();
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it('defers obsolete session retirement until an admitted refactor apply settles', async () => {
		const story = fakeStory(1);
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = [
			...((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		][0];
		let resolveApply!: (value: any) => void;
		jest.spyOn(storeHost, 'applyRefactorPlan').mockReturnValue(
			new Promise(resolve => {
				resolveApply = resolve;
			})
		);
		const apply = host.applyRefactorPlan(story.id, {
			expectedProjectRevision: 1,
			planId: 'retire-plan',
			selection: {type: 'all'}
		});
		await Promise.resolve();
		host.update([], jest.fn());
		expect((host as any).hosts.size).toBe(1);
		resolveApply({
			failure: {code: 'buffer-changed', message: 'stale'},
			type: 'failure'
		});
		await apply;
		await waitFor(() => expect((host as any).hosts.size).toBe(0));
		host.dispose();
	});

	it('does not retire a session reintroduced while an admitted refactor apply drains', async () => {
		const story = fakeStory(1);
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = [
			...((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		][0];
		let resolveApply!: (value: any) => void;
		jest.spyOn(storeHost, 'applyRefactorPlan').mockReturnValue(
			new Promise(resolve => {
				resolveApply = resolve;
			})
		);
		const removeSession = jest.spyOn((host as any).client, 'removeSession');
		const apply = host.applyRefactorPlan(story.id, {
			expectedProjectRevision: 1,
			planId: 'reintroduced-plan',
			selection: {type: 'all'}
		});

		await Promise.resolve();
		host.update([], jest.fn());
		host.update([story], jest.fn());
		resolveApply({
			failure: {code: 'buffer-changed', message: 'stale'},
			type: 'failure'
		});
		await apply;
		await waitFor(() => expect((host as any).hosts.size).toBe(1));
		expect(removeSession).not.toHaveBeenCalled();
		host.dispose();
	});

	it('finalizes scoped disposal after an admitted refactor apply rejects', async () => {
		const story = fakeStory(1);
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = [
			...((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		][0];
		let rejectApply!: (reason: Error) => void;
		jest.spyOn(storeHost, 'applyRefactorPlan').mockReturnValue(
			new Promise((_resolve, reject) => {
				rejectApply = reject;
			})
		);
		const dispose = jest.spyOn((host as any).client, 'dispose');
		const apply = host.applyRefactorPlan(story.id, {
			expectedProjectRevision: 1,
			planId: 'rejected-plan',
			selection: {type: 'all'}
		});

		await Promise.resolve();
		host.dispose();
		expect(dispose).not.toHaveBeenCalled();
		rejectApply(new Error('worker stopped'));
		await expect(apply).rejects.toThrow('worker stopped');
		await waitFor(() => expect(dispose).toHaveBeenCalledTimes(1));
	});

	it('captures native storage kind on a story deletion patch', async () => {
		const wasmClient = fakeWasmClient(async command =>
			batch([
				{
					story_id: (command as any).story_id,
					type: 'storyDeleted'
				}
			])
		);
		const context = hostWithStory({wasmClient});

		saveProjectMetadata(context.story.id, {
			rootPath: '/native/captured-delete.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		await context.host.applyStoryCommand(deleteStoryCommand(context.story.id));

		expect(context.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [
					{
						storageKind: 'electron-project-folder',
						storyId: context.story.id,
						type: 'deleteStory'
					}
				],
				type: 'applyCorePatchBatch'
			}),
			undefined
		);
	});

	it('waits for file-backed passage hydration before initializing WASM', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const command = updatePassageTextCommand(
			context.story.id,
			context.start.id,
			'after hydration'
		);

		markProjectStoryHydration(context.story.id, {
			passageTextLoaded: false,
			rootPath: '/project'
		});
		const applying = context.host.applyStoryCommand(command);
		await flushCommand();
		expect(wasmClient.replaceProject).not.toHaveBeenCalled();

		markProjectStoryHydration(context.story.id, {
			passageTextLoaded: true,
			rootPath: '/project'
		});
		replaceKnownAssetInventoryForStory(context.story.id, []);
		await applying;
		expect(wasmClient.replaceProject).toHaveBeenCalledTimes(1);
	});

	it('aborts a failed stream, clears readiness, and permits bootstrap retry or snapshot recovery', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({text: 'partial body', wasmClient});
		wasmClient.appendProjectBootstrap.mockRejectedValueOnce(
			new Error('append failed')
		);
		await context.host.beginHydratedProject(context.story.id, context.stories);
		const recoveryStories = context.stories.map(story => ({
			...story,
			passages: story.passages.map(passage => ({...passage}))
		}));
		await expect(
			context.host.appendHydratedProjectPassages(context.story.id, [
				context.start
			])
		).rejects.toThrow('append failed');
		await context.host.abortHydratedProject(context.story.id);
		expect(wasmClient.abortProjectBootstrap).toHaveBeenCalledWith('library');
		expect((context.host as any).wasmProjectReplaceRevision).toBe(-1);
		await expect(
			context.host.beginHydratedProject(context.story.id, context.stories)
		).resolves.toBeUndefined();

		wasmClient.replaceProject.mockRejectedValueOnce(
			new Error('recover failed')
		);
		await expect(
			context.host.recoverFromSnapshot(
				context.story.id,
				recoveryStories as any,
				[]
			)
		).rejects.toThrow('recover failed');
		expect((context.host as any).wasmProjectReplaceRevision).toBe(-1);
		wasmClient.replaceProject.mockResolvedValueOnce(undefined);
		await expect(
			context.host.recoverFromSnapshot(
				context.story.id,
				recoveryStories as any,
				[]
			)
		).resolves.toBeUndefined();
	});

	it('keeps streamed hydration stages on their captured session after root rebinding', async () => {
		const story = {...fakeStory(0), id: 'leased-hydration'};
		const dispatch = jest.fn();
		const host = new ProjectScopedCoreProjectHost([story], dispatch);
		const original = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		jest.spyOn(original, 'beginHydratedProject').mockResolvedValue();
		const append = jest
			.spyOn(original, 'appendHydratedProjectPassages')
			.mockResolvedValue();
		const abort = jest
			.spyOn(original, 'abortHydratedProject')
			.mockResolvedValue();
		await host.beginHydratedProject(story.id, [story]);
		saveProjectMetadata(story.id, {
			rootPath: '/native/rebound.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		try {
			host.update([story], dispatch);
			const replacement = Array.from(
				((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
			).find(candidate => candidate !== original)!;
			const replacementAppend = jest.spyOn(
				replacement,
				'appendHydratedProjectPassages'
			);
			await host.appendHydratedProjectPassages(story.id, []);
			expect(append).toHaveBeenCalledWith(story.id, []);
			expect(replacementAppend).not.toHaveBeenCalled();
			await host.abortHydratedProject(story.id);
			expect(abort).toHaveBeenCalledWith(story.id);
			await expect(
				host.appendHydratedProjectPassages(story.id, [])
			).rejects.toThrow('no longer active');
		} finally {
			deleteProjectMetadata(story.id);
			host.dispose();
		}
	});

	it('rejects a stale hydration lease after root rebinding without touching the replacement stream', async () => {
		const story = {...fakeStory(0), id: 'stale-hydration-lease'};
		const dispatch = jest.fn();
		const host = new ProjectScopedCoreProjectHost([story], dispatch);
		const original = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		jest.spyOn(original, 'beginHydratedProject').mockResolvedValue();
		const originalAbort = jest
			.spyOn(original, 'abortHydratedProject')
			.mockResolvedValue();
		const firstLease = await host.beginHydratedProject(story.id, [story]);
		expect(firstLease).toEqual(expect.any(Symbol));
		saveProjectMetadata(story.id, {
			rootPath: '/native/rebound-lease.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		try {
			host.update([story], dispatch);
			const replacement = Array.from(
				((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
			).find(candidate => candidate !== original)!;
			jest.spyOn(replacement, 'beginHydratedProject').mockResolvedValue();
			const replacementAppend = jest
				.spyOn(replacement, 'appendHydratedProjectPassages')
				.mockResolvedValue();
			const replacementFinish = jest
				.spyOn(replacement, 'finishHydratedProject')
				.mockResolvedValue();
			const replacementAbort = jest
				.spyOn(replacement, 'abortHydratedProject')
				.mockResolvedValue();
			const replacementLease = await host.beginHydratedProject(story.id, [
				story
			]);
			originalAbort.mockClear();
			replacementAbort.mockClear();

			await expect(
				host.appendHydratedProjectPassages(story.id, [], firstLease)
			).rejects.toThrow('no longer active');
			await host.abortHydratedProject(story.id, firstLease);
			expect(replacementAbort).not.toHaveBeenCalled();
			expect(originalAbort).not.toHaveBeenCalled();

			await host.appendHydratedProjectPassages(story.id, [], replacementLease);
			await host.finishHydratedProject(story.id, replacementLease);
			expect(replacementAppend).toHaveBeenCalledWith(story.id, []);
			expect(replacementFinish).toHaveBeenCalledWith(story.id);
		} finally {
			deleteProjectMetadata(story.id);
			host.dispose();
		}
	});

	it('overlays refreshed native metadata onto a stale Rust asset page', async () => {
		const wasmClient = createTestCoreSessionClient();
		const path = 'assets/cover.png';
		const context = hostWithStory({
			text: `<img src="${path}">`,
			wasmClient
		});

		replaceKnownAssetInventoryForStory(context.story.id, []);
		await context.host.ensureSessionReady();
		replaceKnownAssetInventoryForStory(context.story.id, [
			{
				...asset(path),
				modifiedAt: '2026-06-21T16:00:00.000Z',
				sizeBytes: 2048
			}
		]);

		const page = await context.host.queryAssetsPageAsync(context.story.id, {
			limit: 10
		});

		expect(page.assets).toEqual([
			expect.objectContaining({
				modifiedAt: '2026-06-21T16:00:00.000Z',
				path,
				referenceCount: 1,
				sizeBytes: 2048,
				unused: false
			})
		]);
		expect(page.assets[0].references).toHaveLength(1);
		context.host.dispose();
		replaceKnownAssetInventoryForStory(context.story.id, []);
	});

	it('uses the worker-advanced revision for follow-up commands', async () => {
		const wasmClient = {
			acknowledgeSaved: jest.fn(),
			apply: jest
				.fn()
				.mockResolvedValueOnce({
					batch: batch([]),
					revision: 9,
					status: {
						canRedo: false,
						canUndo: true,
						dirty: true,
						redoKind: null,
						revision: 9,
						undoKind: 'editPassage'
					}
				})
				.mockResolvedValueOnce({
					batch: batch([]),
					revision: 10,
					status: {
						canRedo: false,
						canUndo: true,
						dirty: true,
						redoKind: null,
						revision: 10,
						undoKind: 'editPassage'
					}
				}),
			cachedGraphProjection: jest.fn(),
			cachedStoryIndex: jest.fn(),
			enabled: true,
			lastGraphProjection: jest.fn(),
			mode: 'wasm-worker',
			queryGraphProjection: jest.fn(),
			queryStoryIndex: jest.fn(),
			redo: jest.fn(),
			replaceProject: jest.fn().mockResolvedValue(undefined),
			undo: jest.fn()
		};
		const context = hostWithStory({wasmClient});

		context.host.applyStoryCommand(
			updatePassageTextCommand(context.story.id, 'start', 'first')
		);
		await flushCommand();
		context.host.applyStoryCommand(
			updatePassageTextCommand(context.story.id, 'start', 'second')
		);
		await flushCommand();

		expect(wasmClient.apply.mock.calls.map(call => call[2])).toEqual([1, 9]);
	});

	it('applies asset inventory effects from returned patch batches', async () => {
		const cover = asset('assets/cover.png');
		const wasmClient = fakeWasmClient(async command =>
			batch([
				{
					asset: cover,
					story_id: (command as any).story_id,
					type: 'assetImported'
				},
				{
					inventory: [cover],
					story_id: (command as any).story_id,
					type: 'assetInventoryUpdated'
				}
			])
		);
		const context = hostWithStory({wasmClient});

		context.host.applyStoryCommand({
			overwrite: false,
			source_path: '/tmp/ignored.png',
			story_id: context.story.id,
			target_path: 'assets/ignored.png',
			type: 'importAsset'
		});
		await flushCommand();

		expect(wasmClient.apply).toHaveBeenCalled();
		expect(knownAssetInventoryForStory(context.story.id)).toEqual([cover]);
		expect(context.dispatch).not.toHaveBeenCalled();
	});

	it('runs native asset effects before Rust undo and redo', async () => {
		const applyProjectAssetEffect = jest
			.fn()
			.mockResolvedValueOnce('effect-after-undo')
			.mockResolvedValueOnce('effect-after-redo');
		const wasmClient = fakeWasmClient(async () => batch([]));

		wasmClient.undo.mockResolvedValue({
			batch: batch([]),
			revision: 3,
			status: {
				canRedo: true,
				canUndo: false,
				dirty: false,
				redoKind: 'importAsset',
				revision: 3,
				undoKind: null
			}
		});
		wasmClient.redo.mockResolvedValue({
			batch: batch([]),
			revision: 4,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: true,
				redoKind: null,
				revision: 4,
				undoKind: 'importAsset'
			}
		});
		(window as any).twineElectron = {applyProjectAssetEffect};
		const context = hostWithStory({wasmClient});

		await context.host.applyStoryCommand(
			{
				overwrite: false,
				source_path: '/tmp/cover.png',
				story_id: context.story.id,
				target_path: 'assets/cover.png',
				type: 'importAsset'
			},
			{effectToken: 'effect-1'}
		);
		await context.host.undo();
		await context.host.redo();

		expect(applyProjectAssetEffect.mock.calls).toEqual([
			['effect-1', 'undo'],
			['effect-after-undo', 'redo']
		]);
		delete (window as any).twineElectron;
	});

	it('rolls back a prepared native asset effect when Rust rejects it', async () => {
		const error = jest.spyOn(console, 'error').mockImplementation();
		const applyProjectAssetEffect = jest
			.fn()
			.mockResolvedValue('effect-after-rollback');
		const discardProjectAssetEffect = jest.fn().mockResolvedValue(undefined);
		const wasmClient = fakeWasmClient(async () => {
			throw new Error('rejected');
		});

		(window as any).twineElectron = {
			applyProjectAssetEffect,
			discardProjectAssetEffect
		};
		const context = hostWithStory({wasmClient});

		await expect(
			context.host.applyStoryCommand(
				{
					overwrite: false,
					source_path: '/tmp/cover.png',
					story_id: context.story.id,
					target_path: 'assets/cover.png',
					type: 'importAsset'
				},
				{effectToken: 'effect-2'}
			)
		).rejects.toThrow('rejected');

		expect(applyProjectAssetEffect).toHaveBeenCalledWith('effect-2', 'undo');
		expect(discardProjectAssetEffect).toHaveBeenCalledWith(
			'effect-after-rollback'
		);
		expect(error).toHaveBeenCalledWith(
			'Rust project session command failed: Error: rejected'
		);
		delete (window as any).twineElectron;
	});

	it('publishes returned non-state patches without dispatching reducer actions', async () => {
		const context = hostWithStory({
			wasmClient: fakeWasmClient(async command =>
				batch([
					{
						projection: {
							bounds: null,
							edges: [],
							layoutState: 'saved',
							nodes: [],
							stats: {
								brokenLinks: 0,
								emptyPassages: 0,
								links: 0,
								orphanPassages: 0,
								passages: 1,
								resolvedLinks: 0,
								selfLinks: 0,
								taggedPassages: 0,
								unreachablePassages: 0
							}
						},
						story_id: (command as any).story_id,
						type: 'graphProjectionUpdated'
					}
				])
			)
		});
		const listener = jest.fn();

		context.host.subscribeToPatches(listener);
		context.host.applyStoryCommand(
			queryGraphProjectionCommand(context.story.id, {
				focus: null,
				layers: {broken: true, resolved: true, selfLinks: true},
				viewport: null
			})
		);
		await flushCommand();

		expect(listener).toHaveBeenLastCalledWith(
			expect.objectContaining({
				patches: [
					expect.objectContaining({
						projection: expect.objectContaining({
							layoutState: 'saved',
							nodes: []
						}),
						story_id: context.story.id,
						type: 'graphProjectionUpdated'
					})
				]
			})
		);
		expect(context.dispatch).not.toHaveBeenCalled();
	});

	it('applies story metadata patches returned by Rust', async () => {
		const wasmClient = fakeWasmClient(async command => {
			const zoom = command.type === 'setStoryZoom' ? command.zoom : null;

			return batch([
				{
					changes: {
						ifid: null,
						name: command.type === 'renameStory' ? command.name : null,
						snapToGrid:
							command.type === 'setStorySnapToGrid' ? command.enabled : null,
						storyFormat:
							command.type === 'setStoryFormat' ? command.story_format : null,
						storyFormatVersion:
							command.type === 'setStoryFormat'
								? command.story_format_version
								: null,
						tagColors: null,
						tags: null,
						zoom
					},
					story_id: (command as any).story_id,
					type: 'storyMetadataUpdated'
				}
			]);
		});
		const context = hostWithStory({wasmClient});

		context.host.applyStoryCommand(
			renameStoryCommand(context.story.id, 'Renamed Story')
		);
		await flushCommand();
		context.host.applyStoryCommand(
			setStoryFormatCommand(context.story.id, 'Chapbook', '2.2.0')
		);
		await flushCommand();
		context.host.applyStoryCommand(
			setStorySnapToGridCommand(context.story.id, false)
		);
		await flushCommand();
		context.host.applyStoryCommand(setStoryZoomCommand(context.story.id, 0.6));
		await flushCommand();

		expect(context.stories[0]).toEqual(
			expect.objectContaining({
				name: 'Renamed Story',
				snapToGrid: false,
				storyFormat: 'Chapbook',
				storyFormatVersion: '2.2.0',
				zoom: 0.6
			})
		);
		expect(
			(
				context.dispatch.mock.calls as unknown as Array<
					[StoriesActionOrThunk, string]
				>
			).map(call => call[1])
		).toEqual([
			'undoChange.renameStory',
			'undoChange.changeStoryDetails',
			'undoChange.changeStoryDetails',
			'undoChange.changeStoryDetails'
		]);
	});

	it('does not replace the Rust project after direct React state updates', () => {
		const context = hostWithStory();
		const staleProjection = {stale: true};
		const fakeWasmClient = {
			cachedGraphProjection: jest.fn(
				(
					_sessionId: string,
					_storyId: string,
					_options: unknown,
					revision: number
				) => (revision === 1 ? staleProjection : undefined)
			),
			enabled: true,
			lastGraphProjection: jest.fn()
		};

		(context.host as any).wasmClient = fakeWasmClient;

		expect(context.host.queryGraphProjection(context.story.id)).toBe(
			staleProjection
		);

		context.host.update(
			[{...context.stories[0], name: 'Updated'}],
			context.dispatch
		);

		expect(context.host.queryGraphProjection(context.story.id)).toBe(
			staleProjection
		);
		expect(fakeWasmClient.cachedGraphProjection).toHaveBeenLastCalledWith(
			'library',
			context.story.id,
			expect.any(Object),
			1
		);
		expect(fakeWasmClient.lastGraphProjection).not.toHaveBeenCalled();
	});

	it('keeps Rust graph caches live for selection-only store updates', () => {
		const context = hostWithStory();
		const cachedProjection = {cached: true};
		const fakeWasmClient = {
			cachedGraphProjection: jest.fn(
				(
					_sessionId: string,
					_storyId: string,
					_options: unknown,
					revision: number
				) => (revision === 1 ? cachedProjection : undefined)
			),
			enabled: true,
			lastGraphProjection: jest.fn()
		};

		(context.host as any).wasmClient = fakeWasmClient;

		expect(context.host.queryGraphProjection(context.story.id)).toBe(
			cachedProjection
		);

		context.host.update(
			[
				{
					...context.stories[0],
					passages: context.stories[0].passages.map(passage => ({
						...passage,
						selected: true
					})),
					selected: true
				}
			],
			context.dispatch
		);

		expect(context.host.queryGraphProjection(context.story.id)).toBe(
			cachedProjection
		);
		expect(fakeWasmClient.cachedGraphProjection).toHaveBeenLastCalledWith(
			'library',
			context.story.id,
			expect.any(Object),
			1
		);
		expect(fakeWasmClient.lastGraphProjection).not.toHaveBeenCalled();
	});

	it('keeps Rust query revisions stable across direct React view updates', () => {
		const context = hostWithStory();
		const staleIndex = {storyId: context.story.id, stale: true};
		const fakeWasmClient = {
			cachedStoryIndex: jest.fn(
				(
					_sessionId: string,
					_storyId: string,
					_options: unknown,
					revision: number
				) => (revision === 1 ? staleIndex : undefined)
			)
		};

		(context.host as any).wasmClient = fakeWasmClient;

		expect(context.host.queryStoryIndex(context.story.id)).toBe(staleIndex);

		context.host.update(
			[{...context.stories[0], name: 'Updated'}],
			context.dispatch
		);

		expect(context.host.queryStoryIndex(context.story.id)).toBe(staleIndex);
		expect(fakeWasmClient.cachedStoryIndex).toHaveBeenLastCalledWith(
			'library',
			context.story.id,
			expect.any(Object),
			1
		);
	});

	it('does not make a history-skipping command eligible for rollback', async () => {
		const context = hostWithStory({
			wasmClient: fakeWasmClient(async () => batch([]))
		});

		const tracked = await context.host.applyStoryCommandTracked(
			renameStoryTagCommand('missing', 'new'),
			{history: 'skip'}
		);

		expect(tracked.transactionId).toBeUndefined();
	});

	it('refuses transaction rollback after a queued unrelated mutation', async () => {
		const wasmClient = fakeWasmClient(async () => batch([]));
		const context = hostWithStory({wasmClient});
		const tracked = await context.host.applyStoryCommandTracked(
			renameStoryTagCommand('old', 'new')
		);

		expect(tracked.transactionId).toBe(1);
		const unrelated = context.host.applyStoryCommand(
			updatePassageTextCommand(context.story.id, context.start.id, 'unrelated')
		);
		const rollback = context.host.rollbackTransaction(tracked.transactionId!);

		await unrelated;
		await expect(rollback).resolves.toBe(false);
		expect(wasmClient.undo).not.toHaveBeenCalled();
	});

	it('owns refactor review DTOs at the project host boundary and releases them on close or session replacement', async () => {
		const story = fakeStory(0);
		const dispatch = jest.fn();
		const host = new ProjectScopedCoreProjectHost([story], dispatch);
		const storeHost = [
			...((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		][0];
		const summary = {
			planDigest: 'digest-1',
			planId: 'plan-1',
			projectRevision: 1
		};
		const page = {changes: [{changeId: 'change-1'}]};

		jest
			.spyOn(storeHost, 'planPassageRename')
			.mockResolvedValue({summary, type: 'complete'} as any);
		jest
			.spyOn(storeHost, 'queryRefactorPlanDetailAsync')
			.mockResolvedValue({page, type: 'page'} as any);

		await host.planPassageRename(story.id, {
			afterName: 'Renamed',
			passageId: 'passage-1',
			storyId: story.id
		});
		await host.queryRefactorPlanDetailAsync(story.id, {
			planDigest: 'digest-1',
			planId: 'plan-1',
			position: 0
		});
		expect(host.refactorReviewSnapshot(story.id)).toEqual({
			encodedBytes: expect.any(Number),
			pageCount: 1,
			summaryCount: 1
		});
		expect(host.performanceDiagnostics().refactorReview).toEqual(
			expect.objectContaining({ownerCount: 1, pageCount: 1, summaryCount: 1})
		);

		host.closeRefactorReview(story.id);
		expect(host.refactorReviewSnapshot(story.id)).toEqual({
			encodedBytes: 0,
			pageCount: 0,
			summaryCount: 0
		});

		await host.planPassageRename(story.id, {
			afterName: 'Renamed',
			passageId: 'passage-1',
			storyId: story.id
		});
		saveProjectMetadata(story.id, {
			rootPath: '/native/refactor-review.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		try {
			host.update([story], dispatch);
			expect(host.refactorReviewSnapshot(story.id)).toEqual({
				encodedBytes: 0,
				pageCount: 0,
				summaryCount: 0
			});
		} finally {
			deleteProjectMetadata(story.id);
			host.dispose();
		}

		const disposableStory = {...fakeStory(1), id: 'dispose-review-story'};
		const disposableHost = new ProjectScopedCoreProjectHost(
			[disposableStory],
			dispatch
		);
		const disposableStoreHost = [
			...(
				(disposableHost as any).hosts as Map<string, StoreCoreProjectHost>
			).values()
		][0];
		jest
			.spyOn(disposableStoreHost, 'planPassageRename')
			.mockResolvedValue({summary, type: 'complete'} as any);
		await disposableHost.planPassageRename(disposableStory.id, {
			afterName: 'Renamed',
			passageId: 'passage-1',
			storyId: disposableStory.id
		});
		expect(
			disposableHost.refactorReviewSnapshot(disposableStory.id).summaryCount
		).toBe(1);
		disposableHost.dispose();
		expect(disposableHost.refactorReviewSnapshot(disposableStory.id)).toEqual({
			encodedBytes: 0,
			pageCount: 0,
			summaryCount: 0
		});
	});

	it('cancels pending planner/detail work on review close without publishing late DTOs', async () => {
		const story = {...fakeStory(0), id: 'late-review'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let resolvePlan!: (value: any) => void;
		let resolveDetail!: (value: any) => void;
		jest
			.spyOn(storeHost, 'planPassageRename')
			.mockImplementation(
				() => new Promise(resolve => (resolvePlan = resolve))
			);
		jest
			.spyOn(storeHost, 'queryRefactorPlanDetailAsync')
			.mockImplementation(
				() => new Promise(resolve => (resolveDetail = resolve))
			);
		const plan = host.planPassageRename(story.id, {
			afterName: 'Renamed',
			passageId: 'p',
			storyId: story.id
		});
		const detail = host.queryRefactorPlanDetailAsync(story.id, {
			planDigest: 'd',
			planId: 'p',
			position: 0
		});
		await Promise.resolve();
		host.closeRefactorReview(story.id);
		resolvePlan({summary: {planId: 'late'}, type: 'complete'});
		resolveDetail({page: {changes: []}, type: 'page'});
		await expect(plan).resolves.toEqual({type: 'cancelled'});
		await expect(detail).resolves.toMatchObject({
			failure: {code: 'plan-evicted'}
		});
		expect(host.refactorReviewSnapshot(story.id)).toEqual({
			encodedBytes: 0,
			pageCount: 0,
			summaryCount: 0
		});
		host.dispose();
	});

	it('gates planner and detail admission for a direct snapshot replacement and releases only after terminal drain', async () => {
		const story = {...fakeStory(0), id: 'replacement-gate-direct'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let releaseRecovery!: () => void;
		const recover = jest
			.spyOn(storeHost, 'recoverFromSnapshot')
			.mockImplementation(
				() => new Promise<void>(resolve => (releaseRecovery = resolve))
			);
		const plan = jest
			.spyOn(storeHost, 'planPassageRename')
			.mockResolvedValue({type: 'cancelled'} as any);
		const diagnosticPlan = jest
			.spyOn(storeHost, 'planDiagnosticFixes')
			.mockResolvedValue({
				summary: {planId: 'diagnostic'},
				type: 'complete'
			} as any);
		const detail = jest.spyOn(storeHost, 'queryRefactorPlanDetailAsync');
		await expect(
			host.planDiagnosticFixes(story.id, {
				selection: {excludedDiagnosticIds: [], type: 'allSafe'},
				storyId: 'another-story'
			})
		).resolves.toMatchObject({failure: {code: 'invalid-plan'}});
		expect(diagnosticPlan).not.toHaveBeenCalled();
		const recovery = host.recoverFromSnapshot(story.id, [story] as any, []);

		await waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
		await expect(
			host.planPassageRename(story.id, {
				afterName: 'R',
				passageId: 'p',
				storyId: story.id
			})
		).resolves.toEqual({type: 'cancelled'});
		await expect(
			host.planDiagnosticFixes(story.id, {
				selection: {excludedDiagnosticIds: [], type: 'allSafe'},
				storyId: story.id
			})
		).resolves.toMatchObject({failure: {code: 'plan-evicted'}});
		await expect(
			host.queryRefactorPlanDetailAsync(story.id, {
				planDigest: 'd',
				planId: 'p',
				position: 0
			})
		).resolves.toMatchObject({failure: {code: 'plan-evicted'}});
		expect(plan).not.toHaveBeenCalled();
		expect(diagnosticPlan).not.toHaveBeenCalled();
		expect(detail).not.toHaveBeenCalled();

		releaseRecovery();
		await recovery;
		await host.planPassageRename(story.id, {
			afterName: 'R',
			passageId: 'p',
			storyId: story.id
		});
		await host.planDiagnosticFixes(story.id, {
			selection: {excludedDiagnosticIds: [], type: 'allSafe'},
			storyId: story.id
		});
		expect(plan).toHaveBeenCalledTimes(1);
		expect(diagnosticPlan).toHaveBeenCalledTimes(1);
		expect((host as any).replacementGateOwners.size).toBe(0);
		host.dispose();
	});

	it('drains an admitted apply before reserving replacement and rejects later applies without Store work', async () => {
		const story = {...fakeStory(0), id: 'replacement-gate-apply'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let finishApply!: (result: any) => void;
		const applyStore = jest
			.spyOn(storeHost, 'applyRefactorPlan')
			.mockImplementation(
				() => new Promise(resolve => (finishApply = resolve)) as any
			);
		const firstApply = host.applyRefactorPlan(story.id, {
			expectedProjectRevision: 1,
			planId: 'admitted-plan',
			selection: {type: 'all'}
		});
		await waitFor(() => expect(applyStore).toHaveBeenCalledTimes(1));
		const reserve = host.acquireProjectReplacement(story.id);
		await Promise.resolve();
		expect((host as any).replacementGateOwnersByStory.get(story.id)?.size).toBe(
			1
		);
		expect(applyStore).toHaveBeenCalledTimes(1);
		await expect(
			host.applyRefactorPlan(story.id, {
				expectedProjectRevision: 1,
				planId: 'evicted-plan',
				selection: {type: 'all'}
			})
		).resolves.toMatchObject({
			failure: {code: 'plan-evicted'},
			type: 'failure'
		});
		expect(applyStore).toHaveBeenCalledTimes(1);
		finishApply({
			failure: {code: 'buffer-changed', message: 'stale'},
			type: 'failure'
		});
		await firstApply;
		const lease = await reserve;
		await host.abortProjectReplacement(story.id, lease);
		expect((host as any).replacementGateOwnersByStory.size).toBe(0);
		host.dispose();
	});

	it('holds a story gate across a metadata root rebind until an old-session apply settles', async () => {
		const story = {...fakeStory(0), id: 'replacement-rebind-apply'};
		saveProjectMetadata(story.id, {
			rootPath: '/native/rebind-old.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const oldHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let finishApply!: (result: any) => void;
		jest
			.spyOn(oldHost, 'applyRefactorPlan')
			.mockImplementation(
				() => new Promise(resolve => (finishApply = resolve)) as any
			);
		const admitted = host.applyRefactorPlan(story.id, {
			expectedProjectRevision: 1,
			planId: 'old-session-plan',
			selection: {type: 'all'}
		});
		await waitFor(() => expect(oldHost.applyRefactorPlan).toHaveBeenCalled());
		saveProjectMetadata(story.id, {
			rootPath: '/native/rebind-new.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		await expect(
			host.applyRefactorPlan(story.id, {
				expectedProjectRevision: 1,
				planId: 'new-session-plan',
				selection: {type: 'all'}
			})
		).resolves.toMatchObject({failure: {code: 'plan-evicted'}});
		expect((host as any).replacementGateOwnersByStory.get(story.id)?.size).toBe(
			1
		);
		finishApply({
			failure: {code: 'buffer-changed', message: 'stale'},
			type: 'failure'
		});
		await admitted;
		await waitFor(() =>
			expect((host as any).replacementGateOwnersByStory.size).toBe(0)
		);
		host.dispose();
	});

	it('rebinds from the successfully persisted old-session patch only after its save settles', async () => {
		const story = {...fakeStory(1), id: 'replacement-rebind-persisted'};
		const dispatch = jest.fn();
		let releasePersistence!: () => void;
		const persistence = new Promise<void>(resolve => {
			releasePersistence = resolve;
		});
		saveProjectMetadata(story.id, {
			rootPath: '/native/rebind-persisted-old.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const host = new ProjectScopedCoreProjectHost(
			[story],
			(action, annotation) => {
				dispatch(action, annotation);
				if (
					typeof action !== 'function' &&
					action.type === 'applyCorePatchBatch' &&
					action.persistenceToken
				) {
					bindPersistenceCompletion(action.persistenceToken, {
						completion: persistence,
						persisted: true
					});
				}
			}
		);
		const oldHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		const oldSessionId = (host as any).storySessions.get(story.id);
		(oldHost as any).wasmClient.applySync = jest.fn().mockReturnValue({
			batch: {
				label: 'Persisted rename',
				patches: [
					{
						changes: {
							layout: null,
							name: 'Applied before root rebind',
							tags: null,
							text: null
						},
						passage_id: story.passages[0].id,
						story_id: story.id,
						type: 'passageUpdated'
					}
				],
				transactionId: BigInt(1)
			},
			revision: 2,
			status: {
				canRedo: false,
				canUndo: true,
				dirty: true,
				redoKind: null,
				revision: 2,
				undoKind: 'editPassage'
			}
		});

		try {
			const persisted = host.applyStoryCommandPersisted(
				updatePassageTextCommand(
					story.id,
					story.passages[0].id,
					'applied before root rebind'
				)
			);
			await waitFor(() =>
				expect(dispatch).toHaveBeenCalledWith(
					expect.objectContaining({
						actions: [
							expect.objectContaining({
								props: expect.objectContaining({
									name: 'Applied before root rebind'
								})
							})
						],
						type: 'applyCorePatchBatch'
					}),
					expect.anything()
				)
			);

			saveProjectMetadata(story.id, {
				rootPath: '/native/rebind-persisted-new.twine.rs',
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
			host.update((host as any).stories, (host as any).dispatch);

			expect(
				(host as any).replacementGateOwnersByStory.get(story.id)?.size
			).toBe(1);
			expect((host as any).storySessions.get(story.id)).toBe(oldSessionId);
			expect((host as any).hostForStory(story.id)).toBe(oldHost);
			expect((host as any).hosts.size).toBe(1);

			releasePersistence();
			await persisted;
			await waitFor(() =>
				expect((host as any).hostForStory(story.id)).not.toBe(oldHost)
			);
			const rebound = (host as any).hostForStory(
				story.id
			) as StoreCoreProjectHost;
			expect((rebound as any).stories[0].passages[0]).toEqual(
				expect.objectContaining({name: 'Applied before root rebind'})
			);
			expect((host as any).replacementGateOwnersByStory.size).toBe(0);
		} finally {
			deleteProjectMetadata(story.id);
			host.dispose();
		}
	});

	it('drains pre-existing planner work before replacing and suppresses its late review DTO', async () => {
		const story = {...fakeStory(0), id: 'replacement-gate-pending'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let signal: AbortSignal | undefined;
		let resolvePlan!: (value: any) => void;
		jest
			.spyOn(storeHost, 'planPassageRename')
			.mockImplementation((_storyId, _request, options) => {
				signal = options?.signal;
				return new Promise(resolve => (resolvePlan = resolve));
			});
		const recover = jest
			.spyOn(storeHost, 'recoverFromSnapshot')
			.mockResolvedValue();
		const planning = host.planPassageRename(story.id, {
			afterName: 'R',
			passageId: 'p',
			storyId: story.id
		});
		await Promise.resolve();
		const recovery = host.recoverFromSnapshot(story.id, [story] as any, []);

		await waitFor(() => expect(signal?.aborted).toBe(true));
		expect(recover).not.toHaveBeenCalled();
		resolvePlan({summary: {planId: 'late'}, type: 'complete'});
		await expect(planning).resolves.toEqual({type: 'cancelled'});
		await recovery;
		expect(host.refactorReviewSnapshot(story.id)).toEqual({
			encodedBytes: 0,
			pageCount: 0,
			summaryCount: 0
		});
		host.dispose();
	});

	it('rejects commands that synchronously discover a metadata-root rebind until it releases', async () => {
		for (const method of [
			'applyStoryCommand',
			'applyStoryCommandPersisted'
		] as const) {
			const story = {
				...fakeStory(1),
				id: `metadata-rebind-command-${method}`
			};
			const oldRoot = `/native/${method}-old.twine.rs`;
			const newRoot = `/native/${method}-new.twine.rs`;
			saveProjectMetadata(story.id, {
				rootPath: oldRoot,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
			const host = new ProjectScopedCoreProjectHost([story], jest.fn());
			const oldHost = Array.from(
				((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
			)[0];
			const apply = jest
				.spyOn(StoreCoreProjectHost.prototype, method)
				.mockResolvedValue({} as PatchBatch);
			const command = updatePassageTextCommand(
				story.id,
				story.passages[0].id,
				'after root rebind'
			);

			try {
				saveProjectMetadata(story.id, {
					rootPath: newRoot,
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
				await expect(host[method](command)).rejects.toMatchObject({
					code: 'CORE_PROJECT_REPLACEMENT_IN_PROGRESS'
				});
				const newHost = Array.from(
					((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
				).find(candidate => candidate !== oldHost)!;
				expect(newHost).toBeDefined();
				expect(apply).not.toHaveBeenCalled();
				await waitFor(() =>
					expect((host as any).replacementGateOwners.size).toBe(0)
				);

				await host[method](command);
				expect(apply).toHaveBeenCalledTimes(1);
				expect(apply.mock.instances).toEqual([newHost]);
			} finally {
				apply.mockRestore();
				deleteProjectMetadata(story.id);
				host.dispose();
			}
		}
	});

	it('rejects a late persisted command until direct full hydration completes', async () => {
		const story = {...fakeStory(1), id: 'replacement-gate-full-command'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let finishHydration!: () => void;
		const initialize = jest
			.spyOn(storeHost, 'initializeHydratedProject')
			.mockImplementation(
				() => new Promise<void>(resolve => (finishHydration = resolve))
			);
		const applyPersisted = jest
			.spyOn(storeHost, 'applyStoryCommandPersisted')
			.mockResolvedValue({} as PatchBatch);
		const command = updatePassageTextCommand(
			story.id,
			story.passages[0].id,
			'late persisted command'
		);

		const replacementLease = await host.acquireProjectReplacement(story.id);
		const hydration = host.initializeHydratedProject(
			story.id,
			[story],
			replacementLease
		);
		await waitFor(() => expect(initialize).toHaveBeenCalledTimes(1));
		await expect(
			host.applyStoryCommandPersisted(command)
		).rejects.toMatchObject({code: 'CORE_PROJECT_REPLACEMENT_IN_PROGRESS'});
		expect(applyPersisted).not.toHaveBeenCalled();

		finishHydration();
		await hydration;
		expect((host as any).replacementGateOwners.size).toBe(0);
		await host.applyStoryCommandPersisted(command);
		expect(applyPersisted).toHaveBeenCalledTimes(1);
		host.dispose();
	});

	it('rejects a late persisted command until snapshot conflict recovery completes', async () => {
		const story = {...fakeStory(1), id: 'replacement-gate-recovery-command'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let finishRecovery!: () => void;
		const recover = jest
			.spyOn(storeHost, 'recoverFromSnapshot')
			.mockImplementation(
				() => new Promise<void>(resolve => (finishRecovery = resolve))
			);
		const applyPersisted = jest
			.spyOn(storeHost, 'applyStoryCommandPersisted')
			.mockResolvedValue({} as PatchBatch);
		const command = updatePassageTextCommand(
			story.id,
			story.passages[0].id,
			'late persisted command'
		);

		const replacementLease = await host.acquireProjectReplacement(story.id);
		const recovery = host.recoverFromSnapshot(
			story.id,
			[story] as any,
			[],
			replacementLease
		);
		await waitFor(() => expect(recover).toHaveBeenCalledTimes(1));
		await expect(
			host.applyStoryCommandPersisted(command)
		).rejects.toMatchObject({code: 'CORE_PROJECT_REPLACEMENT_IN_PROGRESS'});
		expect(applyPersisted).not.toHaveBeenCalled();

		finishRecovery();
		await recovery;
		expect((host as any).replacementGateOwners.size).toBe(0);
		await host.applyStoryCommandPersisted(command);
		expect(applyPersisted).toHaveBeenCalledTimes(1);
		host.dispose();
	});

	it('holds the replacement gate through a streamed lease and releases it after finish or abort', async () => {
		for (const terminal of ['finish', 'abort'] as const) {
			const story = {...fakeStory(1), id: `replacement-gate-${terminal}`};
			const host = new ProjectScopedCoreProjectHost([story], jest.fn());
			const storeHost = Array.from(
				((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
			)[0];
			jest.spyOn(storeHost, 'beginHydratedProject').mockResolvedValue();
			jest
				.spyOn(storeHost, 'planPassageRename')
				.mockResolvedValue({type: 'cancelled'} as any);
			const applyPersisted = jest
				.spyOn(storeHost, 'applyStoryCommandPersisted')
				.mockResolvedValue({} as PatchBatch);
			const command = updatePassageTextCommand(
				story.id,
				story.passages[0].id,
				'late persisted command'
			);

			await host.beginHydratedProject(story.id, [story]);
			expect((host as any).replacementGateOwners.size).toBe(1);
			await expect(
				host.planPassageRename(story.id, {
					afterName: 'R',
					passageId: 'p',
					storyId: story.id
				})
			).resolves.toEqual({type: 'cancelled'});
			expect(storeHost.planPassageRename).not.toHaveBeenCalled();
			await expect(
				host.applyStoryCommandPersisted(command)
			).rejects.toMatchObject({code: 'CORE_PROJECT_REPLACEMENT_IN_PROGRESS'});
			expect(applyPersisted).not.toHaveBeenCalled();

			if (terminal === 'finish') {
				jest.spyOn(storeHost, 'finishHydratedProject').mockResolvedValue();
				await host.finishHydratedProject(story.id);
			} else {
				jest.spyOn(storeHost, 'abortHydratedProject').mockResolvedValue();
				await host.abortHydratedProject(story.id);
			}
			expect((host as any).replacementGateOwners.size).toBe(0);
			await host.planPassageRename(story.id, {
				afterName: 'R',
				passageId: 'p',
				storyId: story.id
			});
			expect(storeHost.planPassageRename).toHaveBeenCalledTimes(1);
			await host.applyStoryCommandPersisted(command);
			expect(applyPersisted).toHaveBeenCalledTimes(1);
			host.dispose();
		}
	});

	it('cleans every sibling gate owner for streamed terminals and ignores a stale terminal lease', async () => {
		for (const terminal of ['finish', 'abort'] as const) {
			const first = {...fakeStory(0), id: `streamed-siblings-${terminal}-one`};
			const second = {...fakeStory(0), id: `streamed-siblings-${terminal}-two`};
			for (const story of [first, second]) {
				saveProjectMetadata(story.id, {
					rootPath: `/native/streamed-siblings-${terminal}.twine.rs`,
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
			}
			const host = new ProjectScopedCoreProjectHost([first, second], jest.fn());
			const storeHost = Array.from(
				((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
			)[0];
			jest.spyOn(storeHost, 'beginHydratedProject').mockResolvedValue();
			jest.spyOn(storeHost, 'abortHydratedProject').mockResolvedValue();
			jest.spyOn(storeHost, 'finishHydratedProject').mockResolvedValue();

			try {
				const firstLease = await host.beginHydratedProject(first.id, [first]);
				expect(
					(host as any).replacementGateOwnersByStory.get(first.id)?.size
				).toBe(1);
				expect(
					(host as any).replacementGateOwnersByStory.get(second.id)?.size
				).toBe(1);

				const currentLease = await host.beginHydratedProject(first.id, [first]);
				await host.abortHydratedProject(first.id, firstLease);
				expect(
					(host as any).replacementGateOwnersByStory.get(first.id)?.size
				).toBe(1);
				expect(
					(host as any).replacementGateOwnersByStory.get(second.id)?.size
				).toBe(1);

				if (terminal === 'finish') {
					await host.finishHydratedProject(first.id, currentLease);
				} else {
					await host.abortHydratedProject(first.id, currentLease);
				}
				expect((host as any).hydratedProjectLeases.size).toBe(0);
				expect((host as any).replacementGateOwnersByStory.size).toBe(0);
			} finally {
				deleteProjectMetadata(first.id);
				deleteProjectMetadata(second.id);
				host.dispose();
			}
		}
	});

	it('replaces an active stream before beginning a second pre-acquired reservation', async () => {
		for (const terminal of ['finish', 'abort'] as const) {
			const story = {
				...fakeStory(1),
				id: `overlapping-stream-reservations-${terminal}`
			};
			const host = new ProjectScopedCoreProjectHost([story], jest.fn());
			const storeHost = Array.from(
				((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
			)[0];
			const begin = jest
				.spyOn(storeHost, 'beginHydratedProject')
				.mockResolvedValue();
			const abort = jest
				.spyOn(storeHost, 'abortHydratedProject')
				.mockResolvedValue();
			jest.spyOn(storeHost, 'finishHydratedProject').mockResolvedValue();

			const firstReservation = await host.acquireProjectReplacement(story.id);
			const secondReservation = await host.acquireProjectReplacement(story.id);
			const firstLease = await host.beginHydratedProject(
				story.id,
				[story],
				firstReservation
			);
			const secondLease = await host.beginHydratedProject(
				story.id,
				[story],
				secondReservation
			);

			expect(abort).toHaveBeenCalledTimes(1);
			expect(abort.mock.invocationCallOrder[0]).toBeLessThan(
				begin.mock.invocationCallOrder[1]
			);
			expect((host as any).replacementGateOwners.size).toBe(1);

			if (terminal === 'finish') {
				await host.finishHydratedProject(story.id, secondLease);
			} else {
				await host.abortHydratedProject(story.id, secondLease);
			}
			expect((host as any).hydratedProjectLeases.size).toBe(0);
			expect((host as any).replacementGateOwners.size).toBe(0);

			await host.abortHydratedProject(story.id, firstLease);
			expect((host as any).replacementGateOwners.size).toBe(0);
			expect(abort).toHaveBeenCalledTimes(terminal === 'abort' ? 2 : 1);
			host.dispose();
		}
	});

	it('drains a pre-admitted global story tag rename before reserving any affected session', async () => {
		const first = {...fakeStory(0), id: 'global-rename-drain-first'};
		const second = {...fakeStory(0), id: 'global-rename-drain-second'};
		const host = new ProjectScopedCoreProjectHost([first, second], jest.fn());
		const [firstHost, secondHost] = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		);
		let finishFirst!: (batch: PatchBatch) => void;
		let finishSecond!: (batch: PatchBatch) => void;
		const applyFirst = jest
			.spyOn(firstHost, 'applyStoryCommand')
			.mockImplementation(
				() => new Promise<PatchBatch>(resolve => (finishFirst = resolve))
			);
		const applySecond = jest
			.spyOn(secondHost, 'applyStoryCommand')
			.mockImplementation(
				() => new Promise<PatchBatch>(resolve => (finishSecond = resolve))
			);
		const rename = host.applyStoryCommand(renameStoryTagCommand('old', 'new'));

		await waitFor(() => expect(applyFirst).toHaveBeenCalledTimes(1));
		let acquired = false;
		const reservation = host
			.acquireProjectReplacement(second.id)
			.then(lease => {
				acquired = true;
				return lease;
			});
		await waitFor(() =>
			expect(
				(host as any).replacementGateOwnersByStory.get(second.id)?.size
			).toBe(1)
		);
		expect(acquired).toBe(false);

		finishFirst({} as PatchBatch);
		await waitFor(() => expect(applySecond).toHaveBeenCalledTimes(1));
		finishSecond({} as PatchBatch);
		await rename;
		const lease = await reservation;
		await host.abortProjectReplacement(second.id, lease);
		expect((host as any).replacementGateOwners.size).toBe(0);
		host.dispose();
	});

	it('drains a pending planner before deleting its last session', async () => {
		const story = {...fakeStory(0), id: 'delete-pending-planner'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let planningSignal: AbortSignal | undefined;
		let resolvePlan!: (value: any) => void;
		jest
			.spyOn(storeHost, 'planPassageRename')
			.mockImplementation((_storyId, _request, options) => {
				planningSignal = options?.signal;
				return new Promise(resolve => (resolvePlan = resolve));
			});
		const removeSession = jest.spyOn((host as any).client, 'removeSession');
		const planning = host.planPassageRename(story.id, {
			afterName: 'R',
			passageId: 'p',
			storyId: story.id
		});
		await Promise.resolve();
		const deleting = host.deleteProjectStories([story.id], {
			history: 'skip',
			persistence: 'skip'
		});
		await waitFor(() => expect(planningSignal?.aborted).toBe(true));
		expect((host as any).hosts.size).toBe(1);
		expect(removeSession).not.toHaveBeenCalled();
		resolvePlan({type: 'cancelled'});
		await expect(planning).resolves.toEqual({type: 'cancelled'});
		await deleting;
		expect((host as any).hosts.size).toBe(0);
		expect(removeSession).toHaveBeenCalledTimes(1);
		host.dispose();
	});

	it('drains pending planners before explicit retirement and disposal', async () => {
		for (const action of ['retire', 'dispose'] as const) {
			const story = {...fakeStory(0), id: `pending-${action}`};
			const host = new ProjectScopedCoreProjectHost([story], jest.fn());
			const storeHost = Array.from(
				((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
			)[0];
			let planningSignal: AbortSignal | undefined;
			let release!: (value: any) => void;
			jest
				.spyOn(storeHost, 'planPassageRename')
				.mockImplementation((_storyId, _request, options) => {
					planningSignal = options?.signal;
					return new Promise(resolve => (release = resolve));
				});
			const removeSession = jest.spyOn((host as any).client, 'removeSession');
			const disposeClient = jest.spyOn((host as any).client, 'dispose');
			const planning = host.planPassageRename(story.id, {
				afterName: 'R',
				passageId: 'p',
				storyId: story.id
			});
			await Promise.resolve();
			const finished =
				action === 'retire'
					? host.retireProjectStories([story.id])
					: (host.dispose(), undefined);
			await waitFor(() => expect(planningSignal?.aborted).toBe(true));
			expect((host as any).hosts.size).toBe(1);
			expect(removeSession).not.toHaveBeenCalled();
			expect(disposeClient).not.toHaveBeenCalled();
			release({type: 'cancelled'});
			await expect(planning).resolves.toEqual({type: 'cancelled'});
			if (finished) await finished;
			if (action === 'retire') {
				expect(removeSession).toHaveBeenCalledTimes(1);
			} else {
				await waitFor(() => expect(disposeClient).toHaveBeenCalledTimes(1));
			}
			host.dispose();
		}
	});

	it('drains an admitted apply before retirement removes its session', async () => {
		const story = {...fakeStory(0), id: 'retire-pending-apply'};
		const dispatch = jest.fn();
		const host = new ProjectScopedCoreProjectHost([story], dispatch);
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let settle!: (result: any) => void;
		jest
			.spyOn(storeHost, 'applyRefactorPlan')
			.mockImplementation(
				() => new Promise(resolve => (settle = resolve)) as any
			);
		const remove = jest.spyOn((host as any).client, 'removeSession');
		const apply = host.applyRefactorPlan(story.id, {
			expectedProjectRevision: 1,
			planId: 'retire-pending',
			selection: {type: 'all'}
		});
		await waitFor(() => expect(storeHost.applyRefactorPlan).toHaveBeenCalled());
		const retire = host.retireProjectStories([story.id]);
		await Promise.resolve();
		expect(dispatch).not.toHaveBeenCalled();
		expect(remove).not.toHaveBeenCalled();
		settle({
			failure: {code: 'buffer-changed', message: 'stale'},
			type: 'failure'
		});
		await apply;
		await retire;
		expect(dispatch).toHaveBeenCalledWith(
			{storyIds: [story.id], type: 'retireProjectStories'},
			undefined
		);
		expect(remove).toHaveBeenCalledTimes(1);
		expect((host as any).replacementGateOwnersByStory.size).toBe(0);
		host.dispose();
	});

	it('does not retire a session when its pending persisted apply rejects', async () => {
		const story = {...fakeStory(1), id: 'retire-rejected-persisted-apply'};
		const persistenceError = new Error('save failed');
		let rejectPersistence!: (reason: Error) => void;
		const persistence = new Promise<void>((_resolve, reject) => {
			rejectPersistence = reject;
		});
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			if (
				typeof action !== 'function' &&
				action.type === 'applyCorePatchBatch' &&
				action.persistenceToken
			) {
				bindPersistenceCompletion(action.persistenceToken, {
					completion: persistence,
					persisted: true
				});
			}
		});
		const host = new ProjectScopedCoreProjectHost([story], dispatch);
		const remove = jest.spyOn((host as any).client, 'removeSession');

		const apply = host.applyStoryCommandPersisted(
			updatePassageTextCommand(story.id, story.passages[0].id, 'will reject')
		);
		await waitFor(() =>
			expect(dispatch).toHaveBeenCalledWith(
				expect.objectContaining({
					persistenceToken: expect.any(String),
					type: 'applyCorePatchBatch'
				}),
				expect.any(String)
			)
		);
		const retire = host.retireProjectStories([story.id]);
		await Promise.resolve();
		expect(dispatch).not.toHaveBeenCalledWith(
			{storyIds: [story.id], type: 'retireProjectStories'},
			undefined
		);
		expect(remove).not.toHaveBeenCalled();
		rejectPersistence(persistenceError);
		await expect(apply).rejects.toBe(persistenceError);
		await expect(retire).rejects.toBe(persistenceError);
		expect(remove).not.toHaveBeenCalled();
		expect((host as any).replacementGateOwnersByStory.size).toBe(0);
		host.dispose();
	});

	it('preserves a session reintroduced while a planner lifecycle drain is pending', async () => {
		const story = {...fakeStory(0), id: 'reintroduced-pending-planner'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let planningSignal: AbortSignal | undefined;
		let resolvePlan!: (value: any) => void;
		jest
			.spyOn(storeHost, 'planPassageRename')
			.mockImplementation((_storyId, _request, options) => {
				planningSignal = options?.signal;
				return new Promise(resolve => (resolvePlan = resolve));
			});
		const removeSession = jest.spyOn((host as any).client, 'removeSession');
		const planning = host.planPassageRename(story.id, {
			afterName: 'R',
			passageId: 'p',
			storyId: story.id
		});

		await Promise.resolve();
		host.update([], jest.fn());
		await waitFor(() => expect(planningSignal?.aborted).toBe(true));
		host.update([story], jest.fn());
		resolvePlan({summary: {planId: 'late'}, type: 'complete'});
		await expect(planning).resolves.toEqual({type: 'cancelled'});
		await Promise.resolve();
		await Promise.resolve();

		expect((host as any).hosts.get(`story:${story.id}`)).toBe(storeHost);
		expect(removeSession).not.toHaveBeenCalled();
		expect(host.refactorReviewSnapshot(story.id)).toEqual({
			encodedBytes: 0,
			pageCount: 0,
			summaryCount: 0
		});
		host.dispose();
	});

	it('freezes planner admission during renderer quit and reopens it after cancellation', async () => {
		const story = {...fakeStory(0), id: 'quit-planner'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		let planningSignal: AbortSignal | undefined;
		let release!: (value: any) => void;
		const plan = jest
			.spyOn(storeHost, 'planPassageRename')
			.mockImplementationOnce((_storyId, _request, options) => {
				planningSignal = options?.signal;
				return new Promise(resolve => (release = resolve));
			})
			.mockResolvedValue({type: 'cancelled'} as any);
		const pending = host.planPassageRename(story.id, {
			afterName: 'R',
			passageId: 'p',
			storyId: story.id
		});
		await Promise.resolve();
		const draining = rendererQuitQuiescence.drain();
		await waitFor(() => expect(planningSignal?.aborted).toBe(true));
		await expect(
			host.planPassageRename(story.id, {
				afterName: 'R',
				passageId: 'p',
				storyId: story.id
			})
		).resolves.toEqual({type: 'cancelled'});
		expect(plan).toHaveBeenCalledTimes(1);
		release({type: 'cancelled'});
		await expect(pending).resolves.toEqual({type: 'cancelled'});
		await draining;
		rendererQuitQuiescence.cancel();
		await expect(
			host.planPassageRename(story.id, {
				afterName: 'R',
				passageId: 'p',
				storyId: story.id
			})
		).resolves.toEqual({type: 'cancelled'});
		expect(plan).toHaveBeenCalledTimes(2);
		host.dispose();
	});

	it('rejects an oversized public rename request before routing it to a session', async () => {
		const story = {...fakeStory(0), id: 'rename-limit-story'};
		const host = new ProjectScopedCoreProjectHost([story], jest.fn());
		const storeHost = Array.from(
			((host as any).hosts as Map<string, StoreCoreProjectHost>).values()
		)[0];
		const plan = jest.spyOn(storeHost, 'planPassageRename');
		const fixedBytes = new TextEncoder().encode(story.id).byteLength + 1;
		const exactRequest = {
			afterName: 'x'.repeat(
				MAX_PASSAGE_RENAME_REQUEST_STRING_BYTES_V1 - fixedBytes
			),
			passageId: 'p',
			storyId: story.id
		};
		plan.mockResolvedValue({type: 'cancelled'});
		try {
			await host.planPassageRename(story.id, exactRequest);
			expect(plan).toHaveBeenCalledTimes(1);
			await expect(
				host.planPassageRename(story.id, {
					...exactRequest,
					afterName: `${exactRequest.afterName}x`
				})
			).resolves.toMatchObject({
				failure: {code: 'plan-too-large'},
				type: 'failure'
			});
			expect(plan).toHaveBeenCalledTimes(1);
		} finally {
			host.dispose();
		}
	});

	it('keeps provider disposal ABA-safe across scoped host replacement and disposal', async () => {
		const story = {...fakeStory(0), id: 'provider-host-story'};
		const dispatch = jest.fn();
		const host = new ProjectScopedCoreProjectHost([story], dispatch);
		const first = await host.registerRefactorSemanticProvider(story.id, {
			capabilityRevision: 1,
			formatVersion: 'test',
			identifier: 'provider-a'
		});
		const second = await host.registerRefactorSemanticProvider(story.id, {
			capabilityRevision: 2,
			formatVersion: 'test',
			identifier: 'provider-b'
		});
		const session = [...((host as any).hosts as Map<string, any>).values()][0];

		await first();
		expect(
			session.refactorRuntime.runtimeState(story.id, 1, []).provider
		).toEqual(expect.objectContaining({identifier: 'provider-b'}));
		saveProjectMetadata(story.id, {
			rootPath: '/native/provider-replacement.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		try {
			host.update([story], dispatch);
			const replacement = [
				...((host as any).hosts as Map<string, any>).values()
			].find(candidate => candidate !== session);
			expect(
				replacement.refactorRuntime.runtimeState(story.id, 1, []).provider
			).toBeNull();
			await second();
			expect(
				replacement.refactorRuntime.runtimeState(story.id, 1, []).provider
			).toBeNull();
		} finally {
			deleteProjectMetadata(story.id);
			host.dispose();
		}
	});
});

describe('global story tag rename', () => {
	function renameHost(options: {
		changed?: boolean;
		error?: Error;
		transactionId: number;
	}) {
		const batch = {
			label: 'Rename Story Tag',
			patches: [],
			transactionId: BigInt(options.transactionId)
		};
		const applyStoryCommand = options.error
			? jest.fn().mockRejectedValue(options.error)
			: jest.fn().mockResolvedValue(batch);
		const rollbackTransaction = jest.fn().mockResolvedValue(true);
		const host = {
			applyStoryCommand,
			rollbackTransaction,
			transactionTokenFor: () =>
				options.changed ? options.transactionId : undefined
		} as unknown as StoreCoreProjectHost;

		return {applyStoryCommand, host, rollbackTransaction};
	}

	it('rolls back only hosts changed by the failed rename', async () => {
		const unrelatedHistory = renameHost({transactionId: 7});
		const renamed = renameHost({changed: true, transactionId: 3});
		const failed = renameHost({
			error: new Error('rename failed'),
			transactionId: 2
		});
		const command = {
			new_name: 'new',
			old_name: 'old',
			type: 'renameStoryTag' as const
		};

		await expect(
			applyStoryTagRenameAcrossHosts(
				[unrelatedHistory.host, renamed.host, failed.host],
				command
			)
		).rejects.toThrow('rename failed');

		expect(unrelatedHistory.rollbackTransaction).not.toHaveBeenCalled();
		expect(renamed.rollbackTransaction).toHaveBeenCalledWith(3);
		expect(failed.rollbackTransaction).not.toHaveBeenCalled();
	});

	it('reports when a changed host can no longer be rolled back safely', async () => {
		const renamed = renameHost({changed: true, transactionId: 3});
		const failed = renameHost({
			error: new Error('rename failed'),
			transactionId: 4
		});

		renamed.rollbackTransaction.mockResolvedValue(false);
		await expect(
			applyStoryTagRenameAcrossHosts([renamed.host, failed.host], {
				new_name: 'new',
				old_name: 'old',
				type: 'renameStoryTag'
			})
		).rejects.toThrow(
			'Global story tag rename failed and 1 project could not be rolled back safely.'
		);
	});

	it('continues compensating hosts after one rollback rejects', async () => {
		const first = renameHost({changed: true, transactionId: 2});
		const second = renameHost({changed: true, transactionId: 3});
		const failed = renameHost({
			error: new Error('rename failed'),
			transactionId: 4
		});

		second.rollbackTransaction.mockRejectedValue(new Error('undo failed'));
		await expect(
			applyStoryTagRenameAcrossHosts([first.host, second.host, failed.host], {
				new_name: 'new',
				old_name: 'old',
				type: 'renameStoryTag'
			})
		).rejects.toThrow(
			'Global story tag rename failed and 1 project could not be rolled back safely.'
		);
		expect(second.rollbackTransaction).toHaveBeenCalledWith(3);
		expect(first.rollbackTransaction).toHaveBeenCalledWith(2);
	});
});

describe('useCoreProjectHost', () => {
	const CaptureHost: React.FC<{
		onHost: (host: CoreProjectHost) => void;
	}> = ({onHost}) => {
		const host = useCoreProjectHost();

		React.useLayoutEffect(() => onHost(host), [host, onHost]);
		return null;
	};
	const hostStoryIds = (host: CoreProjectHost) => {
		void host;
		return coreProjectHostPerformanceSnapshot().hosts.flatMap(snapshot =>
			snapshot.sessions.flatMap(session => session.storyIds)
		);
	};
	const providerTree = (
		stories: StoriesState,
		dispatch: (action: StoriesActionOrThunk) => void,
		children?: React.ReactNode
	) =>
		React.createElement(
			StoriesContext.Provider,
			{value: {dispatch, stories}},
			React.createElement(CoreProjectHostProvider, null, children)
		);

	it('requires an explicit provider', () => {
		expect(() => renderHook(() => useCoreProjectHost())).toThrow(
			'useCoreProjectHost must be used within a CoreProjectHostProvider.'
		);
	});

	it('returns a frozen story-scoped capability facade', () => {
		const stories = [fakeStory()];
		const wrapper: React.FC<React.PropsWithChildren> = ({children}) =>
			providerTree(stories, jest.fn(), children);
		const {result} = renderHook(() => useCoreProjectSession(stories[0].id), {
			wrapper
		});

		expect(Object.isFrozen(result.current)).toBe(true);
	});

	it('forwards replacement and hydration leases through the story-scoped facade', async () => {
		const story = fakeStory();
		const replacementLease = Symbol('replacement');
		const hydrationLease = Symbol('hydration');
		const mockedHost = {
			abortHydratedProject: jest.fn().mockResolvedValue(undefined),
			acquireProjectReplacement: jest.fn().mockResolvedValue(replacementLease),
			appendHydratedProjectPassages: jest.fn().mockResolvedValue(undefined),
			beginHydratedProject: jest.fn().mockResolvedValue(hydrationLease),
			finishHydratedProject: jest.fn().mockResolvedValue(undefined),
			initializeHydratedProject: jest.fn().mockResolvedValue(undefined),
			recoverFromSnapshot: jest.fn().mockResolvedValue(undefined)
		} as unknown as CoreProjectHost;
		const wrapper: React.FC<React.PropsWithChildren> = ({children}) =>
			React.createElement(
				CoreProjectHostContext.Provider,
				{value: mockedHost},
				children
			);
		const {result} = renderHook(() => useCoreProjectSession(story.id), {
			wrapper
		});

		await result.current.acquireProjectReplacement(story.id);
		await result.current.beginHydratedProject(
			story.id,
			[story],
			replacementLease
		);
		await result.current.initializeHydratedProject(
			story.id,
			[story],
			replacementLease
		);
		await result.current.recoverFromSnapshot(
			story.id,
			[story],
			[],
			replacementLease
		);
		await result.current.appendHydratedProjectPassages(
			story.id,
			[story.passages[0]],
			hydrationLease
		);
		await result.current.finishHydratedProject(story.id, hydrationLease);
		await result.current.abortHydratedProject(story.id, hydrationLease);

		expect(mockedHost.acquireProjectReplacement).toHaveBeenCalledWith(story.id);
		expect(mockedHost.beginHydratedProject).toHaveBeenCalledWith(
			story.id,
			[story],
			replacementLease
		);
		expect(mockedHost.initializeHydratedProject).toHaveBeenCalledWith(
			story.id,
			[story],
			replacementLease
		);
		expect(mockedHost.recoverFromSnapshot).toHaveBeenCalledWith(
			story.id,
			[story],
			[],
			replacementLease
		);
		expect(mockedHost.appendHydratedProjectPassages).toHaveBeenCalledWith(
			story.id,
			[story.passages[0]],
			hydrationLease
		);
		expect(mockedHost.finishHydratedProject).toHaveBeenCalledWith(
			story.id,
			hydrationLease
		);
		expect(mockedHost.abortHydratedProject).toHaveBeenCalledWith(
			story.id,
			hydrationLease
		);
	});

	it('admits a new story through Rust and emits one non-persisting patch batch', async () => {
		const sourceStory = fakeStory();
		const story = {
			...sourceStory,
			id: 'admitted-story',
			selected: true,
			passages: sourceStory.passages.map(passage => ({
				...passage,
				selected: true,
				story: 'admitted-story'
			}))
		};
		const dispatch = jest.fn();
		let capturedHost: CoreProjectHost | undefined;
		const rendered = render(
			providerTree(
				[],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);

		await capturedHost!.admitProjectStories([story], {
			history: 'skip',
			persistence: 'skip'
		});

		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [
					expect.objectContaining({
						props: expect.objectContaining({
							id: story.id,
							passages: [expect.objectContaining({selected: true})],
							selected: true
						}),
						type: 'createStory'
					})
				],
				documentUpdates: story.passages.map(passage => ({
					passageId: passage.id,
					storyId: story.id,
					text: passage.text,
					type: 'passageText'
				})),
				persistence: 'skip',
				type: 'applyCorePatchBatch'
			})
		);
		expect(hostStoryIds(capturedHost!)).toEqual([story.id]);
		await expect(
			capturedHost!.queryPassageDocumentAsync(story.id, story.passages[0].id)
		).resolves.toEqual(expect.objectContaining({text: story.passages[0].text}));
		rendered.unmount();
	});

	it('rolls back earlier session groups when grouped admission fails', async () => {
		const first = {...fakeStory(), id: 'first-admission'};
		const second = {...fakeStory(), id: 'second-admission'};
		first.passages = first.passages.map(passage => ({
			...passage,
			story: first.id
		}));
		second.passages = second.passages.map(passage => ({
			...passage,
			story: second.id
		}));
		const dispatch = jest.fn();
		let capturedHost: CoreProjectHost | undefined;
		const originalAdmission =
			StoreCoreProjectHost.prototype.admitProjectStories;
		const admission = jest
			.spyOn(StoreCoreProjectHost.prototype, 'admitProjectStories')
			.mockImplementation(function (
				this: StoreCoreProjectHost,
				stories,
				options
			) {
				if (stories.some(story => story.id === second.id)) {
					return Promise.reject(new Error('second session failed'));
				}
				return originalAdmission.call(this, stories, options);
			});
		const rendered = render(
			providerTree(
				[],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);

		await expect(
			capturedHost!.admitProjectStories([first, second], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toThrow('second session failed');
		expect(hostStoryIds(capturedHost!)).toEqual([]);
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [
					expect.objectContaining({storyId: first.id, type: 'deleteStory'})
				],
				persistence: 'skip',
				type: 'applyCorePatchBatch'
			})
		);
		await expect(
			capturedHost!.admitProjectStories([first], {
				history: 'skip',
				persistence: 'skip'
			})
		).resolves.toBeDefined();
		expect(hostStoryIds(capturedHost!)).toEqual([first.id]);

		admission.mockRestore();
		rendered.unmount();
	});

	it('durably rolls back an earlier admission group when a later group fails', async () => {
		const first = {...fakeStory(), id: 'first-persisted-admission'};
		const second = {...fakeStory(), id: 'second-persisted-admission'};

		first.passages = first.passages.map(passage => ({
			...passage,
			story: first.id
		}));
		second.passages = second.passages.map(passage => ({
			...passage,
			story: second.id
		}));
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			if (
				typeof action !== 'function' &&
				action.type === 'applyCorePatchBatch' &&
				action.persistenceToken
			) {
				bindPersistenceCompletion(action.persistenceToken, {
					completion: Promise.resolve(),
					persisted: true
				});
			}
		});
		let capturedHost: CoreProjectHost | undefined;
		const originalAdmission =
			StoreCoreProjectHost.prototype.admitProjectStories;
		const admission = jest
			.spyOn(StoreCoreProjectHost.prototype, 'admitProjectStories')
			.mockImplementation(function (
				this: StoreCoreProjectHost,
				stories,
				options
			) {
				if (stories.some(story => story.id === second.id)) {
					return Promise.reject(new Error('second persisted session failed'));
				}
				return originalAdmission.call(this, stories, options);
			});
		const rendered = render(
			providerTree(
				[],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);

		await expect(
			capturedHost!.admitProjectStories([first, second], {
				history: 'skip',
				persistence: 'save',
				persistenceBarrier: true
			})
		).rejects.toThrow('second persisted session failed');
		expect(hostStoryIds(capturedHost!)).toEqual([]);
		expect(dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [
					expect.objectContaining({storyId: first.id, type: 'deleteStory'})
				],
				persistenceToken: expect.any(String),
				type: 'applyCorePatchBatch'
			})
		);

		admission.mockRestore();
		rendered.unmount();
	});

	it('retains outer ownership when admission compensation is incomplete', async () => {
		const story = {...fakeStory(1), id: 'outer-incomplete-admission'};

		story.passages = story.passages.map(passage => ({
			...passage,
			story: story.id
		}));
		const dispatch = jest.fn();
		let capturedHost: CoreProjectHost | undefined;
		const admission = jest
			.spyOn(StoreCoreProjectHost.prototype, 'admitProjectStories')
			.mockRejectedValue(
				Object.assign(new Error('Core rollback failed'), {
					code: 'CORE_ADMISSION_ROLLBACK_INCOMPLETE'
				})
			);
		const rendered = render(
			providerTree(
				[],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);

		await expect(
			capturedHost!.admitProjectStories([story], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toEqual(
			expect.objectContaining({code: 'CORE_ADMISSION_ROLLBACK_INCOMPLETE'})
		);
		expect(hostStoryIds(capturedHost!)).toEqual([story.id]);
		await expect(
			capturedHost!.admitProjectStories([story], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toThrow('already bound to a core project session');

		admission.mockRestore();
		rendered.unmount();
	});

	it('clears outer ownership after deletion so the story can be re-admitted', async () => {
		const story = {...fakeStory(1), id: 'delete-and-readmit'};

		story.passages = story.passages.map(passage => ({
			...passage,
			story: story.id
		}));
		const dispatch = jest.fn();
		let capturedHost: CoreProjectHost | undefined;
		const rendered = render(
			providerTree(
				[story],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);

		await capturedHost!.deleteProjectStories([story.id], {
			history: 'skip',
			persistence: 'skip'
		});
		expect(hostStoryIds(capturedHost!)).toEqual([]);
		await expect(
			capturedHost!.admitProjectStories([story], {
				history: 'skip',
				persistence: 'skip'
			})
		).resolves.toBeDefined();
		expect(hostStoryIds(capturedHost!)).toEqual([story.id]);

		rendered.unmount();
	});

	it('restores earlier session groups when a later deletion fails', async () => {
		const first = {...fakeStory(1), id: 'first-delete-group'};
		const second = {...fakeStory(1), id: 'second-delete-group'};

		first.passages = first.passages.map(passage => ({
			...passage,
			story: first.id
		}));
		second.passages = second.passages.map(passage => ({
			...passage,
			story: second.id
		}));
		const dispatch = jest.fn();
		let capturedHost: CoreProjectHost | undefined;
		const originalDeletion =
			StoreCoreProjectHost.prototype.deleteProjectStories;
		const deletion = jest
			.spyOn(StoreCoreProjectHost.prototype, 'deleteProjectStories')
			.mockImplementation(function (
				this: StoreCoreProjectHost,
				storyIds,
				options
			) {
				return storyIds.includes(second.id)
					? Promise.reject(new Error('second deletion failed'))
					: originalDeletion.call(this, storyIds, options);
			});
		const rendered = render(
			providerTree(
				[first, second],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);

		await expect(
			capturedHost!.deleteProjectStories([first.id, second.id], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toThrow('second deletion failed');
		expect(hostStoryIds(capturedHost!)).toEqual([first.id, second.id]);
		await expect(
			capturedHost!.queryPassageDocumentAsync(first.id, first.passages[0].id)
		).resolves.toEqual(expect.objectContaining({text: first.passages[0].text}));

		deletion.mockRestore();
		rendered.unmount();
	});

	it('retains inner and outer ownership when grouped deletion recovery fails', async () => {
		const first = {...fakeStory(1), id: 'unresolved-first-delete-group'};
		const second = {...fakeStory(1), id: 'unresolved-second-delete-group'};

		first.passages = first.passages.map(passage => ({
			...passage,
			story: first.id
		}));
		second.passages = second.passages.map(passage => ({
			...passage,
			story: second.id
		}));
		const dispatch = jest.fn();
		let capturedHost: CoreProjectHost | undefined;
		const originalDeletion =
			StoreCoreProjectHost.prototype.deleteProjectStories;
		const deletion = jest
			.spyOn(StoreCoreProjectHost.prototype, 'deleteProjectStories')
			.mockImplementation(function (
				this: StoreCoreProjectHost,
				storyIds,
				options
			) {
				return storyIds.includes(second.id)
					? Promise.reject(new Error('second deletion failed'))
					: originalDeletion.call(this, storyIds, options);
			});
		const originalApply = StoreCoreProjectHost.prototype.applyStoryCommand;
		const apply = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockImplementation(function (
				this: StoreCoreProjectHost,
				command,
				options
			) {
				return command.type === 'batch' &&
					command.commands.some(
						candidate =>
							candidate.type === 'createStory' &&
							candidate.story.id === first.id
					)
					? Promise.reject(new Error('first deletion restore failed'))
					: originalApply.call(this, command, options);
			});
		const rendered = render(
			providerTree(
				[first, second],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);

		await expect(
			capturedHost!.deleteProjectStories([first.id, second.id], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toThrow('could not be restored');
		expect(hostStoryIds(capturedHost!)).toEqual([first.id, second.id]);
		await expect(
			capturedHost!.admitProjectStories([first], {
				history: 'skip',
				persistence: 'skip'
			})
		).rejects.toThrow('already bound to a core project session');
		expect(bootstrapStory(first.id)).toEqual(
			expect.objectContaining({id: first.id})
		);
		rendered.rerender(providerTree([second], dispatch));
		expect(hostStoryIds(capturedHost!)).toEqual([first.id, second.id]);

		apply.mockRestore();
		deletion.mockRestore();
		rendered.unmount();
	});

	it('does not let a throwing provider render mutate a live host with the same dispatch', () => {
		const dispatch = jest.fn();
		const liveStory = {...fakeStory(), id: 'live-story'};
		const abortedStory = {...fakeStory(), id: 'aborted-story'};
		let liveHost: CoreProjectHost | undefined;
		const live = render(
			providerTree(
				[liveStory],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						liveHost = host;
					}
				})
			)
		);
		const ThrowingChild = () => {
			throw new Error('aborted provider render');
		};

		expect(liveHost).toBeDefined();
		expect(hostStoryIds(liveHost!)).toEqual(['live-story']);
		expect(() =>
			render(
				providerTree(
					[abortedStory],
					dispatch,
					React.createElement(ThrowingChild)
				)
			)
		).toThrow('aborted provider render');
		expect(hostStoryIds(liveHost!)).toEqual(['live-story']);

		live.unmount();
	});

	it('retains its host, worker, and sessions when dispatch identity changes', () => {
		const story = {...fakeStory(), id: 'dispatch-story'};
		const initialHostCount = coreProjectHostPerformanceSnapshot().workerClients;
		let capturedHost: CoreProjectHost | undefined;
		const capture = (host: CoreProjectHost) => {
			capturedHost = host;
		};
		const tree = (dispatch: (action: StoriesActionOrThunk) => void) =>
			providerTree(
				[story],
				dispatch,
				React.createElement(CaptureHost, {onHost: capture})
			);
		const rendered = render(tree(jest.fn()));
		const initialHost = capturedHost;
		const initialSessions =
			coreProjectHostPerformanceSnapshot().hosts[0].sessions;

		rendered.rerender(tree(jest.fn()));

		expect(capturedHost).toBe(initialHost);
		expect(coreProjectHostPerformanceSnapshot().hosts[0].sessions).toEqual(
			initialSessions
		);
		expect(coreProjectHostPerformanceSnapshot().workerClients).toBe(
			initialHostCount + 1
		);
		rendered.unmount();
		expect(coreProjectHostPerformanceSnapshot().workerClients).toBe(
			initialHostCount
		);
	});

	it('rebinds a story when import changes its project root before replacement', async () => {
		window.localStorage.clear();
		const story = {...fakeStory(), id: 'import-rebind-story'};
		const oldRoot = '/native/old-import-root.twine.rs';
		const newRoot = '/native/new-import-root.twine.rs';
		const dispatch = jest.fn();
		let capturedHost: CoreProjectHost | undefined;

		saveProjectMetadata(story.id, {
			rootPath: oldRoot,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: true,
			rootPath: oldRoot
		});
		replaceKnownAssetInventoryForStory(story.id, []);
		const rendered = render(
			providerTree(
				[story],
				dispatch,
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);
		const replacement = {
			...story,
			passages: story.passages.map((passage, index) => ({
				...passage,
				id: `imported-passage-${index}`,
				text: `Imported body ${index}`
			})),
			startPassage: 'imported-passage-0'
		};

		registerStoryDocuments(story);
		saveProjectMetadata(story.id, {
			rootPath: newRoot,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: true,
			rootPath: newRoot
		});
		await expect(
			capturedHost!.applyStoryCommand(
				replaceStoryCommand(story.id, replacement)
			)
		).rejects.toMatchObject({code: 'CORE_PROJECT_REPLACEMENT_IN_PROGRESS'});
		expect(dispatch).not.toHaveBeenCalled();
		await waitFor(() =>
			expect(coreProjectHostPerformanceSnapshot().hosts[0].sessions).toEqual([
				expect.objectContaining({
					sessionId: `project:${newRoot}`,
					storyIds: [story.id]
				})
			])
		);
		await capturedHost!.applyStoryCommand(
			replaceStoryCommand(story.id, replacement)
		);
		expect(dispatch).toHaveBeenCalledTimes(1);
		const dispatched = dispatch.mock.calls[0][0];

		expect(dispatched).toEqual(
			expect.objectContaining({type: 'applyCorePatchBatch'})
		);
		expect(dispatched.actions).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					props: expect.objectContaining({id: 'imported-passage-0'}),
					storyId: story.id,
					type: 'createPassage'
				})
			])
		);
		expect(dispatched.documentUpdates).toEqual([
			{
				passageId: 'imported-passage-0',
				storyId: story.id,
				text: 'Imported body 0',
				type: 'passageText'
			}
		]);

		expect(coreProjectHostPerformanceSnapshot().hosts[0].sessions).toEqual([
			expect.objectContaining({
				sessionId: `project:${newRoot}`,
				storyIds: [story.id]
			})
		]);
		await expect(
			capturedHost!.queryDocumentPageAsync(story.id, {limit: 10})
		).resolves.toEqual(
			expect.objectContaining({
				documents: expect.arrayContaining([
					expect.objectContaining({
						kind: 'passage',
						text: 'Imported body 0'
					})
				])
			})
		);
		rendered.unmount();
		window.localStorage.clear();
	});

	it('refreshes an uninitialized session from a registered document transport', async () => {
		window.localStorage.clear();
		const completeStory = {
			...fakeStory(),
			id: 'import-refresh-story'
		};
		const story = metadataStory(completeStory);
		const root = '/native/existing-import-root.twine.rs';
		let capturedHost: CoreProjectHost | undefined;

		saveProjectMetadata(story.id, {
			rootPath: root,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: true,
			rootPath: root
		});
		replaceKnownAssetInventoryForStory(story.id, []);
		const rendered = render(
			providerTree(
				[story],
				jest.fn(),
				React.createElement(CaptureHost, {
					onHost: host => {
						capturedHost = host;
					}
				})
			)
		);

		registerStoryDocuments(completeStory);
		await capturedHost!.ensureSessionReady(story.id);

		await expect(
			capturedHost!.queryDocumentPageAsync(story.id, {limit: 10})
		).resolves.toEqual(
			expect.objectContaining({
				documents: expect.arrayContaining([
					expect.objectContaining({
						kind: 'passage',
						text: completeStory.passages[0].text
					})
				])
			})
		);
		rendered.unmount();
		window.localStorage.clear();
	});

	it('creates distinct hosts for providers that share a dispatch', () => {
		const story = fakeStory();
		const dispatch = jest.fn();
		const hosts: CoreProjectHost[] = [];
		const capture = (index: number) => (host: CoreProjectHost) => {
			hosts[index] = host;
		};
		const initialHostCount = coreProjectHostPerformanceSnapshot().workerClients;
		const rendered = render(
			React.createElement(
				StoriesContext.Provider,
				{value: {dispatch, stories: [story]}},
				React.createElement(
					React.Fragment,
					null,
					React.createElement(
						CoreProjectHostProvider,
						null,
						React.createElement(CaptureHost, {onHost: capture(0)})
					),
					React.createElement(
						CoreProjectHostProvider,
						null,
						React.createElement(CaptureHost, {onHost: capture(1)})
					)
				)
			)
		);

		expect(hosts).toHaveLength(2);
		expect(hosts[0]).not.toBe(hosts[1]);
		expect(coreProjectHostPerformanceSnapshot().workerClients).toBe(
			initialHostCount + 2
		);
		rendered.unmount();
		expect(coreProjectHostPerformanceSnapshot().workerClients).toBe(
			initialHostCount
		);
	});

	it('disposes StrictMode replay hosts and the committed host on unmount', async () => {
		const story = fakeStory();
		const initialHostCount = coreProjectHostPerformanceSnapshot().workerClients;
		const {unmount} = render(
			React.createElement(
				React.StrictMode,
				null,
				providerTree([story], jest.fn())
			)
		);

		expect(coreProjectHostPerformanceSnapshot().workerClients).toBe(
			initialHostCount + 1
		);
		unmount();
		await waitFor(() =>
			expect(coreProjectHostPerformanceSnapshot().workerClients).toBe(
				initialHostCount
			)
		);
	});
});
