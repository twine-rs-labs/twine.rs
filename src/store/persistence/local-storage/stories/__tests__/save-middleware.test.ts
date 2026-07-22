import {saveMiddleware} from '../save-middleware';
import {
	deletePassageById,
	deleteStory,
	doUpdateTransaction,
	savePassage,
	saveStory
} from '../save';
import {StoriesState} from '../../../../stories/stories.types';
import {fakeStory} from '../../../../../test-util';
import {
	clearBootstrapStories,
	metadataStory,
	registerStoryDocuments
} from '../../../../../core/bootstrap-stories';

jest.mock('../save');

describe('stories local storage save middleware', () => {
	let state: StoriesState;
	const deletePassageByIdMock = deletePassageById as jest.Mock;
	const deleteStoryMock = deleteStory as jest.Mock;
	const doUpdateTransactionMock = doUpdateTransaction as jest.Mock;
	const savePassageMock = savePassage as jest.Mock;
	const saveStoryMock = saveStory as jest.Mock;
	let warnSpy: jest.SpyInstance;

	beforeEach(() => {
		state = [fakeStory()];
		window.localStorage.clear();
		warnSpy = jest.spyOn(console, 'warn').mockReturnValue();
	});

	afterEach(clearBootstrapStories);

	it('takes no action when an init action is received', () => {
		expect(saveMiddleware(state, {type: 'init', state: []})).toBe(false);
		expect(doUpdateTransactionMock).not.toHaveBeenCalled();
		expect(savePassageMock).not.toHaveBeenCalled();
		expect(saveStoryMock).not.toHaveBeenCalled();
	});

	it('takes no action when a repair action is received', () => {
		saveMiddleware(state, {type: 'init', state: []});
		expect(doUpdateTransactionMock).not.toHaveBeenCalled();
		expect(savePassageMock).not.toHaveBeenCalled();
		expect(saveStoryMock).not.toHaveBeenCalled();
	});

	it('does not save an externally persisted core patch batch', () => {
		expect(
			saveMiddleware(state, {
				actions: [
					{
						passageId: state[0].passages[0].id,
						props: {name: 'from disk'},
						storyId: state[0].id,
						type: 'updatePassage'
					}
				],
				persistence: 'skip',
				type: 'applyCorePatchBatch'
			})
		).toEqual({completion: expect.any(Promise), persisted: false});
		expect(doUpdateTransactionMock).not.toHaveBeenCalled();
		expect(saveStoryMock).not.toHaveBeenCalled();
	});

	it('persists a core document update without reading stale React text', () => {
		const transaction = {passageIds: '', storyIds: ''};
		const passage = state[0].passages[0];

		saveMiddleware(state, {
			actions: [],
			documentUpdates: [
				{
					passageId: passage.id,
					storyId: state[0].id,
					text: 'session body',
					type: 'passageText'
				}
			],
			storyIds: [state[0].id],
			type: 'applyCorePatchBatch'
		});
		doUpdateTransactionMock.mock.calls[0][0](transaction);

		expect(savePassageMock).toHaveBeenCalledWith(transaction, {
			...passage,
			text: 'session body'
		});
	});

	it('preserves the stored body during a metadata-only core update', () => {
		const transaction = {passageIds: '', storyIds: ''};
		const passage = state[0].passages[0];

		window.localStorage.setItem(
			`twine-passages-${passage.id}`,
			JSON.stringify({...passage, text: 'stored session body'})
		);
		saveMiddleware(state, {
			actions: [
				{
					passageId: passage.id,
					props: {name: passage.name},
					storyId: state[0].id,
					type: 'updatePassage'
				}
			],
			type: 'applyCorePatchBatch'
		});
		doUpdateTransactionMock.mock.calls[0][0](transaction);

		expect(savePassageMock).toHaveBeenCalledWith(transaction, {
			...passage,
			text: 'stored session body'
		});
	});

	describe('when a createPassage action is received', () => {
		it('saves the story using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			expect(
				saveMiddleware(state, {
					type: 'createPassage',
					props: {name: state[0].passages[0].name},
					storyId: state[0].id
				})
			).toBe(true);
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(savePassageMock.mock.calls).toEqual([
				[transaction, state[0].passages[0]]
			]);
			expect(saveStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it('throws an error if the passage created has no name', () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'createPassage',
					props: {},
					storyId: state[0].id
				})
			).toThrow());

		it("throws an error if the story belonging to the passage doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'createPassage',
					props: state[0].passages[0],
					storyId: 'wrong'
				})
			).toThrow());

		it("throws an error if the passage doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'createPassage',
					props: {...state[0].passages[0], name: 'wrong'},
					storyId: state[0].id
				})
			).toThrow());
	});

	describe('when a createPassages action is received', () => {
		beforeEach(() => (state = [fakeStory(2)]));

		it('saves the story using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'createPassages',
				props: [
					{name: state[0].passages[0].name},
					{name: state[0].passages[1].name}
				],
				storyId: state[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(savePassageMock.mock.calls).toEqual([
				[transaction, state[0].passages[0]],
				[transaction, state[0].passages[1]]
			]);
			expect(saveStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it('throws an error if a passage created has no name', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'createPassages',
				props: [{name: state[0].passages[0].name}, {}],
				storyId: state[0].id
			});

			expect(() =>
				doUpdateTransactionMock.mock.calls[0][0](transaction)
			).toThrow();
		});

		it("throws an error if the story belonging to a passage doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'createPassages',
					props: [state[0].passages[0]],
					storyId: 'wrong'
				})
			).toThrow());

		it("throws an error if the passage doesn't exist in state", () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'createPassages',
				props: [{...state[0].passages[0], name: 'wrong'}],
				storyId: state[0].id
			});

			expect(() =>
				doUpdateTransactionMock.mock.calls[0][0](transaction)
			).toThrow();
		});
	});

	describe('when a createStory action is received', () => {
		it('saves the story using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'createStory',
				props: {name: state[0].name}
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(savePassageMock.mock.calls).toEqual([
				[transaction, state[0].passages[0]]
			]);
			expect(saveStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it('saves registered bodies for a metadata-only story', () => {
			const completeStory = fakeStory(2);
			const transaction = {passageIds: '', storyIds: ''};

			completeStory.passages[0].text = 'first imported body';
			completeStory.passages[1].text = 'second imported body';
			state = [registerStoryDocuments(completeStory)];

			saveMiddleware(state, {
				type: 'createStory',
				props: state[0]
			});
			doUpdateTransactionMock.mock.calls[0][0](transaction);

			expect(savePassageMock.mock.calls).toEqual(
				completeStory.passages.map(passage => [transaction, passage])
			);
		});

		it('throws an error if the story created has no name', () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'createStory',
					props: {}
				})
			).toThrow());

		it("throws an error if the story doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'createStory',
					props: {name: 'bad'}
				})
			).toThrow());
	});

	describe('when a deletePassage action is received', () => {
		it('saves the story using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'deletePassage',
				passageId: state[0].passages[0].id,
				storyId: state[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(deletePassageByIdMock.mock.calls).toEqual([
				[transaction, state[0].passages[0].id]
			]);
			expect(saveStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it("throws an error if the story doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'deletePassage',
					passageId: state[0].passages[0].id,
					storyId: 'bad'
				})
			).toThrow());
	});

	describe('when a deletePassages action is received', () => {
		beforeEach(() => (state = [fakeStory(2)]));

		it('saves the story using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'deletePassages',
				passageIds: [state[0].passages[0].id, state[0].passages[1].id],
				storyId: state[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(deletePassageByIdMock.mock.calls).toEqual([
				[transaction, state[0].passages[0].id],
				[transaction, state[0].passages[1].id]
			]);
			expect(saveStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it("throws an error if the story doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'deletePassages',
					passageIds: [state[0].passages[0].id, state[0].passages[1].id],
					storyId: 'bad'
				})
			).toThrow());
	});

	describe('when a deleteStory action is received', () => {
		// We need at least one action to be seen first so that the middleware can save a cache of the state.

		beforeEach(() => {
			saveMiddleware(state, {type: 'init', state});
		});

		it('deletes the story using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'deleteStory',
				storyId: state[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(deletePassageByIdMock.mock.calls).toEqual([
				[transaction, state[0].passages[0].id]
			]);
			expect(deleteStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it("throws an error if the story doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'deleteStory',
					storyId: 'bad'
				})
			).toThrow());
	});

	describe('when an updatePassage action is received', () => {
		it('saves the story using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'updatePassage',
				props: {name: state[0].passages[0].name},
				passageId: state[0].passages[0].id,
				storyId: state[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(savePassageMock.mock.calls).toEqual([
				[transaction, state[0].passages[0]]
			]);
			expect(saveStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it('does nothing if the change is trivial', () => {
			expect(
				saveMiddleware(state, {
					type: 'updatePassage',
					props: {selected: true},
					passageId: state[0].passages[0].id,
					storyId: state[0].id
				})
			).toBe(false);
			expect(doUpdateTransactionMock).not.toHaveBeenCalled();
			expect(savePassageMock).not.toHaveBeenCalled();
		});

		it("throws an error if the story belonging to the passage doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'updatePassage',
					passageId: state[0].passages[0].id,
					props: state[0].passages[0],
					storyId: 'wrong'
				})
			).toThrow());

		it("throws an error if the passage doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'updatePassage',
					passageId: 'wrong',
					props: state[0].passages[0],
					storyId: state[0].id
				})
			).toThrow());
	});

	describe('when an updatePassages action is received', () => {
		beforeEach(() => (state = [fakeStory(2)]));

		it('saves the story using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'updatePassages',
				passageUpdates: {
					[state[0].passages[0].id]: {name: state[0].passages[0].name},
					[state[0].passages[1].id]: {name: state[0].passages[1].name}
				},
				storyId: state[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(savePassageMock.mock.calls).toEqual([
				[transaction, state[0].passages[0]],
				[transaction, state[0].passages[1]]
			]);
			expect(saveStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it('does nothing if the change is trivial', () => {
			expect(
				saveMiddleware(state, {
					type: 'updatePassages',
					passageUpdates: {
						[state[0].passages[0].id]: {selected: true}
					},
					storyId: state[0].id
				})
			).toBe(false);

			expect(doUpdateTransactionMock).not.toHaveBeenCalled();
			expect(savePassageMock).not.toHaveBeenCalled();
		});

		it("throws an error if the story belonging to the passages doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'updatePassages',
					passageUpdates: {
						[state[0].passages[0].id]: {name: state[0].passages[0].name},
						[state[0].passages[1].id]: {name: state[0].passages[1].name}
					},
					storyId: 'wrong'
				})
			).toThrow());

		it("throws an error if a passage doesn't exist in state", () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'updatePassages',
				passageUpdates: {
					[state[0].passages[0].id]: {name: state[0].passages[0].name},
					bad: {name: state[0].passages[1].name}
				},
				storyId: state[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			expect(() =>
				doUpdateTransactionMock.mock.calls[0][0](transaction)
			).toThrow();
		});
	});

	describe('when an updateStory action is received', () => {
		it('saves the story and child passages using a transaction', () => {
			const transaction = {passageIds: '', storyIds: ''};

			saveMiddleware(state, {
				type: 'updateStory',
				props: {name: state[0].name},
				storyId: state[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(savePassageMock.mock.calls).toEqual([
				[transaction, state[0].passages[0]]
			]);
			expect(saveStoryMock.mock.calls).toEqual([[transaction, state[0]]]);
		});

		it('deletes removed passages when the passages property is updated', () => {
			const storyWithMultiplePassagesState = [fakeStory(2)];
			const transaction = {passageIds: '', storyIds: ''};

			// Need to run one action to set lastState.

			saveMiddleware(storyWithMultiplePassagesState, {
				type: 'init',
				state: storyWithMultiplePassagesState
			});
			storyWithMultiplePassagesState[0].passages = [
				storyWithMultiplePassagesState[0].passages[1]
			];
			saveMiddleware(storyWithMultiplePassagesState, {
				type: 'updateStory',
				props: {passages: [{...storyWithMultiplePassagesState[0].passages[1]}]},
				storyId: storyWithMultiplePassagesState[0].id
			});
			expect(doUpdateTransactionMock).toHaveBeenCalledTimes(1);
			doUpdateTransactionMock.mock.calls[0][0](transaction);
			expect(saveStoryMock.mock.calls).toEqual([
				[transaction, storyWithMultiplePassagesState[0]]
			]);
			expect(deletePassageByIdMock.mock.calls).toEqual([
				[transaction, storyWithMultiplePassagesState[0].passages[0].id]
			]);
		});

		it('does nothing for a selection-only update', () => {
			expect(
				saveMiddleware(state, {
					type: 'updateStory',
					props: {selected: !state[0].selected},
					storyId: state[0].id
				})
			).toBe(false);
			expect(doUpdateTransactionMock).not.toHaveBeenCalled();
			expect(savePassageMock).not.toHaveBeenCalled();
			expect(saveStoryMock).not.toHaveBeenCalled();
		});

		it('merges metadata updates with registered passage bodies', () => {
			const completeStory = fakeStory(2);
			const transaction = {passageIds: '', storyIds: ''};

			completeStory.passages[0].text = 'first replacement body';
			completeStory.passages[1].text = 'second replacement body';
			state = [metadataStory(completeStory)];
			registerStoryDocuments(completeStory);

			saveMiddleware(state, {
				type: 'updateStory',
				props: {passages: state[0].passages},
				storyId: state[0].id
			});
			doUpdateTransactionMock.mock.calls[0][0](transaction);

			expect(savePassageMock.mock.calls).toEqual(
				completeStory.passages.map(passage => [transaction, passage])
			);
		});

		it("throws an error if the story doesn't exist in state", () =>
			expect(() =>
				saveMiddleware(state, {
					type: 'updateStory',
					props: {name: state[0].name},
					storyId: 'bad'
				})
			).toThrow());
	});

	it('logs a warning if an unexpected action is received', () => {
		saveMiddleware(state, {type: '???'} as any);
		expect(warnSpy).toHaveBeenCalledTimes(1);
		expect(doUpdateTransactionMock).not.toHaveBeenCalled();
	});
});
