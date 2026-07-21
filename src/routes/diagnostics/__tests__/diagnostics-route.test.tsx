import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import {
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../../../core';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	LocationInspector,
	StoryInspector,
	TestRoute
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
				<TestRoute path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
					<StoryInspector id={story.id} />
				</TestRoute>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

function renderComponentWithLocation(
	configure?: (story: ReturnType<typeof diagnosticStory>['story']) => void
) {
	const {story} = diagnosticStory();

	configure?.(story);

	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/diagnostics`]}>
				<TestRoute path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
					<StoryInspector id={story.id} />
				</TestRoute>
				<LocationInspector />
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

function renderCleanComponent() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Healthy Castle',
		script: '',
		selected: true,
		stylesheet: ''
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		text: 'A quiet room.'
	});

	story.passages = [start];
	story.startPassage = start.id;

	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/diagnostics`]}>
				<TestRoute path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
				</TestRoute>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
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
		referenceCount: 1,
		references: [
			{
				context: 'css-url',
				end: path.length,
				fragment: null,
				kind: 'stylesheet',
				line: 1,
				original: path,
				passageId: null,
				path,
				query: null,
				sourceId: 'stylesheet',
				sourceName: 'Story Stylesheet',
				start: 0
			}
		],
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
			screen.getByRole('button', {name: /Active\s+1/})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Warnings\s+1/})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Broken Links\s+1/})
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: /Dismissed\s+0/})).toBeDisabled();
		expect(
			screen.queryByRole('button', {name: /Errors/})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Info/})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Missing Assets/})
		).not.toBeInTheDocument();
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

		fireEvent.change(screen.getByLabelText('Filter diagnostics'), {
			target: {value: 'nothing matches this'}
		});

		expect(screen.getByText('No matching diagnostics')).toBeInTheDocument();
		expect(
			screen.getByText('Try another severity, category, or search term.')
		).toBeInTheDocument();
	});

	it('shows a healthy empty state instead of empty diagnostic categories', async () => {
		renderCleanComponent();

		expect(
			await screen.findByText('No issues found — your story is healthy')
		).toBeInTheDocument();
		expect(
			screen.getByText(/Diagnostics check story structure/)
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Active\s+0/})
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: /Dismissed\s+0/})).toBeDisabled();
		expect(screen.queryByText('Severity')).not.toBeInTheDocument();
		expect(screen.queryByText('Type')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Broken Links/})
		).not.toBeInTheDocument();
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
		expect(screen.getByText('No active diagnostics')).toBeInTheDocument();
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
		const {story} = renderComponentWithLocation(story => {
			story.id = 'stylesheet-diagnostic-story';
			story.passages = story.passages.map(passage => ({
				...passage,
				story: story.id
			}));
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

		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				`/stories/${story.id}`
			)
		);
		const query = new URLSearchParams(
			screen.getByTestId('location').getAttribute('data-search') ?? ''
		);
		expect(query.get('mode')).toBe('text');
		expect(query.get('source')).toBe('stylesheet');
		expect(query.get('passage')).toBeNull();
		expect(Number(query.get('offset'))).toBe(
			story.stylesheet.indexOf('assets/missing.png')
		);
	});
});
