import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createMemoryHistory} from 'history';
import * as React from 'react';
import {MemoryRouter, Route, Router} from 'react-router-dom';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {
	knownAssetInventoryForStory,
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../../../core';
import {StoreCoreProjectHost} from '../../../core/project-host';
import {saveProjectMetadata} from '../../../store/project-metadata';
import type {Story} from '../../../store/stories';
import {AssetsRoute} from '../assets-route';

const mockTestStory = jest.fn();

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		testStory: mockTestStory
	})
}));

function inventoryAsset(
	path: string,
	options: Partial<CoreAssetInventoryEntry> = {}
): CoreAssetInventoryEntry {
	const kind = path.endsWith('.mp3') ? 'audio' : 'image';
	const snippetText =
		kind === 'audio'
			? `<audio src="${path}" controls></audio>`
			: `<img src="${path}" alt="">`;

	return {
		durationMs: null,
		exists: true,
		height: kind === 'image' ? 480 : null,
		kind,
		missing: false,
		modifiedAt: '2026-06-21T16:00:00.000Z',
		normalizedPath: path.toLowerCase(),
		path,
		previewUrl: `file:///native/project.twine.rs/${path}`,
		publish: {
			copy: true,
			outputPath: path,
			reason: 'Copy asset into published output'
		},
		referenceCount: 0,
		references: [],
		sizeBytes: 2048,
		snippet: {
			label: 'Insert asset reference',
			mediaType: kind,
			text: snippetText
		},
		thumbnailUrl:
			kind === 'image' ? `file:///native/project.twine.rs/${path}` : null,
		unused: true,
		width: kind === 'image' ? 640 : null,
		...options
	};
}

function assetStory() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Asset Castle',
		selected: true
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		text: 'Portrait: <img src="assets/cover.png">'
	});

	story.passages = [start];
	story.startPassage = start.id;
	return {start, story};
}

function projectSnapshot(assets: CoreAssetInventoryEntry[]) {
	return {
		assets,
		changedPaths: [],
		conflicts: [],
		files: [],
		rootPath: '/native/project.twine.rs',
		scannedAt: '2026-06-21T16:00:00.000Z',
		stories: [],
		storyIds: ['story-id']
	};
}

function renderComponent() {
	const {story} = assetStory();
	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/assets`]}>
				<Route path="/stories/:storyId/assets">
					<AssetsRoute />
					<StoryInspector id={story.id} />
				</Route>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

function renderComponentWithHistory(configure?: (story: Story) => void) {
	const {story} = assetStory();

	configure?.(story);

	const history = createMemoryHistory({
		initialEntries: [`/stories/${story.id}/assets`]
	});
	const result = render(
		<FakeStateProvider stories={[story]}>
			<Router history={history}>
				<Route path="/stories/:storyId/assets">
					<AssetsRoute />
					<StoryInspector id={story.id} />
				</Route>
			</Router>
		</FakeStateProvider>
	);

	return {history, result, story};
}

function assetCard(path: string) {
	return screen.getByRole('button', {
		name: `Select asset ${path}`
	}) as HTMLButtonElement;
}

function folderCard(path: string) {
	return screen.getByRole('button', {
		name: `Open folder ${path}`
	}) as HTMLButtonElement;
}

async function findFolderCard(path: string) {
	return (await screen.findByRole('button', {
		name: `Open folder ${path}`
	})) as HTMLButtonElement;
}

async function openAssetsFolder() {
	await findFolderCard('assets');
	fireEvent.click(folderCard('assets'));
}

describe('<AssetsRoute>', () => {
	beforeEach(() => {
		window.localStorage.clear();
		replaceKnownAssetInventoryForStory('story-id', []);
		mockTestStory.mockReset();
	});

	afterEach(() => {
		delete (window as any).twineElectron;
		jest.restoreAllMocks();
	});

	it('shows the reference-backed inventory and preview actions', async () => {
		renderComponent();

		expect(screen.getByLabelText('Search assets')).toBeInTheDocument();
		expect(await findFolderCard('assets')).toBeInTheDocument();

		await openAssetsFolder();

		expect(assetCard('assets/cover.png')).toHaveTextContent('cover.png');
		expect(assetCard('assets/cover.png')).not.toHaveTextContent(
			'assets/cover.png'
		);
		expect(
			screen.getByText('<img src="assets/cover.png" alt="">')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Find Usages'})
		).toBeInTheDocument();
	});

	it('reveals stylesheet asset references without falling back to a passage', async () => {
		const {history, story} = renderComponentWithHistory(story => {
			story.stylesheet = '.hero { background: url("assets/bg.png"); }';
		});

		await openAssetsFolder();
		fireEvent.click(assetCard('assets/bg.png'));
		fireEvent.click(screen.getByRole('button', {name: 'Find Usages'}));

		const query = new URLSearchParams(history.location.search);

		expect(history.location.pathname).toBe(`/stories/${story.id}`);
		expect(query.get('mode')).toBe('text');
		expect(query.get('source')).toBe('stylesheet');
		expect(query.get('passage')).toBeNull();
		expect(Number(query.get('offset'))).toBe(
			story.stylesheet.indexOf('assets/bg.png')
		);
	});

	it('keeps folders collapsed by default and opens directories in the browser', async () => {
		const {story} = assetStory();

		saveProjectMetadata(story.id, {
			rootPath: '/native/project.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			projectSessionSnapshot: jest.fn(async () =>
				projectSnapshot([
					inventoryAsset('assets/cover.png'),
					inventoryAsset('assets/images/tr/scenes/laviusd.png')
				])
			)
		};

		render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter initialEntries={[`/stories/${story.id}/assets`]}>
					<Route path="/stories/:storyId/assets">
						<AssetsRoute />
					</Route>
				</MemoryRouter>
			</FakeStateProvider>
		);

		await waitFor(() =>
			expect(screen.getByText('Live folder')).toBeInTheDocument()
		);
		expect(folderCard('assets')).toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: 'Select asset assets/cover.png'})
		).toBeNull();
		expect(
			screen.queryByRole('button', {name: 'Open folder assets/images'})
		).toBeNull();

		await openAssetsFolder();

		expect(assetCard('assets/cover.png')).toBeInTheDocument();
		expect(folderCard('assets/images')).toBeInTheDocument();
		expect(
			screen.queryByText('assets/images/tr/scenes/laviusd.png')
		).toBeNull();
	});

	it('recovers the default native project folder and renders image previews', async () => {
		const {story} = assetStory();
		const inventory = [
			inventoryAsset('assets/images/website/alex.avatar.png', {
				previewUrl:
					'file:///native/library/Projects/asset-castle.twine.rs/assets/images/website/alex.avatar.png',
				thumbnailUrl:
					'file:///native/library/Projects/asset-castle.twine.rs/assets/images/website/alex.avatar.png'
			})
		];

		(window as any).twineElectron = {
			getStoryLibraryFolder: jest.fn(async () => '/native/library'),
			listProjectAssets: jest.fn(async () => inventory)
		};

		const result = render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter initialEntries={[`/stories/${story.id}/assets`]}>
					<Route path="/stories/:storyId/assets">
						<AssetsRoute />
					</Route>
				</MemoryRouter>
			</FakeStateProvider>
		);

		await waitFor(() =>
			expect(screen.getByText('Live folder')).toBeInTheDocument()
		);
		expect(
			(window as any).twineElectron.listProjectAssets
		).toHaveBeenCalledWith('/native/library/Projects/asset-castle.twine.rs');

		await openAssetsFolder();
		fireEvent.click(folderCard('assets/images'));
		fireEvent.click(folderCard('assets/images/website'));

		expect(
			assetCard('assets/images/website/alex.avatar.png')
		).toBeInTheDocument();
		expect(
			result.container.querySelector(
				'.assets-route__thumb img[src="file:///native/library/Projects/asset-castle.twine.rs/assets/images/website/alex.avatar.png"]'
			)
		).toBeInTheDocument();
	});

	it('inserts the selected asset snippet through the core host', async () => {
		const {result} = renderComponent();

		await openAssetsFolder();
		fireEvent.click(assetCard('assets/cover.png'));
		fireEvent.click(screen.getByRole('button', {name: 'Insert into Passage'}));

		await waitFor(() =>
			expect(
				result.container.querySelector('[data-id="start"]')
			).toHaveTextContent('<img src="assets/cover.png" alt="">')
		);
	});

	it('tests the first passage that references the selected asset', async () => {
		const {story} = renderComponent();

		await openAssetsFolder();
		fireEvent.click(assetCard('assets/cover.png'));
		fireEvent.click(screen.getByRole('button', {name: 'Test First Usage'}));

		expect(mockTestStory).toHaveBeenCalledWith(story.id, story.passages[0].id);
	});

	it('imports a host-known asset into the inventory and marks it unused', async () => {
		renderComponent();

		fireEvent.change(screen.getByLabelText('Asset path'), {
			target: {value: '/tmp/ambient.mp3'}
		});
		fireEvent.click(screen.getByRole('button', {name: 'Import Asset'}));

		await waitFor(() =>
			expect(assetCard('assets/ambient.mp3')).toBeInTheDocument()
		);

		fireEvent.click(
			screen.getByRole('button', {name: 'Select asset assets/ambient.mp3'})
		);

		expect(screen.getAllByText('Unused').length).toBeGreaterThan(0);
		expect(screen.getAllByText('0 refs').length).toBeGreaterThan(0);
	});

	it('imports an asset from the native desktop file picker', async () => {
		(window as any).twineElectron = {
			chooseAssetFile: jest.fn(async () => '/tmp/native-cover.png')
		};

		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Choose Asset'}));

		await waitFor(() =>
			expect(assetCard('assets/native-cover.png')).toBeInTheDocument()
		);
		expect((window as any).twineElectron.chooseAssetFile).toHaveBeenCalled();
	});

	it('copies native assets into a remembered project folder before import', async () => {
		const {story} = assetStory();

		saveProjectMetadata(story.id, {
			rootPath: '/native/project.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			chooseAssetFile: jest.fn(async () => '/tmp/native-cover.png'),
			copyAssetToProject: jest.fn(async () => ({
				sourcePath: '/native/project.twine.rs/assets/native-cover.png',
				targetPath: 'assets/native-cover.png'
			}))
		};

		render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter initialEntries={[`/stories/${story.id}/assets`]}>
					<Route path="/stories/:storyId/assets">
						<AssetsRoute />
					</Route>
				</MemoryRouter>
			</FakeStateProvider>
		);

		fireEvent.click(screen.getByRole('button', {name: 'Choose Asset'}));

		await waitFor(() =>
			expect(
				(window as any).twineElectron.copyAssetToProject
			).toHaveBeenCalledWith(
				'/native/project.twine.rs',
				'/tmp/native-cover.png'
			)
		);
		expect(assetCard('assets/native-cover.png')).toBeInTheDocument();
	});

	it('loads live native project assets and surfaces unused files', async () => {
		const {story} = assetStory();

		saveProjectMetadata(story.id, {
			rootPath: '/native/project.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			projectSessionSnapshot: jest.fn(async () =>
				projectSnapshot([
					inventoryAsset('assets/cover.png'),
					inventoryAsset('assets/unused.png')
				])
			)
		};

		render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter initialEntries={[`/stories/${story.id}/assets`]}>
					<Route path="/stories/:storyId/assets">
						<AssetsRoute />
					</Route>
				</MemoryRouter>
			</FakeStateProvider>
		);

		await waitFor(() =>
			expect(screen.getByText('Live folder')).toBeInTheDocument()
		);
		expect(screen.getByText('2 files')).toBeInTheDocument();
		await openAssetsFolder();
		expect(assetCard('assets/unused.png')).toBeInTheDocument();
		expect(screen.getAllByText('Unused').length).toBeGreaterThan(0);
		expect(
			knownAssetInventoryForStory(story.id).map(asset => asset.path)
		).toEqual(['assets/cover.png', 'assets/unused.png']);
		expect(
			(window as any).twineElectron.projectSessionSnapshot
		).toHaveBeenCalledWith('/native/project.twine.rs', [story.id]);
		fireEvent.click(assetCard('assets/cover.png'));
		await waitFor(() =>
			expect(screen.getByText('File + references')).toBeInTheDocument()
		);
	});

	it('keeps live project assets visible while the Rust index is loading', async () => {
		const {story} = assetStory();

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStoryIndexAsync')
			.mockReturnValue(new Promise(() => {}));
		saveProjectMetadata(story.id, {
			rootPath: '/native/project.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			projectSessionSnapshot: jest.fn(async () =>
				projectSnapshot([inventoryAsset('assets/cover.png')])
			)
		};

		render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter initialEntries={[`/stories/${story.id}/assets`]}>
					<Route path="/stories/:storyId/assets">
						<AssetsRoute />
					</Route>
				</MemoryRouter>
			</FakeStateProvider>
		);

		await waitFor(() =>
			expect(screen.getByText('Live folder')).toBeInTheDocument()
		);
		await openAssetsFolder();

		expect(assetCard('assets/cover.png')).toBeInTheDocument();
	});

	it('renames native asset files before updating story references', async () => {
		const {story} = assetStory();
		const projectSessionSnapshot = jest
			.fn()
			.mockResolvedValueOnce(
				projectSnapshot([inventoryAsset('assets/cover.png')])
			)
			.mockResolvedValue(projectSnapshot([inventoryAsset('assets/hero.png')]));
		const renameProjectAsset = jest.fn(async () => ({
			sourcePath: '/native/project.twine.rs/assets/hero.png',
			targetPath: 'assets/hero.png'
		}));

		saveProjectMetadata(story.id, {
			rootPath: '/native/project.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			projectSessionSnapshot,
			renameProjectAsset
		};

		const result = render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter initialEntries={[`/stories/${story.id}/assets`]}>
					<Route path="/stories/:storyId/assets">
						<AssetsRoute />
						<StoryInspector id={story.id} />
					</Route>
				</MemoryRouter>
			</FakeStateProvider>
		);

		await waitFor(() =>
			expect(screen.getByText('Live folder')).toBeInTheDocument()
		);
		await openAssetsFolder();
		fireEvent.click(assetCard('assets/cover.png'));
		fireEvent.click(screen.getByRole('button', {name: 'Rename'}));
		fireEvent.change(screen.getByLabelText('New asset path'), {
			target: {value: 'assets/hero.png'}
		});
		fireEvent.click(screen.getByRole('button', {name: 'Apply'}));

		await waitFor(() =>
			expect(renameProjectAsset).toHaveBeenCalledWith(
				'/native/project.twine.rs',
				'assets/cover.png',
				'assets/hero.png'
			)
		);
		expect(
			result.container.querySelector('[data-id="start"]')
		).toHaveTextContent('assets/hero.png');
	});
});
