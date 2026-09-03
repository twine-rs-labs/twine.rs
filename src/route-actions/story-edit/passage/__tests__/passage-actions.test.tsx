import {act, fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {useStoriesContext} from '../../../../store/stories';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory,
	StoryInspector
} from '../../../../test-util';
import {PassageActions, PassageActionsProps} from '../passage-actions';

jest.mock('../../../../components/passage/rename-passage-button');

const TestPassageActions: React.FC<Partial<PassageActionsProps>> = props => {
	const {stories} = useStoriesContext();

	return (
		<PassageActions
			getCenter={() => ({left: 0, top: 0})}
			onEditPassages={jest.fn()}
			onOpenFuzzyFinder={jest.fn()}
			onRenamePassage={jest.fn()}
			story={stories[0]}
			{...props}
		/>
	);
};

describe('<PassageActions>', () => {
	async function renderComponent(
		props?: Partial<PassageActionsProps>,
		contexts?: FakeStateProviderProps
	) {
		const result = render(
			<FakeStateProvider {...contexts}>
				<TestPassageActions {...props} />
				<StoryInspector />
			</FakeStateProvider>
		);

		await act(() => Promise.resolve());
		return result;
	}

	it('displays a create passage button', async () => {
		await renderComponent();
		expect(
			screen.getByRole('button', {name: 'common.new'})
		).toBeInTheDocument();
	});

	it('displays a passage edit button', async () => {
		await renderComponent();
		expect(
			screen.getByRole('button', {name: 'common.edit'})
		).toBeInTheDocument();
	});

	it('forwards a passage rename intent without immediately renaming it', async () => {
		const story = fakeStory(1);
		const onRenamePassage = jest.fn();

		story.passages[0].selected = true;
		await renderComponent({onRenamePassage, story}, {stories: [story]});
		fireEvent.click(
			screen.getByText(`mock-rename-passage-button-${story.passages[0].id}`)
		);
		expect(onRenamePassage).toHaveBeenCalledWith(
			'mock-new-passage-name',
			story.passages[0],
			expect.any(Function)
		);
		expect(
			screen.getByTestId(`passage-${story.passages[0].id}`).dataset.name
		).toBe(story.passages[0].name);
	});

	it('provides route ownership with a callback that restores toolbar focus', async () => {
		const story = fakeStory(1);
		const onRenamePassage = jest.fn();
		story.passages[0].selected = true;
		const requestAnimationFrameSpy = jest
			.spyOn(window, 'requestAnimationFrame')
			.mockImplementation(callback => {
				callback(0);
				return 1;
			});
		await renderComponent({onRenamePassage, story}, {stories: [story]});
		const renameButton = screen.getByText(
			`mock-rename-passage-button-${story.passages[0].id}`
		);
		fireEvent.click(renameButton);
		(onRenamePassage.mock.calls[0][2] as () => void)();
		expect(renameButton).toHaveFocus();
		requestAnimationFrameSpy.mockRestore();
	});

	it('displays a passage delete button', async () => {
		await renderComponent();
		expect(
			screen.getByRole('button', {name: 'common.delete'})
		).toBeInTheDocument();
	});

	it('displays a test passage button', async () => {
		await renderComponent();
		expect(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.testFromHere'
			})
		).toBeInTheDocument();
	});

	it('displays a start at passage button', async () => {
		await renderComponent();
		expect(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.startStoryHere'
			})
		).toBeInTheDocument();
	});

	it('displays a go to passage button', async () => {
		await renderComponent();
		expect(
			screen.getByRole('button', {name: 'routes.storyEdit.toolbar.goTo'})
		).toBeInTheDocument();
	});

	it('displays a select all passages button', async () => {
		await renderComponent();
		expect(
			screen.getByRole('button', {name: 'common.selectAll'})
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
