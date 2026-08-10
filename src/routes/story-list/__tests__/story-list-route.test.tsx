import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import {saveAs} from 'file-saver';
import {StoreCoreProjectHost} from '../../../core/project-host';
import {metadataStory} from '../../../core/bootstrap-stories';
import {
	loadProjectMetadata,
	saveProjectMetadata
} from '../../../store/project-metadata';
import {markProjectStoryHydration} from '../../../store/project-hydration';
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
		jest.useRealTimers();
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

	it('keeps story health neutral until the delayed summary query completes', async () => {
		jest.useFakeTimers();
		const story = fakeStory();
		const querySummary = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStorySummaryAsync')
			.mockResolvedValue({
				errorCount: 0,
				graph: {brokenLinks: 0}
			} as any);

		await renderComponent({stories: [story]});

		expect(
			screen.getByText('Checking errors').closest('.tw-badge')
		).toHaveClass('tw-badge--neutral');
		expect(screen.queryByText('0 errors')).not.toBeInTheDocument();
		expect(querySummary).not.toHaveBeenCalled();

		await act(async () => {
			jest.advanceTimersByTime(2000);
			await Promise.resolve();
		});

		expect(querySummary).toHaveBeenCalledWith(story.id);
		expect(screen.getByText('0 errors').closest('.tw-badge')).toHaveClass(
			'tw-badge--success'
		);
	});

	it('shows unavailable story health when the delayed summary query fails', async () => {
		jest.useFakeTimers();
		const story = fakeStory();
		const querySummary = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStorySummaryAsync')
			.mockRejectedValue(new Error('Summary worker failed'));

		await renderComponent({stories: [story]});

		await act(async () => {
			jest.advanceTimersByTime(2000);
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(querySummary).toHaveBeenCalledWith(story.id);
		expect(
			screen.getByText('Health unavailable').closest('.tw-badge')
		).toHaveClass('tw-badge--neutral');
		expect(
			screen.getByText('Health unavailable').closest('.tw-badge')
		).toHaveAttribute('title', 'Summary worker failed');
		expect(screen.queryByText('Checking errors')).not.toBeInTheDocument();
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

	it('duplicates a file-backed project folder and remembers its new root', async () => {
		const story = fakeStory();
		const sourceRoot = '/native/moon-castle.twine.rs';
		const duplicateRoot = '/native/moon-castle-1.twine.rs';
		const duplicateProjectFolder = jest.fn(
			async (
				_rootPath: string,
				replacements: Array<{
					passageIds: Array<{
						duplicatePassageId: string;
						sourcePassageId: string;
					}>;
					sourceStoryId: string;
					story: ReturnType<typeof fakeStory>;
				}>
			) => ({
				passageTextLoaded: true,
				rootPath: duplicateRoot,
				stories: replacements.map(({story}) => story),
				storyIds: replacements.map(({story}) => story.id)
			})
		);

		story.name = 'Moon Castle';
		saveProjectMetadata(story.id, {
			rootPath: sourceRoot,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {duplicateProjectFolder};

		await renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {
				name: /duplicate project moon castle/i
			})
		);

		await waitFor(() => expect(duplicateProjectFolder).toHaveBeenCalled());
		const [calledRoot, replacements] = duplicateProjectFolder.mock.calls[0];
		const duplicatedStory = replacements[0].story;

		expect(calledRoot).toBe(sourceRoot);
		expect(replacements[0].sourceStoryId).toBe(story.id);
		expect(replacements[0].passageIds).toEqual(
			story.passages.map((passage, index) => ({
				duplicatePassageId: duplicatedStory.passages[index].id,
				sourcePassageId: passage.id
			}))
		);
		expect(duplicatedStory.id).not.toBe(story.id);
		expect(duplicatedStory.ifid).not.toBe(story.ifid);
		expect(loadProjectMetadata(duplicatedStory.id)?.rootPath).toBe(
			duplicateRoot
		);
		await waitFor(() =>
			expect(screen.getAllByTestId('story-list-row')).toHaveLength(2)
		);
	});

	it('duplicates every story sharing a file-backed project root', async () => {
		const firstStory = fakeStory();
		const secondStory = fakeStory();
		const sourceRoot = '/native/collection.twine.rs';
		const duplicateProjectFolder = jest.fn(
			async (
				_rootPath: string,
				replacements: Array<{
					passageIds: Array<{
						duplicatePassageId: string;
						sourcePassageId: string;
					}>;
					sourceStoryId: string;
					story: ReturnType<typeof fakeStory>;
				}>
			) => ({
				passageTextLoaded: true,
				rootPath: '/native/collection-copy.twine.rs',
				stories: replacements.map(({story}) => story),
				storyIds: replacements.map(({story}) => story.id)
			})
		);

		firstStory.name = 'First Story';
		secondStory.name = 'Second Story';
		for (const projectStory of [firstStory, secondStory]) {
			saveProjectMetadata(projectStory.id, {
				rootPath: sourceRoot,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
		}
		(window as any).twineElectron = {duplicateProjectFolder};

		await renderComponent({stories: [firstStory, secondStory]});
		fireEvent.click(
			screen.getByRole('button', {
				name: /duplicate project first story/i
			})
		);

		await waitFor(() => expect(duplicateProjectFolder).toHaveBeenCalled());
		const replacements = duplicateProjectFolder.mock.calls[0][1];

		expect(replacements.map(({sourceStoryId}: any) => sourceStoryId)).toEqual([
			firstStory.id,
			secondStory.id
		]);
		expect(new Set(replacements.map(({story}: any) => story.name)).size).toBe(
			2
		);
		await waitFor(() =>
			expect(screen.getAllByTestId('story-list-row')).toHaveLength(4)
		);
	});

	it('hydrates a duplicated multi-story project in one non-persisting batch', async () => {
		const firstStory = {...fakeStory(), name: 'First Story'};
		const secondStory = {...fakeStory(), name: 'Second Story'};
		const sourceRoot = '/native/collection.twine.rs';
		const storiesDispatch = jest.fn();
		const duplicateProjectFolder = jest.fn(
			async (
				_rootPath: string,
				replacements: Array<{
					sourceStoryId: string;
					story: ReturnType<typeof fakeStory>;
				}>
			) => ({
				passageTextLoaded: true,
				rootPath: '/native/collection-copy.twine.rs',
				stories: replacements.map(({story}) => story),
				storyIds: replacements.map(({story}) => story.id)
			})
		);

		for (const projectStory of [firstStory, secondStory]) {
			saveProjectMetadata(projectStory.id, {
				rootPath: sourceRoot,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
		}
		(window as any).twineElectron = {duplicateProjectFolder};

		await renderComponent({
			stories: [firstStory, secondStory],
			storiesDispatchObserver: storiesDispatch
		});
		fireEvent.click(
			screen.getByRole('button', {
				name: /duplicate project first story/i
			})
		);
		await waitFor(() =>
			expect(storiesDispatch).toHaveBeenCalledWith(
				expect.objectContaining({
					actions: [
						expect.objectContaining({type: 'createStory'}),
						expect.objectContaining({type: 'createStory'})
					],
					persistence: 'skip',
					type: 'applyCorePatchBatch'
				})
			)
		);
		expect(
			storiesDispatch.mock.calls.filter(
				([action]) => action.type === 'createStory'
			)
		).toHaveLength(0);
	});

	it('shows an error without adding a story when folder duplication fails', async () => {
		const story = fakeStory();

		story.name = 'Uncopyable';
		saveProjectMetadata(story.id, {
			rootPath: '/native/uncopyable.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			duplicateProjectFolder: jest
				.fn()
				.mockRejectedValue(new Error('Permission denied'))
		};

		await renderComponent({stories: [story]});
		fireEvent.click(
			screen.getByRole('button', {
				name: /duplicate project uncopyable/i
			})
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not duplicate project: Permission denied'
		);
		expect(screen.getAllByTestId('story-list-row')).toHaveLength(1);
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

	it('hydrates unopened file-backed stories directly for a library archive', async () => {
		const story = fakeStory();
		const rootPath = '/native/unopened-project.twine.rs';
		const shellStory = metadataStory(story);
		const hydrateProjectFolder = jest.fn().mockResolvedValue({
			passageTextLoaded: true,
			rootPath,
			stories: [story],
			storyIds: [story.id]
		});
		const queryDocuments = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryDocumentPageAsync'
		);

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath
		});
		(window as any).twineElectron = {hydrateProjectFolder};

		await renderComponent({stories: [shellStory]});
		fireEvent.click(
			screen.getByRole('button', {name: /export library archive/i})
		);

		await waitFor(() => expect(saveAs).toHaveBeenCalledTimes(1));
		expect(hydrateProjectFolder).toHaveBeenCalledWith(rootPath, [story.id]);
		expect(queryDocuments).not.toHaveBeenCalled();
		expect(
			screen.getByRole('button', {name: /export library archive/i})
		).toBeEnabled();
	});

	it('reports a library archive hydration failure and re-enables export', async () => {
		const story = fakeStory();
		const rootPath = '/native/unreadable-project.twine.rs';

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath
		});
		(window as any).twineElectron = {
			hydrateProjectFolder: jest
				.fn()
				.mockRejectedValue(new Error('Permission denied'))
		};

		await renderComponent({stories: [metadataStory(story)]});
		fireEvent.click(
			screen.getByRole('button', {name: /export library archive/i})
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not export library archive: Permission denied'
		);
		expect(
			screen.getByRole('button', {name: /export library archive/i})
		).toBeEnabled();
		expect(saveAs).not.toHaveBeenCalled();
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

	it('removes a lazy project only after its folder deletion completes', async () => {
		const story = fakeStory();
		const rootPath = '/native/lazy-project.twine.rs';
		let finishFolderDeletion: () => void = () => {};
		const deleteProjectFolder = jest.fn(
			() =>
				new Promise<void>(resolve => {
					finishFolderDeletion = resolve;
				})
		);
		const storiesDispatch = jest.fn();
		const applyStoryCommand = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommand')
			.mockReturnValue(new Promise(() => {}));

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath
		});
		(window as any).twineElectron = {deleteProjectFolder};
		jest.spyOn(window, 'confirm').mockReturnValue(true);

		await renderComponent({
			stories: [metadataStory(story)],
			storiesDispatchObserver: storiesDispatch
		});
		fireEvent.click(
			screen.getByRole('button', {
				name: new RegExp(`delete story ${story.name}`, 'i')
			})
		);

		await waitFor(() =>
			expect(deleteProjectFolder).toHaveBeenCalledWith(rootPath)
		);
		expect(screen.getByTestId('story-list-row')).toBeInTheDocument();
		expect(loadProjectMetadata(story.id)?.rootPath).toBe(rootPath);
		finishFolderDeletion();
		await waitFor(() =>
			expect(screen.queryByTestId('story-list-row')).not.toBeInTheDocument()
		);
		await waitFor(() => expect(loadProjectMetadata(story.id)).toBeUndefined());
		expect(storiesDispatch).toHaveBeenCalledWith({
			storyIds: [story.id],
			type: 'retireProjectStories'
		});
		expect(applyStoryCommand).not.toHaveBeenCalled();
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
		expect(
			screen.getByText('dialogs.appDonation.twineRsTitle')
		).toBeInTheDocument();
	});

	it('does not display a donation prompt if useDonationCheck() says it should not be shown', async () => {
		useDonationCheckMock.mockReturnValue({
			shouldShowDonationPrompt: () => false
		});

		await renderComponent();
		expect(
			screen.queryByText('dialogs.appDonation.twineRsTitle')
		).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
