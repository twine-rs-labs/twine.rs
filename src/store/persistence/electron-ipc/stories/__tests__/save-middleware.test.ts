import {saveMiddleware} from '../save-middleware';
import {StoryFormatsState} from '../../../../story-formats';
import {StoriesAction, StoriesState} from '../../../../stories';
import {fakeLoadedStoryFormat, fakeStory} from '../../../../../test-util';
import {TwineElectronWindow} from '../../../../../electron/shared';
import {saveProjectMetadata} from '../../../../project-metadata';
import {saveStory} from '../save-story';
import {metadataStory} from '../../../../../core/bootstrap-stories';

jest.mock('../save-story');

describe('stories Electron IPC save middleware', () => {
	const saveStoryMock = saveStory as jest.Mock;
	let deleteStory: jest.SpyInstance;
	let formatsState: StoryFormatsState;
	let renameStory: jest.SpyInstance;
	let storiesState: StoriesState;

	beforeEach(() => {
		window.localStorage.clear();
		formatsState = [fakeLoadedStoryFormat()];
		deleteStory = jest.fn(async () => undefined);
		renameStory = jest.fn(async () => undefined);
		saveStoryMock.mockResolvedValue(undefined);
		storiesState = [metadataStory(fakeStory(2))];
		storiesState[0].storyFormat = formatsState[0].name;
		storiesState[0].storyFormatVersion = formatsState[0].version;
		(window as any).twineElectron = {
			deleteStory,
			renameStory
		};
		jest.spyOn(console, 'warn').mockReturnValue();

		// Certain actions need to see the state at least once first.

		saveMiddleware(
			storiesState,
			{
				type: 'init',
				state: storiesState
			},
			formatsState
		);
	});

	afterEach(() => {
		window.localStorage.clear();
		delete (window as TwineElectronWindow).twineElectron;
	});

	it.each([
		['init', () => ({type: 'init', state: []})],
		[
			'repair',
			() => ({
				type: 'repair',
				allFormats: formatsState,
				defaultFormat: formatsState[0]
			})
		]
	])('takes no action when a %s action is received', (_, action) => {
		expect(
			saveMiddleware(storiesState, action() as StoriesAction, formatsState)
		).toBe(false);
		expect(deleteStory).not.toHaveBeenCalled();
		expect(renameStory).not.toHaveBeenCalled();
		expect(saveStoryMock).not.toHaveBeenCalled();
	});

	it('does not save an externally persisted core patch batch', () => {
		expect(
			saveMiddleware(
				storiesState,
				{
					actions: [
						{
							passageId: storiesState[0].passages[0].id,
							props: {name: 'from disk'},
							storyId: storiesState[0].id,
							type: 'updatePassage'
						}
					],
					persistence: 'skip',
					type: 'applyCorePatchBatch'
				},
				formatsState
			)
		).toBe(false);
		expect(saveStoryMock).not.toHaveBeenCalled();
	});

	it('does not delete a coexisting legacy HTML story for a native project patch deletion', async () => {
		const story = storiesState[0];

		const result = saveMiddleware(
			[],
			{
				actions: [
					{
						storageKind: 'electron-project-folder',
						storyId: story.id,
						type: 'deleteStory'
					}
				],
				storyIds: [story.id],
				type: 'applyCorePatchBatch'
			},
			formatsState
		);

		expect(typeof result).toBe('object');
		if (typeof result === 'object') {
			await result.completion;
		}
		expect(deleteStory).not.toHaveBeenCalled();
	});

	it('overlays session-owned document text only for persistence', async () => {
		const story = storiesState[0];
		const passage = story.passages[0];
		const result = saveMiddleware(
			storiesState,
			{
				actions: [],
				documentUpdates: [
					{
						passageId: passage.id,
						storyId: story.id,
						text: 'session text',
						type: 'passageText'
					}
				],
				storyIds: [story.id],
				type: 'applyCorePatchBatch'
			},
			formatsState
		);

		expect(typeof result).toBe('object');
		if (typeof result === 'object') {
			await result.completion;
		}
		expect(saveStoryMock).toHaveBeenCalledWith(
			story,
			formatsState,
			expect.objectContaining({
				documentUpdates: [
					{
						passageId: passage.id,
						storyId: story.id,
						text: 'session text',
						type: 'passageText'
					}
				]
			})
		);
		expect('text' in storiesState[0].passages[0]).toBe(false);
	});

	it('registers session saves before they wait behind renderer work', async () => {
		let finishFirstSave: () => void = () => {};
		const firstSave = new Promise<void>(resolve => {
			finishFirstSave = resolve;
		});

		saveStoryMock
			.mockReturnValueOnce(firstSave)
			.mockResolvedValueOnce(undefined);
		const first = saveMiddleware(
			storiesState,
			{
				actions: [],
				revision: 1,
				sessionId: 'session-1',
				storyIds: [storiesState[0].id],
				type: 'applyCorePatchBatch'
			},
			formatsState
		);
		const second = saveMiddleware(
			storiesState,
			{
				actions: [],
				revision: 2,
				sessionId: 'session-1',
				storyIds: [storiesState[0].id],
				type: 'applyCorePatchBatch'
			},
			formatsState
		);

		// The first action begins its per-story operation while the second remains
		// queued by session, but both already returned completion promises.

		expect(saveStoryMock).toHaveBeenCalledTimes(1);
		finishFirstSave();
		if (typeof first === 'object') {
			await first.completion;
		}
		if (typeof second === 'object') {
			await second.completion;
		}
		expect(saveStoryMock).toHaveBeenCalledTimes(2);
	});

	it('persists every queued session save in order', async () => {
		let finishFirstSave: () => void = () => {};

		saveStoryMock
			.mockReturnValueOnce(
				new Promise<void>(resolve => {
					finishFirstSave = resolve;
				})
			)
			.mockResolvedValue(undefined);
		const story = storiesState[0];
		const documentUpdates = [
			{
				passageId: story.passages[0].id,
				storyId: story.id,
				text: 'first passage',
				type: 'passageText' as const
			},
			{
				passageId: story.passages[1].id,
				storyId: story.id,
				text: 'second passage',
				type: 'passageText' as const
			},
			{
				storyId: story.id,
				text: 'story script',
				type: 'script' as const
			}
		];
		const saves = documentUpdates.map((documentUpdate, index) =>
			saveMiddleware(
				storiesState,
				{
					actions: [],
					documentUpdates: [documentUpdate],
					persistenceHints: [
						documentUpdate.type === 'passageText'
							? {
									passageId: documentUpdate.passageId,
									storyId: story.id,
									type: 'passageText' as const
								}
							: {storyId: story.id, type: 'script' as const}
					],
					revision: index + 1,
					sessionId: 'session-1',
					storyIds: [story.id],
					type: 'applyCorePatchBatch'
				},
				formatsState
			)
		);

		expect(saveStoryMock).toHaveBeenCalledTimes(1);
		finishFirstSave();
		await Promise.all(
			saves.map(save =>
				typeof save === 'object' ? save.completion : undefined
			)
		);
		expect(saveStoryMock).toHaveBeenCalledTimes(3);
		expect(
			saveStoryMock.mock.calls.map(([, , options]) => options.documentUpdates)
		).toEqual(documentUpdates.map(update => [update]));
	});

	it.each([
		[
			'createPassage',
			() => ({
				type: 'createPassage',
				props: {name: storiesState[0].passages[0].name},
				storyId: storiesState[0].id
			})
		],
		[
			'createPassages',
			() => ({
				type: 'createPassages',
				props: {name: storiesState[0].passages[0].name},
				storyId: storiesState[0].id
			})
		],
		[
			'createStory',
			() => ({
				type: 'createStory',
				props: {name: storiesState[0].name}
			})
		],
		[
			'deletePassage',
			() => ({
				type: 'deletePassage',
				passageId: storiesState[0].passages[0].id,
				storyId: storiesState[0].id
			})
		],
		[
			'updatePassage',
			() => ({
				type: 'updatePassage',
				props: {name: storiesState[0].passages[0].name},
				passageId: storiesState[0].passages[0].id,
				storyId: storiesState[0].id
			})
		],
		[
			'updatePassages',
			() => ({
				type: 'updatePassages',
				passageUpdates: {
					[storiesState[0].passages[0].id]: {
						name: storiesState[0].passages[0].name
					},
					[storiesState[0].passages[1].id]: {
						name: storiesState[0].passages[1].name
					}
				},
				storyId: storiesState[0].id
			})
		],
		[
			'non-name updateStory',
			() => ({
				type: 'updateStory',
				props: {zoom: 1},
				storyId: storiesState[0].id
			})
		]
	])(
		'calls and awaits saveStory() when a %s action is received',
		(_, action) => {
			expect(
				saveMiddleware(storiesState, action() as StoriesAction, formatsState)
			).toEqual({completion: expect.any(Promise), persisted: true});
			expect(saveStoryMock.mock.calls).toEqual([
				[storiesState[0], formatsState]
			]);
		}
	);

	it('does nothing if a trivial updatePassage action is received', () => {
		expect(
			saveMiddleware(
				storiesState,
				{
					type: 'updatePassage',
					passageId: storiesState[0].passages[0].id,
					props: {selected: true},
					storyId: storiesState[0].id
				},
				formatsState
			)
		).toBe(false);
		expect(saveStoryMock).not.toHaveBeenCalled();
	});

	it('does nothing if a trivial updateStory action is received', () => {
		expect(
			saveMiddleware(
				storiesState,
				{
					type: 'updateStory',
					props: {selected: true},
					storyId: storiesState[0].id
				},
				formatsState
			)
		).toBe(false);
		expect(saveStoryMock).not.toHaveBeenCalled();
	});

	describe('when a createStory action is received', () => {
		it('throws an error if the story created has no name', () =>
			expect(() =>
				saveMiddleware(
					storiesState,
					{
						type: 'createStory',
						props: {}
					},
					formatsState
				)
			).toThrow());

		it("throws an error if the story doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(
					storiesState,
					{
						type: 'createStory',
						props: {name: 'bad'}
					},
					formatsState
				)
			).toThrow());
	});

	describe('when a deleteStory action is received', () => {
		it('calls and awaits deleteStory on the twineElectron global', () => {
			expect(
				saveMiddleware(
					storiesState,
					{
						type: 'deleteStory',
						storyId: storiesState[0].id
					},
					formatsState
				)
			).toEqual({completion: expect.any(Promise), persisted: true});
			expect(deleteStory.mock.calls).toEqual([[storiesState[0]]]);
		});

		it("throws an error if the story doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(
					storiesState,
					{
						type: 'deleteStory',
						storyId: 'bad'
					},
					formatsState
				)
			).toThrow());

		it('does not surface a missing legacy file for a native project deletion', () => {
			deleteStory.mockRejectedValueOnce(
				Object.assign(new Error('missing legacy file'), {code: 'ENOENT'})
			);
			saveProjectMetadata(storiesState[0].id, {
				rootPath: '/native/no-legacy-copy.twine.rs',
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});

			expect(
				saveMiddleware(
					[],
					{type: 'deleteStory', storyId: storiesState[0].id},
					formatsState
				)
			).toBe(false);
			expect(deleteStory).not.toHaveBeenCalled();
		});

		it('rejects the persistence completion when deletion fails', async () => {
			const error = new Error('delete failed');

			deleteStory.mockRejectedValueOnce(error);
			const result = saveMiddleware(
				storiesState,
				{type: 'deleteStory', storyId: storiesState[0].id},
				formatsState
			);

			expect(typeof result).toBe('object');
			if (typeof result === 'object') {
				await expect(result.completion).rejects.toBe(error);
			}
		});

		it('waits for an older asynchronous story save before deleting', async () => {
			let finishSave: () => void = () => {};

			saveStoryMock.mockReturnValueOnce(
				new Promise<void>(resolve => {
					finishSave = resolve;
				})
			);
			const save = saveMiddleware(
				storiesState,
				{
					props: {zoom: 1},
					storyId: storiesState[0].id,
					type: 'updateStory'
				},
				formatsState
			);
			const deletion = saveMiddleware(
				storiesState,
				{storyId: storiesState[0].id, type: 'deleteStory'},
				formatsState
			);

			expect(deleteStory).not.toHaveBeenCalled();
			finishSave();
			if (typeof save === 'object') {
				await save.completion;
			}
			if (typeof deletion === 'object') {
				await deletion.completion;
			}
			expect(deleteStory).toHaveBeenCalledWith(storiesState[0]);
		});
	});

	describe("when an updateStory action is received that changes a story's name", () => {
		it('calls and awaits renameStory on the twineElectron global', () => {
			const origName = storiesState[0].name;

			storiesState[0] = {...storiesState[0], name: 'new-name'};
			expect(
				saveMiddleware(
					storiesState,
					{
						type: 'updateStory',
						props: {name: 'new-name'},
						storyId: storiesState[0].id
					},
					formatsState
				)
			).toEqual({completion: expect.any(Promise), persisted: true});
			expect(renameStory.mock.calls).toEqual([
				[{...storiesState[0], name: origName}, storiesState[0]]
			]);
		});

		it('saves the renamed story only after the rename is acknowledged', async () => {
			let finishRename: () => void = () => {};

			renameStory.mockReturnValue(
				new Promise<void>(resolve => {
					finishRename = resolve;
				})
			);
			const result = saveMiddleware(
				storiesState,
				{
					type: 'updateStory',
					props: {name: 'new-name'},
					storyId: storiesState[0].id
				},
				formatsState
			);

			expect(result).toEqual({
				completion: expect.any(Promise),
				persisted: true
			});
			expect(saveStoryMock).not.toHaveBeenCalled();
			finishRename();
			if (typeof result === 'object') {
				await result.completion;
			}
			expect(saveStoryMock.mock.calls).toEqual([
				[storiesState[0], formatsState]
			]);
		});

		it('does not save and rejects completion when renaming fails', async () => {
			const error = new Error('rename failed');

			renameStory.mockRejectedValueOnce(error);
			const result = saveMiddleware(
				storiesState,
				{
					props: {name: 'new-name'},
					storyId: storiesState[0].id,
					type: 'updateStory'
				},
				formatsState
			);

			expect(typeof result).toBe('object');
			if (typeof result === 'object') {
				await expect(result.completion).rejects.toBe(error);
			}
			expect(saveStoryMock).not.toHaveBeenCalled();
		});

		it('waits for older asynchronous save preparation before renaming', async () => {
			let finishSave: () => void = () => {};
			const oldStory = storiesState[0];

			saveStoryMock
				.mockReturnValueOnce(
					new Promise<void>(resolve => {
						finishSave = resolve;
					})
				)
				.mockResolvedValueOnce(undefined);
			const save = saveMiddleware(
				storiesState,
				{
					props: {zoom: 1},
					storyId: oldStory.id,
					type: 'updateStory'
				},
				formatsState
			);
			storiesState = [{...oldStory, name: 'new-name'}];
			const rename = saveMiddleware(
				storiesState,
				{
					props: {name: 'new-name'},
					storyId: oldStory.id,
					type: 'updateStory'
				},
				formatsState
			);

			expect(renameStory).not.toHaveBeenCalled();
			finishSave();
			if (typeof save === 'object') {
				await save.completion;
			}
			if (typeof rename === 'object') {
				await rename.completion;
			}
			expect(renameStory).toHaveBeenCalledWith(oldStory, storiesState[0]);
			expect(saveStoryMock).toHaveBeenLastCalledWith(
				storiesState[0],
				formatsState
			);
		});

		it('saves file-backed project stories without renaming legacy HTML', () => {
			storiesState[0] = {...storiesState[0], name: 'new-name'};
			saveProjectMetadata(storiesState[0].id, {
				rootPath: '/native/moon-castle.twine.rs',
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});

			expect(
				saveMiddleware(
					storiesState,
					{
						type: 'updateStory',
						props: {name: 'new-name'},
						storyId: storiesState[0].id
					},
					formatsState
				)
			).toEqual({completion: expect.any(Promise), persisted: true});
			expect(renameStory).not.toHaveBeenCalled();
			expect(saveStoryMock.mock.calls).toEqual([
				[storiesState[0], formatsState]
			]);
		});
	});

	it('does nothing if an unexpected action is received', () => {
		expect(
			saveMiddleware(storiesState, {type: '???'} as any, formatsState)
		).toBe(false);
		expect(deleteStory).not.toHaveBeenCalled();
		expect(renameStory).not.toHaveBeenCalled();
		expect(saveStoryMock).not.toHaveBeenCalled();
	});
});
