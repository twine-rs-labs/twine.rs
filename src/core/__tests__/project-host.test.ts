import {render, renderHook, waitFor} from '@testing-library/react';
import * as React from 'react';
import {
	CoreAssetInventoryEntry,
	movePassagesCommand,
	PatchBatch,
	queryGraphProjectionCommand,
	renameStoryCommand,
	replaceStoryCommand,
	setStoryFormatCommand,
	setStorySnapToGridCommand,
	setStoryZoomCommand,
	StoryCommand,
	updatePassageTextCommand
} from '..';
import {
	knownAssetInventoryForStory,
	replaceKnownAssetInventoryForStory,
	coreProjectHostPerformanceSnapshot,
	CoreProjectHost,
	CoreProjectHostProvider,
	StoreCoreProjectHost,
	useCoreProjectHost
} from '../project-host';
import {reducer as storiesReducer} from '../../store/stories/reducer';
import {StoriesContext, StoriesState} from '../../store/stories';
import {StoriesActionOrThunk} from '../../store/stories';
import {markProjectStoryHydration} from '../../store/project-hydration';
import {fakePassage, fakeStory} from '../../test-util';
import {createTestCoreSessionClient} from '../../test-util/test-core-session-client';

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
			cachedGraphProjection: jest.fn(),
			cachedStoryIndex: jest.fn(),
			enabled: true,
			lastGraphProjection: jest.fn(),
			ingestExternalDelta: jest.fn(),
			mode: 'wasm-worker',
			queryGraphProjection: jest.fn(),
			queryStoryIndex: jest.fn(),
			redo: jest.fn(),
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
			})
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
		const applyProjectAssetEffect = jest.fn().mockResolvedValue(undefined);
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
			['effect-1', 'redo']
		]);
		delete (window as any).twineElectron;
	});

	it('rolls back a prepared native asset effect when Rust rejects it', async () => {
		const applyProjectAssetEffect = jest.fn().mockResolvedValue(undefined);
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
		expect(discardProjectAssetEffect).toHaveBeenCalledWith('effect-2');
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
});

describe('useCoreProjectHost', () => {
	type HostWithDiagnostics = CoreProjectHost & {
		performanceDiagnostics(): {
			sessions: Array<{sessionId: string; storyIds: string[]}>;
		};
	};
	const CaptureHost: React.FC<{
		onHost: (host: CoreProjectHost) => void;
	}> = ({onHost}) => {
		const host = useCoreProjectHost();

		React.useLayoutEffect(() => onHost(host), [host, onHost]);
		return null;
	};
	const hostStoryIds = (host: CoreProjectHost) =>
		(host as HostWithDiagnostics)
			.performanceDiagnostics()
			.sessions.flatMap(session => session.storyIds);
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
		const initialSessions = (
			initialHost as HostWithDiagnostics
		).performanceDiagnostics().sessions;

		rendered.rerender(tree(jest.fn()));

		expect(capturedHost).toBe(initialHost);
		expect(
			(capturedHost as HostWithDiagnostics).performanceDiagnostics().sessions
		).toEqual(initialSessions);
		expect(coreProjectHostPerformanceSnapshot().workerClients).toBe(
			initialHostCount + 1
		);
		rendered.unmount();
		expect(coreProjectHostPerformanceSnapshot().workerClients).toBe(
			initialHostCount
		);
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
