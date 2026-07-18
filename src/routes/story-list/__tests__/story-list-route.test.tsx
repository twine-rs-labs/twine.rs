import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import {saveAs} from 'file-saver';
import {StoreCoreProjectHost} from '../../../core/project-host';
import {
	loadProjectMetadata,
	saveProjectMetadata
} from '../../../store/project-metadata';
import {useDonationCheck} from '../../../store/prefs/use-donation-check';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory,
	LocationInspector
} from '../../../test-util';
import {InnerStoryListRoute} from '../story-list-route';

jest.mock('../../../store/prefs/use-donation-check');
jest.mock('../../../components/error/safari-warning-card');
jest.mock('file-saver');

describe('<StoryListRoute>', () => {
	const useDonationCheckMock = useDonationCheck as jest.Mock;

	beforeEach(() => {
		window.localStorage.clear();
		jest.mocked(saveAs).mockClear();
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => false
		});
	});

	afterEach(() => {
		delete (window as any).twineElectron;
		jest.restoreAllMocks();
	});

	function renderComponent(contexts?: FakeStateProviderProps) {
		const result = render(
			<MemoryRouter>
				<FakeStateProvider {...contexts}>
					<InnerStoryListRoute />
				</FakeStateProvider>
				<LocationInspector />
			</MemoryRouter>
		);

		return result;
	}

	it('displays launcher actions', () => {
		renderComponent();

		expect(
			screen.getByRole('button', {name: /new project/i})
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: /import/i})).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /export library archive/i})
		).toBeEnabled();
		expect(
			screen.getByRole('button', {name: /story tags/i})
		).toBeInTheDocument();
		expect(screen.getByText('Storage & Backups')).toBeInTheDocument();
	});

	it('navigates to the new project route', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /new project/i}));
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/new-project'
			)
		);
	});

	it('displays a warning for Safari users', () => {
		renderComponent();
		expect(screen.getByTestId('mock-safari-warning-card')).toBeInTheDocument();
	});

	it('displays story rows if there are stories in state', () => {
		renderComponent({stories: [fakeStory()]});
		expect(screen.getByTestId('story-list-row')).toBeInTheDocument();
	});

	it('duplicates a complete story from the launcher', async () => {
		const story = fakeStory();

		story.name = 'Duplicate Me';
		renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {name: /duplicate story duplicate me/i})
		);

		await waitFor(() =>
			expect(screen.getAllByTestId('story-list-row')).toHaveLength(2)
		);
	});

	it('assigns story tags from the launcher', async () => {
		const story = fakeStory();
		const applyStoryCommand = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockResolvedValue(undefined);

		story.tags = [];
		renderComponent({stories: [story]});
		fireEvent.click(screen.getByRole('button', {name: 'common.tags'}));
		fireEvent.change(
			screen.getByRole('combobox', {
				name: 'components.tagCardButton.tagNameLabel'
			}),
			{target: {value: 'release-candidate'}}
		);
		fireEvent.click(screen.getByRole('button', {name: 'common.add'}));

		await waitFor(() =>
			expect(applyStoryCommand).toHaveBeenCalledWith({
				story_id: story.id,
				tags: ['release-candidate'],
				type: 'setStoryTags'
			})
		);
	});

	it('exports a restorable archive of the complete library', async () => {
		renderComponent({stories: [fakeStory()]});
		fireEvent.click(
			screen.getByRole('button', {name: /export library archive/i})
		);

		await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
		const [archive, filename] = jest.mocked(saveAs).mock.calls[0];

		expect(archive).toBeInstanceOf(Blob);
		expect((archive as Blob).type).toBe('text/html;charset=utf-8');
		expect(filename).toBe('store.archiveFilename');
	});

	it('opens global story tag management from the launcher', () => {
		renderComponent({stories: [fakeStory()]});
		fireEvent.click(screen.getByRole('button', {name: /story tags/i}));

		expect(screen.getByText('dialogs.storyTags.title')).toBeInTheDocument();
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
			expect.stringContaining(
				'The project folder will be moved to the operating system trash.'
			)
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
