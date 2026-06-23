import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {useStoriesContext} from '../../../../store/stories';
import {
	fakeLoadedStoryFormat,
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory
} from '../../../../test-util';
import {
	EditPassagesButton,
	EditPassagesButtonProps
} from '../edit-passages-buttons';

const TestEditPassagesButton: React.FC<
	Partial<EditPassagesButtonProps>
> = props => {
	const {stories} = useStoriesContext();

	return (
		<EditPassagesButton
			onEditPassages={jest.fn()}
			passages={stories[0].passages}
			story={stories[0]}
			{...props}
		/>
	);
};

describe('<EditPassagesButton>', () => {
	function renderComponent(
		props?: Partial<EditPassagesButtonProps>,
		contexts?: FakeStateProviderProps
	) {
		return render(
			<FakeStateProvider {...contexts}>
				<TestEditPassagesButton {...props} />
			</FakeStateProvider>
		);
	}

	it('is disabled if the passages prop is empty', () => {
		renderComponent({passages: []});
		expect(screen.getByRole('button', {name: 'common.edit'})).toBeDisabled();
	});

	it('asks the workspace to open every selected passage when clicked', async () => {
		const format = fakeLoadedStoryFormat();
		const story = fakeStory(3);
		const onEditPassages = jest.fn();

		story.storyFormat = format.name;
		story.storyFormatVersion = format.version;
		renderComponent(
			{
				onEditPassages,
				story,
				passages: [story.passages[0], story.passages[1]]
			},
			{stories: [story], storyFormats: [format]}
		);
		fireEvent.click(screen.getByRole('button', {name: 'common.editCount'}));
		await act(() => Promise.resolve());
		expect(onEditPassages).toHaveBeenCalledWith([
			story.passages[0],
			story.passages[1]
		]);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
