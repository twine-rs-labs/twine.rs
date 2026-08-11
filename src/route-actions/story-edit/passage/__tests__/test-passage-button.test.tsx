import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {useStoriesContext} from '../../../../store/stories';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory
} from '../../../../test-util';
import {
	TestPassageButton,
	TestPassageButtonProps
} from '../test-passage-button';

const TestTestPassageButton: React.FC<
	Partial<TestPassageButtonProps>
> = props => {
	const {stories} = useStoriesContext();

	return <TestPassageButton story={stories[0]} {...props} />;
};

describe('<TestPassageButton>', () => {
	function renderComponent(
		props?: Partial<TestPassageButtonProps>,
		contexts?: FakeStateProviderProps
	) {
		return render(
			<FakeStateProvider {...contexts}>
				<TestTestPassageButton {...props} />
			</FakeStateProvider>
		);
	}

	it('is disabled when the passage prop is undefined', () => {
		renderComponent({passage: undefined});
		expect(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.testFromHere'
			})
		).toBeDisabled();
	});

	it('tests the story from the passage when clicked', async () => {
		const replace = jest.fn();
		const openSpy = jest.spyOn(window, 'open').mockReturnValue({
			close: jest.fn(),
			location: {replace}
		} as any);
		const story = fakeStory();

		renderComponent({passage: story.passages[0]}, {stories: [story]});
		expect(openSpy).not.toHaveBeenCalled();
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.testFromHere'
			})
		);
		expect(openSpy).toHaveBeenCalledWith(
			expect.stringMatching(/^http:\/\/localhost\/?$/),
			'_blank'
		);
		await waitFor(() =>
			expect(replace).toHaveBeenCalledWith(
				`#/stories/${story.id}/preview?target=test&passage=${story.passages[0].id}`
			)
		);
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
