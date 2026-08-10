import * as React from 'react';
import {act, render, screen} from '@testing-library/react';
import {usePersistence} from '../../persistence/use-persistence';
import {reducer} from '../reducer';
import {useStoryFormatsContext} from '../../story-formats';
import {useStoreErrorReporter} from '../../use-store-error-reporter';
import {StoriesContextProvider, useStoriesContext} from '../stories-context';
import type {StoriesAction} from '../stories.types';
import {createPersistenceCompletion} from '../../persistence/completion';

jest.mock('../../persistence/use-persistence');
jest.mock('../reducer');
jest.mock('../../story-formats', () => ({
	useStoryFormatsContext: jest.fn(() => ({formats: []}))
}));
jest.mock('../../use-store-error-reporter', () => ({
	useStoreErrorReporter: jest.fn(() => ({reportError: jest.fn()}))
}));

describe('StoriesContextProvider persistence freeze', () => {
	it('stops persistence-affecting actions before the reducer mutates state', () => {
		let dispatch: React.Dispatch<StoriesAction> = () => {};
		const saveMiddleware = jest.fn();
		const canReduceAction = jest.fn(
			(action: StoriesAction) => action.type !== 'createStory'
		);

		(usePersistence as jest.Mock).mockReturnValue({
			stories: {canReduceAction, saveMiddleware}
		});
		(useStoryFormatsContext as jest.Mock).mockReturnValue({formats: []});
		(useStoreErrorReporter as jest.Mock).mockReturnValue({
			reportError: jest.fn()
		});
		(reducer as jest.Mock).mockImplementation(state => [
			...state,
			{id: 'should-not-exist'}
		]);

		function Consumer() {
			const context = useStoriesContext();

			dispatch = context.dispatch;
			return <div data-testid="story-count">{context.stories.length}</div>;
		}

		render(
			<StoriesContextProvider>
				<Consumer />
			</StoriesContextProvider>
		);
		act(() => dispatch({type: 'createStory', props: {name: 'Frozen'}}));

		expect(canReduceAction).toHaveBeenCalledWith({
			type: 'createStory',
			props: {name: 'Frozen'}
		});
		expect(reducer).not.toHaveBeenCalled();
		expect(saveMiddleware).not.toHaveBeenCalled();
		expect(screen.getByTestId('story-count')).toHaveTextContent('0');
	});

	it('rejects the exact Core persistence barrier when local storage throws', async () => {
		let dispatch: React.Dispatch<StoriesAction> = () => {};
		const persistenceError = new Error('local storage quota exceeded');
		const saveMiddleware = jest.fn(() => {
			throw persistenceError;
		});
		const barrier = createPersistenceCompletion();

		(usePersistence as jest.Mock).mockReturnValue({
			stories: {saveMiddleware}
		});
		(useStoryFormatsContext as jest.Mock).mockReturnValue({formats: []});
		(useStoreErrorReporter as jest.Mock).mockReturnValue({
			reportError: jest.fn()
		});
		(reducer as jest.Mock).mockImplementation(state => state);

		function Consumer() {
			dispatch = useStoriesContext().dispatch;
			return null;
		}

		render(
			<StoriesContextProvider>
				<Consumer />
			</StoriesContextProvider>
		);
		act(() =>
			dispatch({
				actions: [],
				persistenceToken: barrier.token,
				type: 'applyCorePatchBatch'
			})
		);

		await expect(barrier.completion).rejects.toBe(persistenceError);
	});
});
