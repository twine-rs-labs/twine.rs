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

const mockCloseBoundary = jest.fn();

jest.mock('../../../../components/passage/rename-passage-button');
jest.mock('../../../../components/passage/passage-rename-review', () => ({
	PassageRenameReview: ({
		afterName,
		onClose
	}: {
		afterName: string;
		onClose: () => void;
	}) => (
		<div data-testid="passage-rename-review">
			{afterName}
			<button onClick={onClose}>close review</button>
		</div>
	)
}));
jest.mock('../use-passage-rename-review', () => ({
	usePassageRenameReview: () => ({
		applying: false,
		closeBoundary: mockCloseBoundary,
		handleApply: jest.fn(),
		handleNextPage: jest.fn(),
		handlePreviousPage: jest.fn(),
		handleRetry: jest.fn(),
		showPreviousPage: false
	})
}));

const TestPassageActions: React.FC<Partial<PassageActionsProps>> = props => {
	const {stories} = useStoriesContext();

	return (
		<PassageActions
			getCenter={() => ({left: 0, top: 0})}
			onEditPassages={jest.fn()}
			onOpenFuzzyFinder={jest.fn()}
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

	it('opens a passage rename review instead of immediately renaming a passage', async () => {
		const story = fakeStory(1);

		story.passages[0].selected = true;
		await renderComponent({story}, {stories: [story]});
		fireEvent.click(
			screen.getByText(`mock-rename-passage-button-${story.passages[0].id}`)
		);
		expect(screen.getByTestId('passage-rename-review')).toHaveTextContent(
			'mock-new-passage-name'
		);
		expect(
			screen.getByTestId(`passage-${story.passages[0].id}`).dataset.name
		).toBe(story.passages[0].name);
	});

	it('releases review ownership and restores focus after review closes', async () => {
		const story = fakeStory(1);
		story.passages[0].selected = true;
		const requestAnimationFrameSpy = jest
			.spyOn(window, 'requestAnimationFrame')
			.mockImplementation(callback => {
				callback(0);
				return 1;
			});
		await renderComponent({story}, {stories: [story]});
		const renameButton = screen.getByText(
			`mock-rename-passage-button-${story.passages[0].id}`
		);
		fireEvent.click(renameButton);
		fireEvent.click(screen.getByRole('button', {name: 'close review'}));
		expect(mockCloseBoundary).toHaveBeenCalled();
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
