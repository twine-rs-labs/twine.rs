import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {
	fakeLoadedStoryFormat,
	FakeStateProvider,
	fakeStoryFormatProperties,
	PrefInspector
} from '../../../test-util';
import {fetchStoryFormatProperties} from '../../../util/story-format/fetch-properties';
import {StoryFormatsRoute} from '../story-formats-route';

jest.mock('../../../util/story-format/fetch-properties', () => ({
	fetchStoryFormatProperties: jest.fn()
}));

describe('<StoryFormatsRoute>', () => {
	function renderComponent() {
		const format = fakeLoadedStoryFormat(
			{id: 'format-id', name: 'Chapbook', userAdded: true, version: '2.1.0'},
			{
				name: 'Chapbook',
				source: '{{STORY_DATA}}',
				twineRs: {
					capabilities: {
						diagnostics: true,
						editorToolbarActions: true,
						parser: true,
						syntax: true
					},
					development: {
						devServerUrl: 'http://localhost:5173/format.js',
						hmr: true,
						localFolderPath: '/formats/chapbook'
					},
					modules: [
						{id: 'runtime', slot: 'runtime', url: './runtime.js'},
						{id: 'editor', slot: 'editor', url: './editor.js'}
					]
				},
				version: '2.1.0'
			}
		);

		render(
			<FakeStateProvider
				prefs={{
					disabledStoryFormatEditorExtensions: [],
					proofingFormat: {name: 'Paper', version: '1.0.0'},
					storyFormat: {name: 'Harlowe', version: '3.3.9'}
				}}
				storyFormats={[format]}
			>
				<StoryFormatsRoute />
				<PrefInspector name="storyFormat" />
				<PrefInspector name="disabledStoryFormatEditorExtensions" />
			</FakeStateProvider>
		);

		return {format};
	}

	beforeEach(() => {
		jest.clearAllMocks();
	});

	it('summarizes capabilities, publish safety, and development metadata', () => {
		renderComponent();

		expect(screen.getByRole('heading', {name: 'Chapbook'})).toBeInTheDocument();
		expect(screen.getAllByText('Parser').length).toBeGreaterThan(0);
		expect(screen.getAllByText('Diagnostics').length).toBeGreaterThan(0);
		expect(screen.getByText('Declared modules')).toBeInTheDocument();
		expect(screen.getByText('2')).toBeInTheDocument();
		expect(
			screen.getByText('http://localhost:5173/format.js')
		).toBeInTheDocument();
		expect(screen.getByText('/formats/chapbook')).toBeInTheDocument();
		expect(screen.getByText(/publish-safety issue/)).toBeInTheDocument();
	});

	it('sets the selected format as the app default', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Use as Default'}));

		await waitFor(() =>
			expect(
				screen.getByTestId('pref-inspector-storyFormat')
			).toHaveTextContent(JSON.stringify({name: 'Chapbook', version: '2.1.0'}))
		);
	});

	it('can disable editor extensions for a loaded format', async () => {
		renderComponent();

		fireEvent.click(screen.getByLabelText('Enable editor extensions'));

		await waitFor(() =>
			expect(
				screen.getByTestId('pref-inspector-disabledStoryFormatEditorExtensions')
			).toHaveTextContent(
				JSON.stringify([{name: 'Chapbook', version: '2.1.0'}])
			)
		);
	});

	it('shows the exact bundled Harlowe native CM6 integration', () => {
		const format = fakeLoadedStoryFormat(
			{
				name: 'Harlowe',
				url: 'story-formats/harlowe-3.3.9/format.js',
				userAdded: false,
				version: '3.3.9'
			},
			{name: 'Harlowe', source: '{{STORY_DATA}}', version: '3.3.9'}
		);

		render(
			<FakeStateProvider storyFormats={[format]}>
				<StoryFormatsRoute />
			</FakeStateProvider>
		);

		expect(
			screen.getByText('Native CM6 editor integration (harlowe-3.3.9)')
		).toBeInTheDocument();
		expect(screen.getAllByText('Autocomplete')).not.toHaveLength(0);
		expect(screen.getAllByText('Supported').length).toBeGreaterThan(0);
		expect(
			screen.getByText('Validated').closest('.story-formats-route__status')
		).toHaveClass('story-formats-route__status--ok');
		expect(screen.getAllByText('Supported')[0]).toHaveClass(
			'story-formats-route__row-value--ok'
		);
	});

	it('surfaces a content-free runtime editor diagnostic', () => {
		const format = fakeLoadedStoryFormat();

		format.editorIntegrationDiagnostic = {
			code: 'legacy-editor-runtime-error',
			feature: 'mode',
			message:
				'Legacy editor mode disabled after an unsupported format API call',
			unsupportedApi: 'lineOracle'
		};

		render(
			<FakeStateProvider storyFormats={[format]}>
				<StoryFormatsRoute />
			</FakeStateProvider>
		);

		expect(
			screen.getByText(
				'Legacy editor mode disabled after an unsupported format API call'
			)
		).toBeInTheDocument();
		expect(screen.getByText('lineOracle')).toBeInTheDocument();
		expect(
			screen.queryByText('Adapted legacy editor integration')
		).not.toBeInTheDocument();
	});

	it('reloads the selected format from its URL for the dev loop', async () => {
		(fetchStoryFormatProperties as jest.Mock).mockResolvedValue({
			...fakeStoryFormatProperties(),
			name: 'Chapbook',
			source: '{{STORY_DATA}} reloaded',
			version: '2.1.1'
		});
		const {format} = renderComponent();

		fireEvent.click(screen.getByRole('button', {name: 'Reload Format'}));

		expect(
			await screen.findByText('Reloaded Chapbook 2.1.1')
		).toBeInTheDocument();
		expect(screen.getAllByText(/v2.1.1/).length).toBeGreaterThan(0);
		expect(fetchStoryFormatProperties).toHaveBeenCalledWith(format.url);
	});

	it('registers a URL-added story format', async () => {
		(fetchStoryFormatProperties as jest.Mock).mockResolvedValue({
			...fakeStoryFormatProperties(),
			name: 'Local Lab',
			source: '{{STORY_DATA}}',
			version: '0.0.1'
		});
		renderComponent();

		fireEvent.change(screen.getByLabelText('Story format URL'), {
			target: {value: 'http://localhost:5173/format.js'}
		});
		fireEvent.click(screen.getByRole('button', {name: 'Add'}));

		expect(await screen.findByText('Local Lab')).toBeInTheDocument();
		expect(fetchStoryFormatProperties).toHaveBeenCalledWith(
			'http://localhost:5173/format.js'
		);
	});
});
