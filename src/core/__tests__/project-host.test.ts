import {renderHook} from '@testing-library/react-hooks';
import * as React from 'react';
import {
	CoreAssetInventoryEntry,
	PatchBatch,
	queryGraphProjectionCommand,
	renameStoryCommand,
	setStoryFormatCommand,
	setStorySnapToGridCommand,
	setStoryZoomCommand,
	StoryCommand,
	updatePassageTextCommand
} from '..';
import {
	knownAssetInventoryForStory,
	StoreCoreProjectHost,
	useCoreProjectHost
} from '../project-host';
import {reducer as storiesReducer} from '../../store/stories/reducer';
import {StoriesContext, StoriesState} from '../../store/stories';
import {StoriesActionOrThunk} from '../../store/stories';
import {fakePassage, fakeStory} from '../../test-util';

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
			mode: 'wasm-worker',
			queryGraphProjection: jest.fn(),
			queryStoryIndex: jest.fn(),
			redo: jest.fn(),
			replaceProject: jest.fn().mockResolvedValue(undefined),
			undo: jest.fn()
		};
	}

	async function flushCommand() {
		for (let i = 0; i < 8; i++) {
			await Promise.resolve();
		}
	}

	function hostWithStory(options: {wasmClient?: any} = {}) {
		const story = fakeStory(0);
		const start = fakePassage({
			id: 'start',
			name: 'Start',
			story: story.id,
			text: ''
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
		expect(context.stories[0].passages[0].text).toBe('from-rust');
		expect(context.stories[0].passages[0].text).not.toBe('from-command');
		expect(context.host.isDirty()).toBe(true);
		expect(context.dispatch).toHaveBeenCalledWith(
			expect.objectContaining({
				actions: [
					expect.objectContaining({
						passageId: 'start',
						props: {text: 'from-rust'},
						type: 'updatePassage'
					})
				],
				type: 'applyCorePatchBatch'
			}),
			'undoChange.editPassage'
		);
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
	it('uses stories context when no undoable stories provider exists', () => {
		const story = fakeStory();
		const wrapper: React.FC = ({children}) =>
			React.createElement(
				StoriesContext.Provider,
				{value: {dispatch: jest.fn(), stories: [story]}},
				children
			);
		const {result} = renderHook(() => useCoreProjectHost(), {wrapper});

		expect(result.current.queryStoryIndex(story.id).storyId).toBe(story.id);
	});
});
