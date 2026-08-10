import * as React from 'react';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {fakePrefs, fakeStory, fakeUnloadedStoryFormat} from '../../test-util';
import {usePersistence} from '../persistence/use-persistence';
import {usePrefsContext} from '../prefs';
import {StateLoader} from '../state-loader';
import {StoryWithDocuments, useStoriesContext} from '../stories';
import {
	StoryFormat,
	StoryFormatsAction,
	useStoryFormatsContext
} from '../story-formats';
import * as useStoriesRepairModule from '../use-stories-repair';
import {
	hasLocalReplacementRecovery,
	prepareLocalReplacementRecovery,
	sealLocalReplacementRecovery
} from '../persistence/local-storage/stories/replacement-recovery';
import {
	doUpdateTransaction,
	savePassage,
	saveStory
} from '../persistence/local-storage/stories/save';
import {load as loadLocalStories} from '../persistence/local-storage/stories/load';
import {storageManifestKey} from '../persistence/local-storage/stories/storage';
import {
	load as loadLocalPrefs,
	save as saveLocalPrefs
} from '../persistence/local-storage/prefs';
import {
	load as loadLocalStoryFormats,
	save as saveLocalStoryFormats
} from '../persistence/local-storage/story-formats';

jest.mock('../prefs/prefs-context');
jest.mock('../stories/stories-context');
jest.mock('../story-formats/story-formats-context');
jest.mock('../persistence/use-persistence');
jest.mock('../../components/loading-curtain/loading-curtain');

function persistStories(...stories: StoryWithDocuments[]) {
	doUpdateTransaction(transaction => {
		for (const story of stories) {
			saveStory(transaction, story);
			for (const passage of story.passages) {
				savePassage(transaction, passage);
			}
		}
	});
}

function replacement(story: StoryWithDocuments, text: string) {
	return {
		...story,
		name: `${story.name} replacement`,
		passages: story.passages.map((passage, index) => ({
			...passage,
			text: index === 0 ? text : passage.text
		}))
	};
}

function storyById(stories: StoryWithDocuments[], storyId: string) {
	return stories.find(story => story.id === storyId)!;
}

function failManifestCommits(...commitNumbers: number[]) {
	const originalSetItem = Storage.prototype.setItem;
	const failures = new Set(commitNumbers);
	let manifestCommits = 0;

	return jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (
		this: Storage,
		key: string,
		value: string
	) {
		if (key === storageManifestKey && failures.has(++manifestCommits)) {
			throw new Error(`manifest commit ${manifestCommits} failed`);
		}
		return originalSetItem.call(this, key, value);
	});
}

function useLocalStoryLoader() {
	(usePersistence as jest.Mock).mockReturnValue({
		prefs: {load: async () => ({mockPrefsState: true})},
		stories: {load: loadLocalStories},
		storyFormats: {load: async () => ({mockStoryFormatsState: true})}
	});
}

function admittedStories(dispatch: jest.Mock) {
	return dispatch.mock.calls[0][0].state as StoryWithDocuments[];
}

describe('<StateLoader>', () => {
	let defaultFormat: StoryFormat;
	let prefsDispatchMock: jest.Mock;
	let formatsDispatchMock: jest.Mock;
	let storiesDispatchMock: jest.Mock;

	beforeEach(() => {
		window.localStorage.clear();
		defaultFormat = fakeUnloadedStoryFormat();
		prefsDispatchMock = jest.fn();
		formatsDispatchMock = jest.fn();
		storiesDispatchMock = jest.fn();

		(usePrefsContext as jest.Mock).mockReturnValue({
			dispatch: prefsDispatchMock,
			prefs: {
				storyFormat: {
					name: defaultFormat.name,
					version: defaultFormat.version
				}
			}
		});
		(useStoryFormatsContext as jest.Mock).mockReturnValue({
			dispatch: formatsDispatchMock,
			formats: [defaultFormat]
		});
		(useStoriesContext as jest.Mock).mockReturnValue({
			dispatch: storiesDispatchMock
		});
		(usePersistence as jest.Mock).mockReturnValue({
			prefs: {load: async () => ({mockPrefsState: true})},
			stories: {load: async () => ({mockStoriesState: true})},
			storyFormats: {load: async () => ({mockStoryFormatsState: true})}
		});
	});

	afterEach(() => {
		jest.restoreAllMocks();
		window.localStorage.clear();
	});

	it('dispatches init and repair actions once mounted', async () => {
		render(<StateLoader />);
		await waitFor(() => expect(storiesDispatchMock).toHaveBeenCalled());

		// Order of these actions is crucial. The init must come before the repair.
		// Order of store repairs is tested below.

		expect(prefsDispatchMock.mock.calls).toEqual([
			[{type: 'init', state: {mockPrefsState: true}}],
			[{type: 'repair', allFormats: [defaultFormat]}]
		]);
		expect(storiesDispatchMock.mock.calls).toEqual([
			[{type: 'init', state: {mockStoriesState: true}}],
			[{type: 'repair', allFormats: [defaultFormat], defaultFormat}],
			[{type: 'init', state: []}]
		]);
		expect(formatsDispatchMock.mock.calls).toEqual([
			[{type: 'init', state: {mockStoryFormatsState: true}}],
			[{type: 'repair'}]
		]);
	});

	it('repairs story formats, then preferences, then stories', async () => {
		render(<StateLoader />);
		await waitFor(() => expect(storiesDispatchMock).toHaveBeenCalled());

		// The second invocation will be the repair--tested above.

		expect(formatsDispatchMock.mock.invocationCallOrder[1]).toBeLessThan(
			prefsDispatchMock.mock.invocationCallOrder[1]
		);
		expect(prefsDispatchMock.mock.invocationCallOrder[1]).toBeLessThan(
			storiesDispatchMock.mock.invocationCallOrder[1]
		);
	});

	it('repairs stories using useStoriesRepair', async () => {
		const repairStories = jest.fn();
		const repairSpy = jest
			.spyOn(useStoriesRepairModule, 'useStoriesRepair')
			.mockReturnValue(repairStories);

		render(<StateLoader />);
		await waitFor(() => expect(storiesDispatchMock).toHaveBeenCalled());
		expect(repairStories).toHaveBeenCalledTimes(1);
		repairSpy.mockRestore();
	});

	it('uses the repaired story format state when repairing preferences', async () => {
		const repairedFormats = [
			defaultFormat,
			fakeUnloadedStoryFormat({name: 'repaired-story-format'})
		];
		let formatsRepaired = false;

		(useStoryFormatsContext as jest.Mock).mockImplementation(() => ({
			dispatch(action: StoryFormatsAction) {
				if (action.type === 'repair') {
					formatsRepaired = true;
				}
			},
			formats: formatsRepaired ? repairedFormats : [defaultFormat]
		}));

		render(<StateLoader />);
		await waitFor(() => expect(prefsDispatchMock).toHaveBeenCalled());
		expect(prefsDispatchMock.mock.calls[1]).toEqual([
			{type: 'repair', allFormats: repairedFormats}
		]);
	});

	it('uses the repaired preferences and story format state when repairing stories', async () => {
		const repairedDefaultFormat = fakeUnloadedStoryFormat();
		const repairedFormats = [defaultFormat, repairedDefaultFormat];
		let formatsRepaired = false;
		const repairedPrefs = {
			repaired: true,
			storyFormat: {
				name: repairedDefaultFormat.name,
				version: repairedDefaultFormat.version
			}
		};
		let prefsRepaired = false;

		(usePrefsContext as jest.Mock).mockImplementation(() => ({
			dispatch(action: StoryFormatsAction) {
				if (action.type === 'repair') {
					prefsRepaired = true;
				}
			},
			prefs: prefsRepaired
				? repairedPrefs
				: {
						storyFormat: {
							name: defaultFormat.name,
							version: defaultFormat.version
						}
					}
		}));
		(useStoryFormatsContext as jest.Mock).mockImplementation(() => ({
			dispatch(action: StoryFormatsAction) {
				if (action.type === 'repair') {
					formatsRepaired = true;
				}
			},
			formats: formatsRepaired ? repairedFormats : [defaultFormat]
		}));
		render(<StateLoader />);
		await waitFor(() => expect(storiesDispatchMock).toHaveBeenCalled());
		expect(storiesDispatchMock.mock.calls[1]).toEqual([
			{
				type: 'repair',
				allFormats: repairedFormats,
				defaultFormat: repairedDefaultFormat
			}
		]);
	});

	it('renders children once loaded', async () => {
		render(
			<StateLoader>
				<div data-testid="children" />
			</StateLoader>
		);
		expect(screen.queryByTestId('children')).not.toBeInTheDocument();
		expect(await screen.findByTestId('children')).toBeInTheDocument();
	});

	it('keeps project sessions closed until local recovery is resolved', async () => {
		const original = fakeStory(1);
		const imported = {
			...original,
			passages: [{...original.passages[0], text: 'imported body'}]
		};
		const edited = {
			...imported,
			passages: [{...imported.passages[0], text: 'edited after failure'}]
		};
		const persist = (story: typeof original) =>
			doUpdateTransaction(transaction => {
				saveStory(transaction, story);
				for (const passage of story.passages) {
					savePassage(transaction, passage);
				}
			});

		persist(original);
		prepareLocalReplacementRecovery([original]);
		persist(imported);
		sealLocalReplacementRecovery();
		persist(edited);

		render(
			<StateLoader>
				<div data-testid="project-sessions" />
			</StateLoader>
		);

		expect(
			await screen.findByRole('heading', {name: 'Review recovered projects'})
		).toBeInTheDocument();
		expect(screen.queryByTestId('project-sessions')).not.toBeInTheDocument();
		expect(storiesDispatchMock).not.toHaveBeenCalled();

		fireEvent.click(
			screen.getByRole('button', {name: `Keep current ${original.name}`})
		);

		expect(await screen.findByTestId('project-sessions')).toBeInTheDocument();
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('admits a post-recovery snapshot after an initial one-shot commit failure', async () => {
		const original = fakeStory(1);
		const imported = replacement(original, 'provisional body');

		persistStories(original);
		prepareLocalReplacementRecovery([original]);
		persistStories(imported);
		sealLocalReplacementRecovery();
		failManifestCommits(1);
		useLocalStoryLoader();

		render(
			<StateLoader>
				<div data-testid="project-sessions" />
			</StateLoader>
		);

		expect(await screen.findByTestId('project-sessions')).toBeInTheDocument();
		const admitted = admittedStories(storiesDispatchMock);
		const durable = (await loadLocalStories()) as StoryWithDocuments[];

		expect(admitted).toEqual(durable);
		expect(storyById(admitted, original.id).passages[0].text).toBe(
			original.passages[0].text
		);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('admits a post-recovery snapshot when Retry completes a one-shot failure', async () => {
		const original = fakeStory(1);
		const imported = replacement(original, 'provisional body');

		persistStories(original);
		prepareLocalReplacementRecovery([original]);
		persistStories(imported);
		sealLocalReplacementRecovery();
		failManifestCommits(1, 2, 3);
		useLocalStoryLoader();

		render(
			<StateLoader>
				<div data-testid="project-sessions" />
			</StateLoader>
		);

		expect(
			await screen.findByRole('heading', {name: 'Review recovered projects'})
		).toBeInTheDocument();
		expect(screen.queryByTestId('project-sessions')).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Retry Recovery'}));

		expect(await screen.findByTestId('project-sessions')).toBeInTheDocument();
		const admitted = admittedStories(storiesDispatchMock);
		const durable = (await loadLocalStories()) as StoryWithDocuments[];

		expect(admitted).toEqual(durable);
		expect(storyById(admitted, original.id).passages[0].text).toBe(
			original.passages[0].text
		);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('admits every post-recovery project after partial multi-project resolution', async () => {
		const first = fakeStory(1);
		const second = fakeStory(1);
		const firstImported = replacement(first, 'first provisional');
		const secondImported = replacement(second, 'second provisional');
		const firstEdited = replacement(firstImported, 'first conflict');

		persistStories(first, second);
		prepareLocalReplacementRecovery([first, second]);
		persistStories(firstImported, secondImported);
		sealLocalReplacementRecovery();
		persistStories(firstEdited);
		failManifestCommits(1, 2);
		useLocalStoryLoader();

		render(
			<StateLoader>
				<div data-testid="project-sessions" />
			</StateLoader>
		);

		expect(
			await screen.findByRole('heading', {name: 'Review recovered projects'})
		).toBeInTheDocument();
		expect(screen.queryByTestId('project-sessions')).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {name: `Restore original ${first.name}`})
		);

		expect(await screen.findByTestId('project-sessions')).toBeInTheDocument();
		const admitted = admittedStories(storiesDispatchMock);
		const durable = (await loadLocalStories()) as StoryWithDocuments[];

		expect(admitted).toEqual(durable);
		expect(storyById(admitted, first.id).passages[0].text).toBe(
			first.passages[0].text
		);
		expect(storyById(admitted, second.id).passages[0].text).toBe(
			second.passages[0].text
		);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('preserves per-domain fallbacks after a terminal recovery decision', async () => {
		const original = fakeStory(1);
		const imported = replacement(original, 'provisional body');
		const edited = replacement(imported, 'keep this conflict');
		const loadStoryFormats = jest
			.fn()
			.mockResolvedValueOnce({initialFormatsState: true})
			.mockRejectedValueOnce(new Error('formats failed after recovery'));

		persistStories(original);
		prepareLocalReplacementRecovery([original]);
		persistStories(imported);
		sealLocalReplacementRecovery();
		persistStories(edited);
		(usePersistence as jest.Mock).mockReturnValue({
			prefs: {load: async () => ({recoveredPrefsState: true})},
			stories: {load: async () => ({recoveredStoriesState: true})},
			storyFormats: {load: loadStoryFormats}
		});
		const warn = jest.spyOn(console, 'warn').mockReturnValue();

		render(
			<StateLoader>
				<div data-testid="project-sessions" />
			</StateLoader>
		);
		expect(
			await screen.findByRole('heading', {name: 'Review recovered projects'})
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {name: `Keep current ${original.name}`})
		);

		expect(await screen.findByTestId('project-sessions')).toBeInTheDocument();
		expect(loadStoryFormats).toHaveBeenCalledTimes(2);
		expect(formatsDispatchMock.mock.calls[0]).toEqual([
			{type: 'init', state: []}
		]);
		expect(prefsDispatchMock.mock.calls[0]).toEqual([
			{type: 'init', state: {recoveredPrefsState: true}}
		]);
		expect(storiesDispatchMock.mock.calls[0]).toEqual([
			{type: 'init', state: {recoveredStoriesState: true}}
		]);
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('formats failed after recovery')
		);
	});

	it('keeps sessions gated after a terminal decision if storage becomes unavailable', async () => {
		const original = fakeStory(1);
		const imported = replacement(original, 'provisional body');
		const edited = replacement(imported, 'keep this conflict');
		const securityError = new DOMException('Access denied', 'SecurityError');
		const loadPrefs = jest
			.fn()
			.mockResolvedValueOnce({initialPrefsState: true})
			.mockRejectedValueOnce(securityError)
			.mockResolvedValueOnce({recoveredPrefsState: true});
		const loadStories = jest.fn(async () => ({recoveredStoriesState: true}));
		const loadStoryFormats = jest.fn(async () => ({
			recoveredFormatsState: true
		}));

		persistStories(original);
		prepareLocalReplacementRecovery([original]);
		persistStories(imported);
		sealLocalReplacementRecovery();
		persistStories(edited);
		(usePersistence as jest.Mock).mockReturnValue({
			prefs: {load: loadPrefs},
			stories: {load: loadStories},
			storyFormats: {load: loadStoryFormats}
		});
		jest.spyOn(console, 'warn').mockReturnValue();

		render(
			<StateLoader>
				<div data-testid="project-sessions" />
			</StateLoader>
		);
		expect(
			await screen.findByRole('heading', {name: 'Review recovered projects'})
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {name: `Keep current ${original.name}`})
		);

		expect(
			await screen.findByText(/Browser storage is unavailable: Access denied/)
		).toBeInTheDocument();
		expect(screen.queryByTestId('project-sessions')).not.toBeInTheDocument();
		expect(prefsDispatchMock).not.toHaveBeenCalled();
		expect(storiesDispatchMock).not.toHaveBeenCalled();
		expect(formatsDispatchMock).not.toHaveBeenCalled();

		fireEvent.click(screen.getByRole('button', {name: 'Retry Recovery'}));

		expect(await screen.findByTestId('project-sessions')).toBeInTheDocument();
		expect(loadPrefs).toHaveBeenCalledTimes(3);
		expect(prefsDispatchMock.mock.calls[0]).toEqual([
			{type: 'init', state: {recoveredPrefsState: true}}
		]);
	});

	it('reloads every persistence domain before opening sessions after storage returns', async () => {
		const savedPrefs = fakePrefs({locale: 'sr'});
		const savedFormat = fakeUnloadedStoryFormat({
			name: 'Saved User Format',
			userAdded: true,
			version: '1.2.3'
		});
		const savedStory = fakeStory(1);
		const securityError = new DOMException('Access denied', 'SecurityError');
		let releasePrefsRetry!: () => void;
		const prefsRetryBarrier = new Promise<void>(resolve => {
			releasePrefsRetry = resolve;
		});
		const loadPrefs = jest.fn(async () => {
			await prefsRetryBarrier;
			return loadLocalPrefs();
		});
		const loadStories = jest.fn(async () => loadLocalStories());
		const loadStoryFormats = jest.fn(async () => loadLocalStoryFormats());

		saveLocalPrefs(savedPrefs);
		saveLocalStoryFormats([savedFormat]);
		doUpdateTransaction(transaction => {
			saveStory(transaction, savedStory);
			for (const passage of savedStory.passages) {
				savePassage(transaction, passage);
			}
		});
		loadPrefs.mockRejectedValueOnce(securityError);
		loadStories.mockRejectedValueOnce(securityError);
		loadStoryFormats.mockRejectedValueOnce(securityError);
		(usePersistence as jest.Mock).mockReturnValue({
			prefs: {load: loadPrefs},
			stories: {load: loadStories},
			storyFormats: {load: loadStoryFormats}
		});
		const warn = jest.spyOn(console, 'warn').mockReturnValue();
		const getItem = jest
			.spyOn(Storage.prototype, 'getItem')
			.mockImplementation(() => {
				throw new DOMException('Access denied', 'SecurityError');
			});

		render(
			<StateLoader>
				<div data-testid="project-sessions" />
			</StateLoader>
		);

		expect(
			await screen.findByText(/Browser storage is unavailable: Access denied/)
		).toBeInTheDocument();
		expect(screen.queryByTestId('project-sessions')).not.toBeInTheDocument();
		expect(loadPrefs).toHaveBeenCalledTimes(1);
		expect(loadStories).toHaveBeenCalledTimes(1);
		expect(loadStoryFormats).toHaveBeenCalledTimes(1);
		expect(prefsDispatchMock).not.toHaveBeenCalled();
		expect(storiesDispatchMock).not.toHaveBeenCalled();
		expect(formatsDispatchMock).not.toHaveBeenCalled();
		getItem.mockRestore();

		fireEvent.click(screen.getByRole('button', {name: 'Retry Recovery'}));
		await waitFor(() => {
			expect(loadPrefs).toHaveBeenCalledTimes(2);
			expect(loadStories).toHaveBeenCalledTimes(2);
			expect(loadStoryFormats).toHaveBeenCalledTimes(2);
		});
		expect(screen.queryByTestId('project-sessions')).not.toBeInTheDocument();
		expect(prefsDispatchMock).not.toHaveBeenCalled();
		expect(storiesDispatchMock).not.toHaveBeenCalled();
		expect(formatsDispatchMock).not.toHaveBeenCalled();

		await act(async () => {
			releasePrefsRetry();
			await prefsRetryBarrier;
		});

		expect(await screen.findByTestId('project-sessions')).toBeInTheDocument();
		expect(prefsDispatchMock.mock.calls[0]).toEqual([
			{type: 'init', state: expect.objectContaining({locale: 'sr'})}
		]);
		expect(formatsDispatchMock.mock.calls[0]).toEqual([
			{
				type: 'init',
				state: [
					expect.objectContaining({
						id: savedFormat.id,
						name: savedFormat.name,
						userAdded: true,
						version: savedFormat.version
					})
				]
			}
		]);
		expect(storiesDispatchMock.mock.calls[0][0]).toEqual({
			type: 'init',
			state: [expect.objectContaining({id: savedStory.id})]
		});
		expect(await loadLocalPrefs()).toEqual(savedPrefs);
		expect(await loadLocalStoryFormats()).toEqual([
			expect.objectContaining({
				id: savedFormat.id,
				name: savedFormat.name,
				userAdded: true,
				version: savedFormat.version
			})
		]);
		warn.mockRestore();
	});

	it('retries every persistence domain while storage remains unavailable', async () => {
		const securityError = new DOMException('Access denied', 'SecurityError');
		const loadPrefs = jest.fn(async () => {
			throw securityError;
		});
		const loadStories = jest.fn(async () => {
			throw securityError;
		});
		const loadStoryFormats = jest.fn(async () => {
			throw securityError;
		});

		(usePersistence as jest.Mock).mockReturnValue({
			prefs: {load: loadPrefs},
			stories: {load: loadStories},
			storyFormats: {load: loadStoryFormats}
		});
		const warn = jest.spyOn(console, 'warn').mockReturnValue();
		const getItem = jest
			.spyOn(Storage.prototype, 'getItem')
			.mockImplementation(() => {
				throw securityError;
			});

		render(
			<StateLoader>
				<div data-testid="project-sessions" />
			</StateLoader>
		);
		expect(
			await screen.findByText(/Browser storage is unavailable: Access denied/)
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Retry Recovery'}));

		await waitFor(() => {
			expect(loadPrefs).toHaveBeenCalledTimes(2);
			expect(loadStories).toHaveBeenCalledTimes(2);
			expect(loadStoryFormats).toHaveBeenCalledTimes(2);
		});
		expect(screen.queryByTestId('project-sessions')).not.toBeInTheDocument();
		expect(prefsDispatchMock).not.toHaveBeenCalled();
		expect(storiesDispatchMock).not.toHaveBeenCalled();
		expect(formatsDispatchMock).not.toHaveBeenCalled();
		getItem.mockRestore();
		warn.mockRestore();
	});

	it('falls back to empty state if persistence loading fails', async () => {
		jest.spyOn(console, 'warn').mockReturnValue();
		(usePersistence as jest.Mock).mockReturnValue({
			prefs: {load: async () => Promise.reject(new Error('prefs failed'))},
			stories: {load: async () => Promise.reject(new Error('stories failed'))},
			storyFormats: {
				load: async () => Promise.reject(new Error('formats failed'))
			}
		});

		render(
			<StateLoader>
				<div data-testid="children" />
			</StateLoader>
		);

		expect(await screen.findByTestId('children')).toBeInTheDocument();
		expect(formatsDispatchMock.mock.calls[0]).toEqual([
			{type: 'init', state: []}
		]);
		expect(prefsDispatchMock.mock.calls[0]).toEqual([
			{type: 'init', state: {}}
		]);
		expect(storiesDispatchMock.mock.calls[0]).toEqual([
			{type: 'init', state: []}
		]);
	});

	it('loads and applies persistence exactly once in StrictMode', async () => {
		const loadPrefs = jest.fn(async () => ({mockPrefsState: true}));
		const loadStories = jest.fn(async () => ({mockStoriesState: true}));
		const loadStoryFormats = jest.fn(async () => ({
			mockStoryFormatsState: true
		}));

		(usePersistence as jest.Mock).mockReturnValue({
			prefs: {load: loadPrefs},
			stories: {load: loadStories},
			storyFormats: {load: loadStoryFormats}
		});
		render(
			<React.StrictMode>
				<StateLoader />
			</React.StrictMode>
		);

		await waitFor(() =>
			expect(storiesDispatchMock).toHaveBeenCalledWith({
				state: {mockStoriesState: true},
				type: 'init'
			})
		);
		expect(loadPrefs).toHaveBeenCalledTimes(1);
		expect(loadStories).toHaveBeenCalledTimes(1);
		expect(loadStoryFormats).toHaveBeenCalledTimes(1);
		expect(
			prefsDispatchMock.mock.calls.filter(([action]) => action.type === 'init')
		).toHaveLength(1);
		expect(
			storiesDispatchMock.mock.calls.filter(
				([action]) => action.type === 'init'
			)
		).toHaveLength(2);
		expect(
			formatsDispatchMock.mock.calls.filter(
				([action]) => action.type === 'init'
			)
		).toHaveLength(1);
	});

	it('does not apply persistence after unmounting during a load', async () => {
		let resolveFormats!: (value: {mockStoryFormatsState: boolean}) => void;
		const loadStoryFormats = jest.fn(
			() =>
				new Promise<{mockStoryFormatsState: boolean}>(resolve => {
					resolveFormats = resolve;
				})
		);

		(usePersistence as jest.Mock).mockReturnValue({
			prefs: {load: async () => ({mockPrefsState: true})},
			stories: {load: async () => ({mockStoriesState: true})},
			storyFormats: {load: loadStoryFormats}
		});
		const {unmount} = render(<StateLoader />);

		await waitFor(() => expect(loadStoryFormats).toHaveBeenCalledTimes(1));
		unmount();
		await act(async () => {
			resolveFormats({mockStoryFormatsState: true});
			await Promise.resolve();
		});

		expect(prefsDispatchMock).not.toHaveBeenCalled();
		expect(storiesDispatchMock).not.toHaveBeenCalled();
		expect(formatsDispatchMock).not.toHaveBeenCalled();
	});
});
