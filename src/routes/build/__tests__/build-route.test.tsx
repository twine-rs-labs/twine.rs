import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
import {
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../../../core';
import {
	fakeLoadedStoryFormat,
	FakeStateProvider,
	fakeStory
} from '../../../test-util';
import {saveFile} from '../../../util/save-file';
import {BuildRoute} from '../build-route';

const mockPlayStory = jest.fn();
const mockProofStory = jest.fn();
const mockTestStory = jest.fn();

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		playStory: mockPlayStory,
		proofStory: mockProofStory,
		testStory: mockTestStory
	})
}));

jest.mock('../../../util/save-file', () => ({
	saveFile: jest.fn()
}));

function exportableAsset(path: string, sizeBytes: number): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'image',
		missing: false,
		modifiedAt: null,
		normalizedPath: path,
		path,
		previewUrl: null,
		publish: {
			copy: true,
			outputPath: path,
			reason: 'Copy asset into published output'
		},
		referenceCount: 1,
		references: [],
		sizeBytes,
		snippet: {label: 'HTML', mediaType: 'text/html', text: ''},
		thumbnailUrl: null,
		unused: false,
		width: null
	};
}

describe('<BuildRoute>', () => {
	function renderComponent() {
		const format = fakeLoadedStoryFormat(
			{id: 'format-id', name: 'Chapbook', version: '2.1.0'},
			{
				name: 'Chapbook',
				source: '<tw-storydata>{{STORY_NAME}}{{STORY_DATA}}</tw-storydata>',
				version: '2.1.0'
			}
		);
		const story = {
			...fakeStory(2),
			id: 'story-id',
			name: 'Moon Castle',
			passages: fakeStory(2).passages.map((passage, index) => ({
				...passage,
				id: `passage-${index}`,
				name: index === 0 ? 'Opening' : 'Atrium',
				story: 'story-id',
				text: index === 0 ? 'Look north.' : 'A vaulted room.'
			})),
			selected: true,
			startPassage: 'passage-0',
			storyFormat: format.name,
			storyFormatVersion: format.version
		};

		render(
			<FakeStateProvider
				prefs={{
					proofingFormat: {name: format.name, version: format.version},
					storyFormat: {name: format.name, version: format.version}
				}}
				stories={[story]}
				storyFormats={[format]}
			>
				<MemoryRouter initialEntries={[`/stories/${story.id}/build`]}>
					<Route path="/stories/:storyId/build">
						<BuildRoute />
					</Route>
				</MemoryRouter>
			</FakeStateProvider>
		);

		return {format, story};
	}

	beforeEach(() => {
		jest.clearAllMocks();
		window.localStorage.clear();
		replaceKnownAssetInventoryForStory('story-id', []);
	});

	it('collapses the old target list into Export and Preview flows', async () => {
		renderComponent();

		await waitFor(() =>
			expect(screen.getByText('Ready to export')).toBeInTheDocument()
		);
		expect(screen.getByRole('tab', {name: /Export/})).toBeInTheDocument();
		expect(screen.getByRole('tab', {name: /Preview/})).toBeInTheDocument();
		expect(screen.getByText('Playable HTML')).toBeInTheDocument();
		expect(screen.getByText('Twee Source')).toBeInTheDocument();
		expect(screen.getByText('JSON')).toBeInTheDocument();
		expect(screen.getByText('Archive (.zip)')).toBeInTheDocument();
		expect(screen.getByText('Inline all assets')).toBeInTheDocument();
		expect(screen.getByText('Classic Twine compatibility')).toBeInTheDocument();
		expect(screen.queryByText('Build output')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Compatibility Export/})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Inspect Source/})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Inspect HTML/})
		).not.toBeInTheDocument();
	});

	it('turns off inline assets by default for heavy asset plans', async () => {
		replaceKnownAssetInventoryForStory(
			'story-id',
			Array.from({length: 26}, (_, index) =>
				exportableAsset(`assets/${index}.png`, 1024)
			)
		);

		renderComponent();

		await waitFor(() =>
			expect(
				screen.getByText('Inline assets off by default')
			).toBeInTheDocument()
		);
		expect(screen.getByLabelText('Inline all assets')).not.toBeChecked();
		expect(screen.getByText(/26 exportable assets/)).toBeInTheDocument();

		fireEvent.click(screen.getByLabelText('Inline all assets'));

		expect(screen.getByLabelText('Inline all assets')).toBeChecked();
	});

	it('exports the selected file format', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Export Playable HTML'}));

		await waitFor(() =>
			expect(saveFile).toHaveBeenCalledWith(
				expect.stringContaining('Moon Castle'),
				'Moon Castle.html',
				'text/html;charset=utf-8'
			)
		);
		expect(screen.getByText('Saved Moon Castle.html.')).toBeInTheDocument();
	});

	it('frames source-only formats as info and hides publish', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Twee Source/}));

		expect(screen.getByText('Source-only format')).toBeInTheDocument();
		expect(screen.getByText('Ready to export')).toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Publish online/})
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Export Twee Source'}));

		await waitFor(() =>
			expect(saveFile).toHaveBeenCalledWith(
				expect.stringContaining('StoryTitle'),
				'Moon Castle.twee',
				'text/plain;charset=utf-8'
			)
		);
	});

	it('shows inspection on-screen instead of saving inspection reports', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Inspect output'}));

		expect(
			await screen.findByRole('complementary', {name: 'Inspect output'})
		).toBeInTheDocument();
		expect(screen.getByRole('tab', {name: /Source/})).toBeInTheDocument();
		expect(screen.getByRole('tab', {name: /HTML/})).toBeInTheDocument();
		expect(
			screen.getByText(/this used to be an exported report/)
		).toBeInTheDocument();
		expect(saveFile).not.toHaveBeenCalled();
	});

	it('runs preview actions with the inline proofing format choice', async () => {
		const {format} = renderComponent();

		fireEvent.click(screen.getByRole('tab', {name: /Preview/}));

		expect(screen.queryByText('Test from a passage')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: 'Test'})
		).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Proof'}));

		await waitFor(() =>
			expect(mockProofStory).toHaveBeenCalledWith('story-id', {
				name: format.name,
				version: format.version
			})
		);
		expect(mockTestStory).not.toHaveBeenCalled();
	});
});
