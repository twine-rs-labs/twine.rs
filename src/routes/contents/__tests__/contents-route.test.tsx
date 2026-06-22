import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../../../core';
import {markProjectStoryHydration} from '../../../store/project-hydration';
import {saveProjectMetadata} from '../../../store/project-metadata';
import {ContentsRoute} from '../contents-route';

const mockTestStory = jest.fn();

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		testStory: mockTestStory
	})
}));

function indexedStory() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Indexed Castle',
		selected: true
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		tags: ['intro'],
		text: 'Set $score. [[Missing]] <img src="assets/cover.png">'
	});
	const end = fakePassage({
		id: 'end',
		name: 'End',
		selected: false,
		story: story.id,
		text: 'Done'
	});

	story.passages = [start, end];
	story.startPassage = start.id;
	story.tagColors = {intro: 'green'};
	return {end, start, story};
}

function inventoryAsset(path: string): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'image',
		missing: false,
		modifiedAt: '2026-06-21T16:00:00.000Z',
		normalizedPath: path,
		path,
		previewUrl: `file:///native/project.twine.rs/${path}`,
		publish: {
			copy: true,
			outputPath: path,
			reason: 'Copy asset into published output'
		},
		referenceCount: 1,
		references: [],
		sizeBytes: 2048,
		snippet: {
			label: 'Insert asset reference',
			mediaType: 'image',
			text: `<img src="${path}" alt="">`
		},
		thumbnailUrl: `file:///native/project.twine.rs/${path}`,
		unused: false,
		width: null
	};
}

function renderComponent(
	configure?: (story: ReturnType<typeof indexedStory>['story']) => void
) {
	const {story} = indexedStory();

	configure?.(story);

	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/contents`]}>
				<Route path="/stories/:storyId/contents">
					<ContentsRoute />
					<StoryInspector id={story.id} />
				</Route>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

describe('<ContentsRoute>', () => {
	beforeEach(() => {
		mockTestStory.mockReset();
		window.localStorage.clear();
		replaceKnownAssetInventoryForStory('story-id', []);
	});

	afterEach(() => {
		delete (window as any).twineElectron;
	});

	it('surfaces indexed passages, variables, assets, and diagnostic groups', () => {
		renderComponent();

		expect(screen.getByLabelText('Filter contents')).toBeInTheDocument();
		expect(screen.getByText('Indexed Castle')).toBeInTheDocument();
		expect(screen.getAllByText('Start').length).toBeGreaterThan(0);
		expect(screen.getByText('$score')).toBeInTheDocument();
		expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Diagnostics').length).toBeGreaterThan(0);
	});

	it('filters the contents list by asset type', () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Assets/}));

		expect(screen.getAllByText('assets/cover.png').length).toBeGreaterThan(0);
		expect(screen.queryByText('$score')).not.toBeInTheDocument();
	});

	it('shows live asset previews in contents rows and details', () => {
		const {result} = renderComponent(story =>
			replaceKnownAssetInventoryForStory(story.id, [
				inventoryAsset('assets/cover.png')
			])
		);

		fireEvent.click(screen.getByRole('button', {name: /Assets/}));

		expect(
			result.container.querySelector(
				'.contents-route__row-thumb img[src="file:///native/project.twine.rs/assets/cover.png"]'
			)
		).toBeInTheDocument();
		expect(
			result.container.querySelector(
				'.contents-route__asset-preview img[src="file:///native/project.twine.rs/assets/cover.png"]'
			)
		).toBeInTheDocument();
	});

	it('updates contents when native asset inventory arrives after render', async () => {
		const {result, story} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Assets/}));
		expect(
			result.container.querySelector('.contents-route__row-thumb img')
		).not.toBeInTheDocument();

		act(() => {
			replaceKnownAssetInventoryForStory(story.id, [
				inventoryAsset('assets/late-cover.png')
			]);
		});

		await waitFor(() =>
			expect(
				result.container.querySelector(
					'.contents-route__row-thumb img[src="file:///native/project.twine.rs/assets/late-cover.png"]'
				)
			).toBeInTheDocument()
		);
	});

	it('recovers the default native project folder for asset previews', async () => {
		(window as any).twineElectron = {
			getStoryLibraryFolder: jest.fn(async () => '/native/library'),
			listProjectAssets: jest.fn(async () => [
				{
					...inventoryAsset('assets/cover.png'),
					previewUrl:
						'file:///native/library/Projects/indexed-castle.twine.rs/assets/cover.png',
					thumbnailUrl:
						'file:///native/library/Projects/indexed-castle.twine.rs/assets/cover.png'
				}
			])
		};
		const {result} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Assets/}));

		await waitFor(() =>
			expect(
				result.container.querySelector(
					'.contents-route__row-thumb img[src="file:///native/library/Projects/indexed-castle.twine.rs/assets/cover.png"]'
				)
			).toBeInTheDocument()
		);
		expect(
			(window as any).twineElectron.listProjectAssets
		).toHaveBeenCalledWith('/native/library/Projects/indexed-castle.twine.rs');
	});

	it('defers full indexing for shell-loaded native stories until hydration completes', async () => {
		const {story} = indexedStory();

		saveProjectMetadata(story.id, {
			rootPath: '/native/project.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath: '/native/project.twine.rs'
		});

		renderComponent(() => undefined);

		expect(screen.queryByText('$score')).not.toBeInTheDocument();

		act(() => {
			markProjectStoryHydration(story.id, {
				passageTextLoaded: true,
				rootPath: '/native/project.twine.rs'
			});
		});

		expect(await screen.findByText('$score')).toBeInTheDocument();
	});

	it('windows large contents lists to viewport-sized row counts', () => {
		const {result} = renderComponent(story => {
			story.passages = Array.from({length: 1000}, (_, index) =>
				fakePassage({
					id: `passage-${index}`,
					name: `Passage ${index}`,
					story: story.id,
					text: ''
				})
			);
			story.startPassage = story.passages[0].id;
		});

		expect(
			result.container.querySelectorAll('.contents-route__row').length
		).toBeLessThan(80);
		expect(screen.getByText(/of 1003/)).toBeInTheDocument();
	});

	it('tests the selected indexed passage from the inspector', () => {
		const {story} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Test From Here'}));

		expect(mockTestStory).toHaveBeenCalledWith(story.id, story.passages[0].id);
	});
});
