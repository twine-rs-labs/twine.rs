import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createMemoryHistory} from 'history';
import {axe} from 'jest-axe';
import * as React from 'react';
import {Router} from 'react-router-dom';
import {
	loadProjectMetadata,
	saveProjectMetadata
} from '../../../store/project-metadata';
import {useDonationCheck} from '../../../store/prefs/use-donation-check';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory
} from '../../../test-util';
import {InnerStoryListRoute} from '../story-list-route';

jest.mock('../../../store/prefs/use-donation-check');
jest.mock('../../../components/error/safari-warning-card');

describe('<StoryListRoute>', () => {
	const useDonationCheckMock = useDonationCheck as jest.Mock;

	beforeEach(() => {
		window.localStorage.clear();
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => false
		});
	});

	afterEach(() => {
		delete (window as any).twineElectron;
		jest.restoreAllMocks();
	});

	function renderComponent(contexts?: FakeStateProviderProps) {
		const history = createMemoryHistory();
		const result = render(
			<Router history={history}>
				<FakeStateProvider {...contexts}>
					<InnerStoryListRoute />
				</FakeStateProvider>
			</Router>
		);

		return {...result, history};
	}

	it('displays launcher actions', () => {
		renderComponent();

		expect(
			screen.getByRole('button', {name: /new project/i})
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: /import/i})).toBeInTheDocument();
	});

	it('navigates to the new project route', () => {
		const {history} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /new project/i}));
		expect(history.location.pathname).toBe('/new-project');
	});

	it('displays a warning for Safari users', () => {
		renderComponent();
		expect(screen.getByTestId('mock-safari-warning-card')).toBeInTheDocument();
	});

	it('displays story rows if there are stories in state', () => {
		renderComponent({stories: [fakeStory()]});
		expect(screen.getByTestId('story-list-row')).toBeInTheDocument();
	});

	it('deletes a file-backed project folder after confirming the directory', async () => {
		const story = fakeStory();
		const rootPath =
			'/Users/ben/Documents/Twine RS/Stories/Projects/trigaea.twine.rs';
		const deleteProjectFolder = jest.fn().mockResolvedValue(undefined);
		const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

		story.name = 'Trigaea';
		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {deleteProjectFolder};

		renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {name: /delete story trigaea/i})
		);

		await waitFor(() =>
			expect(deleteProjectFolder).toHaveBeenCalledWith(rootPath)
		);
		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining(`This will delete files from ${rootPath}.`)
		);
		await waitFor(() =>
			expect(screen.queryByTestId('story-list-row')).not.toBeInTheDocument()
		);
		expect(loadProjectMetadata(story.id)).toBeUndefined();
	});

	it('keeps a file-backed project folder if deletion is canceled', () => {
		const story = fakeStory();
		const rootPath = '/native/moon-castle.twine.rs';
		const deleteProjectFolder = jest.fn().mockResolvedValue(undefined);

		story.name = 'Moon Castle';
		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {deleteProjectFolder};
		jest.spyOn(window, 'confirm').mockReturnValue(false);

		renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {name: /delete story moon castle/i})
		);

		expect(deleteProjectFolder).not.toHaveBeenCalled();
		expect(screen.getByTestId('story-list-row')).toBeInTheDocument();
		expect(loadProjectMetadata(story.id)?.rootPath).toBe(rootPath);
	});

	it('deletes a non-project story from the library after confirming', async () => {
		const story = fakeStory();
		const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

		story.name = 'Standalone Story';
		renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {name: /delete story standalone story/i})
		);

		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining('Delete story "Standalone Story"?')
		);
		await waitFor(() =>
			expect(screen.queryByTestId('story-list-row')).not.toBeInTheDocument()
		);
	});

	it('displays an empty launcher state if there are no stories in state', () => {
		renderComponent({stories: []});
		expect(screen.queryByTestId('story-list-row')).not.toBeInTheDocument();
		expect(screen.getByText('No projects yet')).toBeInTheDocument();
	});

	it('sorts stories by name if the user pref is set to that', () => {
		const story1 = fakeStory();
		const story2 = fakeStory();

		story1.name = 'a';
		story1.lastUpdate = new Date('1/1/2000');
		story2.name = 'b';
		story2.lastUpdate = new Date('1/1/1999');
		renderComponent({
			prefs: {storyListSort: 'name'},
			stories: [story2, story1]
		});

		const rows = screen.getAllByTestId('story-list-row');

		expect(rows.length).toBe(2);
		expect(rows[0].dataset.id).toBe(story1.id);
		expect(rows[1].dataset.id).toBe(story2.id);
	});

	it('sorts stories by reverse chronological edit order if the user pref is set to that', () => {
		const story1 = fakeStory();
		const story2 = fakeStory();

		story1.name = 'b';
		story1.lastUpdate = new Date('1/1/2000');
		story2.name = 'a';
		story2.lastUpdate = new Date('1/1/1999');
		renderComponent({
			prefs: {storyListSort: 'date'},
			stories: [story2, story1]
		});

		const rows = screen.getAllByTestId('story-list-row');

		expect(rows.length).toBe(2);
		expect(rows[0].dataset.id).toBe(story1.id);
		expect(rows[1].dataset.id).toBe(story2.id);
	});

	it('displays a donation prompt if useDonationCheck() says it should be shown', () => {
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => true
		});

		renderComponent();
		expect(screen.getByText('dialogs.appDonation.title')).toBeInTheDocument();
	});

	it('does not display a donation prompt if useDonationCheck() says it should not be shown', () => {
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => false
		});

		renderComponent();
		expect(
			screen.queryByText('dialogs.appDonation.title')
		).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
