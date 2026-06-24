import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createMemoryHistory} from 'history';
import * as React from 'react';
import {MemoryRouter, Route, Router} from 'react-router-dom';
import {
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../../../core';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {DiagnosticsRoute} from '../diagnostics-route';

const mockTestStory = jest.fn();

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		testStory: mockTestStory
	})
}));

function diagnosticStory() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Diagnostic Castle',
		selected: true
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		text: 'Go to [[Missing]].'
	});
	const isolated = fakePassage({
		id: 'isolated',
		name: 'Isolated',
		selected: false,
		story: story.id,
		text: 'No one links here.'
	});

	story.passages = [start, isolated];
	story.startPassage = start.id;
	return {isolated, start, story};
}

function renderComponent() {
	const {story} = diagnosticStory();
	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/diagnostics`]}>
				<Route path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
					<StoryInspector id={story.id} />
				</Route>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

function renderComponentWithHistory(
	configure?: (story: ReturnType<typeof diagnosticStory>['story']) => void
) {
	const {story} = diagnosticStory();

	configure?.(story);

	const history = createMemoryHistory({
		initialEntries: [`/stories/${story.id}/diagnostics`]
	});
	const result = render(
		<FakeStateProvider stories={[story]}>
			<Router history={history}>
				<Route path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
					<StoryInspector id={story.id} />
				</Route>
			</Router>
		</FakeStateProvider>
	);

	return {history, result, story};
}

function missingAsset(path: string): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: false,
		height: null,
		kind: 'image',
		missing: true,
		modifiedAt: null,
		normalizedPath: path,
		path,
		previewUrl: null,
		publish: {
			copy: false,
			outputPath: path,
			reason: 'Referenced file is missing'
		},
		referenceCount: 0,
		references: [],
		sizeBytes: null,
		snippet: {
			label: 'Insert asset reference',
			mediaType: 'image',
			text: `<img src="${path}" alt="">`
		},
		thumbnailUrl: null,
		unused: false,
		width: null
	};
}

describe('<DiagnosticsRoute>', () => {
	beforeEach(() => {
		window.localStorage.clear();
		mockTestStory.mockReset();
		replaceKnownAssetInventoryForStory('story-id', []);
	});

	it('groups diagnostics and exposes source/graph reveal actions', async () => {
		renderComponent();

		expect(
			await screen.findByLabelText('Filter diagnostics')
		).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0)
		);
		expect(
			screen.getAllByText(/Broken link to "Missing"/).length
		).toBeGreaterThan(0);
		expect(screen.queryByText('unreachable-passage')).not.toBeInTheDocument();
		expect(screen.queryByText(/story-format macros/)).not.toBeInTheDocument();
		expect(screen.getAllByText('warning').length).toBeGreaterThan(0);
		expect(
			screen.getByRole('button', {name: 'Reveal Source'})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Reveal Graph'})
		).toBeInTheDocument();
	});

	it('dismisses and restores a specific validation diagnostic', async () => {
		renderComponent();

		await waitFor(() =>
			expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0)
		);

		fireEvent.click(screen.getByRole('button', {name: 'Dismiss Diagnostic'}));

		await waitFor(() =>
			expect(screen.queryByText('broken-link')).not.toBeInTheDocument()
		);
		expect(screen.queryByText('unreachable-passage')).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: /Dismissed/}));

		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
		expect(
			screen.getByRole('button', {name: 'Restore Diagnostic'})
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Restore Diagnostic'}));

		await waitFor(() =>
			expect(screen.queryByText('broken-link')).not.toBeInTheDocument()
		);

		fireEvent.click(screen.getByRole('button', {name: /Active/}));

		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
	});

	it('runs executable quick fixes through the core host', async () => {
		const {result} = renderComponent();

		fireEvent.click(
			await screen.findByRole('button', {name: 'Create "Missing"'})
		);

		await waitFor(() =>
			expect(
				result.container.querySelector('[data-name="Missing"]')
			).toBeTruthy()
		);
	});

	it('tests the passage attached to the selected diagnostic', async () => {
		const {story} = renderComponent();

		fireEvent.click(
			await screen.findByRole('button', {name: 'Test From Here'})
		);

		expect(mockTestStory).toHaveBeenCalledWith(story.id, story.passages[0].id);
	});

	it('reveals stylesheet diagnostics with a source target instead of a passage fallback', async () => {
		const {history, story} = renderComponentWithHistory(story => {
			story.passages[0].text = 'No broken links here.';
			story.stylesheet = '.hero { background: url("assets/missing.png"); }';
			replaceKnownAssetInventoryForStory(story.id, [
				missingAsset('assets/missing.png')
			]);
		});

		await waitFor(() =>
			expect(screen.getAllByText('missing-asset').length).toBeGreaterThan(0)
		);

		fireEvent.click(screen.getByRole('button', {name: 'Reveal Source'}));

		const query = new URLSearchParams(history.location.search);

		expect(history.location.pathname).toBe(`/stories/${story.id}`);
		expect(query.get('mode')).toBe('text');
		expect(query.get('source')).toBe('stylesheet');
		expect(query.get('passage')).toBeNull();
		expect(Number(query.get('offset'))).toBe(
			story.stylesheet.indexOf('assets/missing.png')
		);
	});
});
