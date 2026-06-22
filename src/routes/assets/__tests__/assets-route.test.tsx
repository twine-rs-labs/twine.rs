import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {
	knownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../../../core';
import {saveProjectMetadata} from '../../../store/project-metadata';
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

function assetCard(path: string) {
	const label = screen.getAllByText(path).find(element =>
		element.closest('.assets-route__card')
	);

	return label?.closest('button') as HTMLButtonElement;
}

describe('<AssetsRoute>', () => {
	beforeEach(() => {
		window.localStorage.clear();
		mockTestStory.mockReset();
	});

	afterEach(() => {
		delete (window as any).twineElectron;
	});

	it('shows the reference-backed inventory and preview actions', () => {
		renderComponent();

		expect(screen.getByLabelText('Search assets')).toBeInTheDocument();
		expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
		expect(
			screen.getByText('<img src="assets/cover.png" alt="">')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Find Usages'})
		).toBeInTheDocument();
	});

	it('inserts the selected asset snippet through the core host', async () => {
		const {result} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Insert into Passage'}));

		await waitFor(() =>
			expect(
				result.container.querySelector('[data-id="start"]')
			).toHaveTextContent('<img src="assets/cover.png" alt="">')
		);
	});

	it('tests the first passage that references the selected asset', () => {
		const {story} = renderComponent();

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
			expect(screen.getAllByText('assets/ambient.mp3').length).toBeGreaterThan(
				0
			)
		);

		fireEvent.click(screen.getByText('assets/ambient.mp3').closest('button')!);

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
			expect(
				screen.getAllByText('assets/native-cover.png').length
			).toBeGreaterThan(0)
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
			expect((window as any).twineElectron.copyAssetToProject).toHaveBeenCalledWith(
				'/native/project.twine.rs',
				'/tmp/native-cover.png'
			)
		);
		expect(
			screen.getAllByText('assets/native-cover.png').length
		).toBeGreaterThan(0);
	});

	it('loads live native project assets and surfaces unused files', async () => {
		const {story} = assetStory();

		saveProjectMetadata(story.id, {
			rootPath: '/native/project.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			listProjectAssets: jest.fn(async () => [
				inventoryAsset('assets/cover.png'),
				inventoryAsset('assets/unused.png')
			])
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

		await waitFor(() => expect(screen.getByText('Live folder')).toBeInTheDocument());
		expect(screen.getByText('2 files')).toBeInTheDocument();
		expect(screen.getAllByText('assets/unused.png').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Unused').length).toBeGreaterThan(0);
		expect(knownAssetInventoryForStory(story.id).map(asset => asset.path)).toEqual([
			'assets/cover.png',
			'assets/unused.png'
		]);
		fireEvent.click(assetCard('assets/cover.png'));
		await waitFor(() =>
			expect(screen.getByText('File + references')).toBeInTheDocument()
		);
	});

	it('renames native asset files before updating story references', async () => {
		const {story} = assetStory();
		const listProjectAssets = jest
			.fn()
			.mockResolvedValueOnce([inventoryAsset('assets/cover.png')])
			.mockResolvedValue([inventoryAsset('assets/hero.png')]);
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
			listProjectAssets,
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

		await waitFor(() => expect(screen.getByText('Live folder')).toBeInTheDocument());
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
