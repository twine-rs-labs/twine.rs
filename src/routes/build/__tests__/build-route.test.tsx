import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, Route} from 'react-router-dom';
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
	});

	it('surfaces M6 build targets, capabilities, and output context', () => {
		renderComponent();

		expect(screen.getByRole('button', {name: /Play/})).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Export HTML/})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Compatibility Export/})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Inspect Source/})
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: /Package/})).toBeInTheDocument();
		expect(screen.getByText('Format Capabilities')).toBeInTheDocument();
		expect(screen.getByText('Fidelity Boundary')).toBeInTheDocument();
		expect(screen.getByText('Moon Castle')).toBeInTheDocument();
	});

	it('prepares a build report for the selected export target', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Prepare Report'}));

		expect(await screen.findByText('Moon Castle.html')).toBeInTheDocument();
		expect(screen.getByText(/Prepared 1 output file/)).toBeInTheDocument();
		expect(screen.getByText('standard Twine story data')).toBeInTheDocument();
	});

	it('surfaces promoted build diagnostics for compatibility exports', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Compatibility Export/}));
		fireEvent.click(screen.getByRole('button', {name: 'Prepare Report'}));

		expect(
			await screen.findByText('Build diagnostics need review')
		).toBeInTheDocument();
		expect(screen.getAllByText('fidelity-omission').length).toBeGreaterThan(0);
		expect(
			screen.getByText(/build diagnostic\(s\) promoted into the report/)
		).toBeInTheDocument();
	});

	it('saves the primary output for export targets', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Build and Save'}));

		await waitFor(() =>
			expect(saveFile).toHaveBeenCalledWith(
				expect.stringContaining('Moon Castle'),
				'Moon Castle.html',
				'text/html;charset=utf-8'
			)
		);
		expect(screen.getByText('Saved Moon Castle.html.')).toBeInTheDocument();
	});

	it('saves inspection reports for inspection targets', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Inspect Source/}));
		fireEvent.click(screen.getByRole('button', {name: 'Build and Save'}));

		await waitFor(() =>
			expect(saveFile).toHaveBeenCalledWith(
				expect.stringContaining('Source inspection for Moon Castle'),
				'Moon Castle.source-inspection.txt',
				'text/plain;charset=utf-8'
			)
		);
	});

	it('runs preview targets after preparing their package', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Test From Selection/}));
		fireEvent.click(
			screen.getByRole('button', {name: /Run Test From Selection/})
		);

		await waitFor(() =>
			expect(mockTestStory).toHaveBeenCalledWith('story-id', 'passage-0')
		);
		expect(screen.getByText('Opened Test preview.')).toBeInTheDocument();
	});
});
