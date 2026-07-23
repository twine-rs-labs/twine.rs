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
	LocationInspector,
	waitForMockPromises
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

	async function renderComponent(contexts?: FakeStateProviderProps) {
		const queryWordCount = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStoryWordCountAsync')
			.mockResolvedValue(0);
		const result = render(
			<MemoryRouter>
				<FakeStateProvider {...contexts}>
					<InnerStoryListRoute />
				</FakeStateProvider>
				<LocationInspector />
			</MemoryRouter>
		);

		await waitForMockPromises(queryWordCount);
		return result;
	}

	it('displays launcher actions', async () => {
		await renderComponent();

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
		await renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /new project/i}));
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/new-project'
			)
		);
	});

	it('displays a warning for Safari users', async () => {
		await renderComponent();
		expect(screen.getByTestId('mock-safari-warning-card')).toBeInTheDocument();
	});

	it('displays story rows if there are stories in state', async () => {
		await renderComponent({stories: [fakeStory()]});
		expect(screen.getByTestId('story-list-row')).toBeInTheDocument();
	});

	it('duplicates a complete story from the launcher', async () => {
		const story = fakeStory();

		story.name = 'Duplicate Me';
		await renderComponent({stories: [story]});
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
		await renderComponent({stories: [story]});
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
		await renderComponent({stories: [fakeStory()]});
		fireEvent.click(
			screen.getByRole('button', {name: /export library archive/i})
		);

		await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
		const [archive, filename] = jest.mocked(saveAs).mock.calls[0];

		expect(archive).toBeInstanceOf(Blob);
		expect((archive as Blob).type).toBe('text/html;charset=utf-8');
		expect(filename).toBe('store.archiveFilename');
	});

	it('opens global story tag management from the launcher', async () => {
		await renderComponent({stories: [fakeStory()]});
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

		await renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {name: /delete story trigaea/i})
		);

		await waitFor(() =>
			expect(deleteProjectFolder).toHaveBeenCalledWith(rootPath)
		);
		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining(`- Project folder: ${rootPath}`)
		);
		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining('- Library story: "Trigaea"')
		);
		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				'Legacy HTML story files, including same-named copies, will not be deleted.'
			)
		);
		await waitFor(() =>
			expect(screen.queryByTestId('story-list-row')).not.toBeInTheDocument()
		);
		expect(loadProjectMetadata(story.id)).toBeUndefined();
	});

	it('keeps native storage metadata until the project story deletion is dispatched', async () => {
		const story = fakeStory();
		const rootPath = '/native/deferred-delete.twine.rs';
		const deleteProjectFolder = jest.fn().mockResolvedValue(undefined);
		let finishDeletion: () => void = () => {};
		const applyStoryCommand = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockReturnValue(
				new Promise(resolve => {
					finishDeletion = () => resolve(undefined);
				})
			);

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {deleteProjectFolder};
		jest.spyOn(window, 'confirm').mockReturnValue(true);

		await renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {
				name: new RegExp(`delete story ${story.name}`, 'i')
			})
		);

		await waitFor(() => expect(applyStoryCommand).toHaveBeenCalled());
		expect(loadProjectMetadata(story.id)?.rootPath).toBe(rootPath);
		finishDeletion();
		await waitFor(() => expect(loadProjectMetadata(story.id)).toBeUndefined());
	});

	it('keeps a file-backed project folder if deletion is canceled', async () => {
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

		await renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {name: /delete story moon castle/i})
		);

		expect(deleteProjectFolder).not.toHaveBeenCalled();
		expect(screen.getByTestId('story-list-row')).toBeInTheDocument();
		expect(loadProjectMetadata(story.id)?.rootPath).toBe(rootPath);
	});

	it('enumerates every story removed with a multi-story project', async () => {
		const firstStory = fakeStory();
		const secondStory = fakeStory();
		const rootPath = '/native/story-collection.twine.rs';
		const deleteProjectFolder = jest.fn().mockResolvedValue(undefined);
		const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(false);

		firstStory.name = 'First Story';
		secondStory.name = 'Second Story';
		for (const story of [firstStory, secondStory]) {
			saveProjectMetadata(story.id, {
				rootPath,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
		}
		(window as any).twineElectron = {deleteProjectFolder};

		await renderComponent({stories: [firstStory, secondStory]});
		fireEvent.click(
			screen.getByRole('button', {name: /delete story first story/i})
		);

		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				'- Library stories: "First Story", "Second Story"'
			)
		);
		expect(deleteProjectFolder).not.toHaveBeenCalled();
	});

	it('deletes a non-project story from the library after confirming', async () => {
		const story = fakeStory();
		const confirmSpy = jest.spyOn(window, 'confirm').mockReturnValue(true);

		story.name = 'Standalone Story';
		(window as any).twineElectron = {deleteStory: jest.fn()};
		await renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {name: /delete story standalone story/i})
		);

		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining('Delete story "Standalone Story"?')
		);
		expect(confirmSpy).toHaveBeenCalledWith(
			expect.stringContaining(
				'- Legacy HTML file: Standalone Story.html (moved to the operating system trash)'
			)
		);
		await waitFor(() =>
			expect(screen.queryByTestId('story-list-row')).not.toBeInTheDocument()
		);
	});

	it('displays an empty launcher state if there are no stories in state', async () => {
		await renderComponent({stories: []});
		expect(screen.queryByTestId('story-list-row')).not.toBeInTheDocument();
		expect(screen.getByText('No projects yet')).toBeInTheDocument();
	});

	it('sorts stories by name if the user pref is set to that', async () => {
		const story1 = fakeStory();
		const story2 = fakeStory();

		story1.name = 'a';
		story1.lastUpdate = new Date('1/1/2000');
		story2.name = 'b';
		story2.lastUpdate = new Date('1/1/1999');
		await renderComponent({
			prefs: {storyListSort: 'name'},
			stories: [story2, story1]
		});

		const rows = screen.getAllByTestId('story-list-row');

		expect(rows.length).toBe(2);
		expect(rows[0].dataset.id).toBe(story1.id);
		expect(rows[1].dataset.id).toBe(story2.id);
	});

	it('sorts stories by reverse chronological edit order if the user pref is set to that', async () => {
		const story1 = fakeStory();
		const story2 = fakeStory();

		story1.name = 'b';
		story1.lastUpdate = new Date('1/1/2000');
		story2.name = 'a';
		story2.lastUpdate = new Date('1/1/1999');
		await renderComponent({
			prefs: {storyListSort: 'date'},
			stories: [story2, story1]
		});

		const rows = screen.getAllByTestId('story-list-row');

		expect(rows.length).toBe(2);
		expect(rows[0].dataset.id).toBe(story1.id);
		expect(rows[1].dataset.id).toBe(story2.id);
	});

	it('displays a donation prompt if useDonationCheck() says it should be shown', async () => {
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => true
		});

		await renderComponent();
		expect(screen.getByText('dialogs.appDonation.title')).toBeInTheDocument();
	});

	it('does not display a donation prompt if useDonationCheck() says it should not be shown', async () => {
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => false
		});

		await renderComponent();
		expect(
			screen.queryByText('dialogs.appDonation.title')
		).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
