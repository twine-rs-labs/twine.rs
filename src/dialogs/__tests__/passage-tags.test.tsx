import {act, fireEvent, render, screen, within} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {StoreCoreProjectHost} from '../../core';
import {StoriesContext, StoriesContextProps} from '../../store/stories';
import {fakeStory} from '../../test-util';
import {PassageTagsDialog, PassageTagsDialogProps} from '../passage-tags';

jest.mock('../../components/tag/tag-editor');

describe('<PassageTagsDialog>', () => {
	afterEach(() => jest.restoreAllMocks());

	async function renderComponent(
		props?: Partial<PassageTagsDialogProps>,
		storiesContext?: Partial<StoriesContextProps>
	) {
		const story = fakeStory(1);

		story.passages[0].tags = ['mock-tag'];

		const result = render(
			<StoriesContext.Provider
				value={{
					dispatch: jest.fn(),
					stories: [story],
					...storiesContext
				}}
			>
				<PassageTagsDialog
					collapsed={false}
					onChangeCollapsed={jest.fn()}
					onChangeHighlighted={jest.fn()}
					onChangeMaximized={jest.fn()}
					onChangeProps={jest.fn()}
					onClose={jest.fn()}
					storyId={story.id}
					{...props}
				/>
			</StoriesContext.Provider>
		);

		// Need this because of <PromptButton>
		await act(async () => Promise.resolve());
		return result;
	}

	it('shows a tag editor for every passage tag', async () => {
		const story = fakeStory(2);

		story.passages[0].tags = ['mock-tag', 'mock-tag2'];
		story.passages[1].tags = ['mock-tag'];
		await renderComponent({storyId: story.id}, {stories: [story]});
		expect(
			await screen.findByTestId('mock-tag-editor-mock-tag')
		).toBeInTheDocument();
		expect(
			await screen.findByTestId('mock-tag-editor-mock-tag2')
		).toBeInTheDocument();
	});

	it('shows how many passages use each tag', async () => {
		const story = fakeStory(2);

		story.passages[0].tags = ['mock-tag'];
		story.passages[1].tags = ['mock-tag'];
		await renderComponent({storyId: story.id}, {stories: [story]});
		expect(
			await screen.findByText('dialogs.passageTags.count')
		).toBeInTheDocument();
	});

	it('applies a core command if a tag is renamed', async () => {
		const dispatch = jest.fn();
		const story = fakeStory(1);
		const stories = [story];
		const applyStoryCommand = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockImplementation(async () => undefined);

		story.passages[0].tags = ['mock-tag'];
		await renderComponent({storyId: story.id}, {dispatch, stories});
		expect(dispatch).not.toHaveBeenCalled();
		fireEvent.click(
			within(await screen.findByTestId('mock-tag-editor-mock-tag')).getByText(
				'onChangeName'
			)
		);
		expect(applyStoryCommand).toHaveBeenCalledWith(
			{
				type: 'renamePassageTag',
				new_name: 'mock-new-name',
				old_name: 'mock-tag',
				story_id: story.id
			},
			'undoChange.renameTag'
		);
	});

	it('applies a core command if a tag color is changed', async () => {
		const dispatch = jest.fn();
		const applyStoryCommand = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockImplementation(async () => undefined);

		await renderComponent({}, {dispatch});
		expect(dispatch).not.toHaveBeenCalled();
		fireEvent.click(
			within(await screen.findByTestId('mock-tag-editor-mock-tag')).getByText(
				'onChangeColor'
			)
		);
		expect(applyStoryCommand).toHaveBeenCalledWith(
			{
				type: 'setStoryTagColor',
				color: 'mock-color',
				name: 'mock-tag',
				story_id: expect.any(String)
			},
			'undoChange.changeTagColor'
		);
	});

	it('shows a message if there are no passage tags', async () => {
		const story = fakeStory(1);

		story.passages[0].tags = [];
		await renderComponent({storyId: story.id}, {stories: [story]});
		expect(screen.getByText('dialogs.passageTags.noTags')).toBeInTheDocument();
	});

	it('does not show a message if there are passage tags', async () => {
		const story = fakeStory(1);

		story.passages[0].tags = ['mock-tag'];
		await renderComponent({storyId: story.id}, {stories: [story]});
		await screen.findByTestId('mock-tag-editor-mock-tag');
		expect(
			screen.queryByText('dialogs.storyTags.noTags')
		).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
