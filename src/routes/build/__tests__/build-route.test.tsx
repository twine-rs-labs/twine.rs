import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter} from 'react-router';
import {
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../../../core';
import {
	fakeLoadedStoryFormat,
	FakeStateProvider,
	fakeStory,
	TestRoute
} from '../../../test-util';
import {saveFile} from '../../../util/save-file';
import {saveProjectMetadata} from '../../../store/project-metadata';
import type {TwineElectronWindow} from '../../../electron/shared';
import {BuildRoute} from '../build-route';

const mockPlayStory = jest.fn();
const mockProofStory = jest.fn();
const mockTestStory = jest.fn();

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		playStory: mockPlayStory,
		playStoryWithBuild: mockPlayStory,
		proofStory: mockProofStory,
		proofStoryWithBuild: mockProofStory,
		testStory: mockTestStory
	})
}));

jest.mock('../../../util/save-file', () => ({
	saveFile: jest.fn()
}));

function exportableAsset(
	path: string,
	sizeBytes: number
): CoreAssetInventoryEntry {
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
	function renderComponent(openingText = 'Look north.') {
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
				text: index === 0 ? openingText : 'A vaulted room.'
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
					<TestRoute path="/stories/:storyId/build">
						<BuildRoute />
					</TestRoute>
				</MemoryRouter>
			</FakeStateProvider>
		);

		return {format, story};
	}

	beforeEach(() => {
		jest.clearAllMocks();
		window.localStorage.clear();
		replaceKnownAssetInventoryForStory('story-id', []);
		delete (window as TwineElectronWindow).twineElectron;
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
		expect(screen.getByText('Embed referenced media')).toBeInTheDocument();
		expect(screen.getByText('Unavailable')).toBeInTheDocument();
		expect(
			screen.queryByLabelText('Embed referenced media')
		).not.toBeInTheDocument();
		expect(screen.getByText('Classic Twine compatibility')).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Prepare publish package'})
		).toBeInTheDocument();
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

	it('turns off referenced-media embedding by default for heavy plans', async () => {
		saveProjectMetadata('story-id', {
			rootPath: '/project/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			getReferencedMediaEmbeddingCapability: jest.fn().mockResolvedValue({
				available: true,
				maxFileBytes: 25 * 1024 * 1024,
				maxFileCount: 25,
				maxTotalEncodedBytes: 25 * 1024 * 1024
			})
		};
		replaceKnownAssetInventoryForStory(
			'story-id',
			Array.from({length: 26}, (_, index) =>
				exportableAsset(`assets/${index}.png`, 1024)
			)
		);

		renderComponent();

		await waitFor(() =>
			expect(
				screen.getByText('Media embedding off by default')
			).toBeInTheDocument()
		);
		expect(screen.getByLabelText('Embed referenced media')).not.toBeChecked();
		expect(screen.getByText(/26 exportable assets/)).toBeInTheDocument();

		fireEvent.click(screen.getByLabelText('Embed referenced media'));

		expect(screen.getByLabelText('Embed referenced media')).toBeChecked();
	});

	it('does not present unknown asset sizes as a zero-byte estimate', async () => {
		const path = 'assets/cover.png';

		saveProjectMetadata('story-id', {
			rootPath: '/project/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			getReferencedMediaEmbeddingCapability: jest.fn().mockResolvedValue({
				available: true,
				maxFileBytes: 25 * 1024 * 1024,
				maxFileCount: 25,
				maxTotalEncodedBytes: 25 * 1024 * 1024
			})
		};
		replaceKnownAssetInventoryForStory('story-id', [
			{...exportableAsset(path, 0), sizeBytes: null}
		]);

		renderComponent(`<img src="${path}">`);

		expect(
			await screen.findByText(
				'1 candidate · Size estimate unavailable (1 candidate with unknown size).'
			)
		).toBeInTheDocument();
		expect(screen.queryByText(/0 B estimated encoded size/)).toBeNull();
	});

	it('refreshes native asset sizes before estimating embedded media', async () => {
		const path = 'assets/cover.png';
		const projectSessionSnapshot = jest.fn().mockResolvedValue({
			assets: [exportableAsset(path, 2048)]
		});

		saveProjectMetadata('story-id', {
			rootPath: '/project/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			getReferencedMediaEmbeddingCapability: jest.fn().mockResolvedValue({
				available: true,
				maxFileBytes: 25 * 1024 * 1024,
				maxFileCount: 25,
				maxTotalEncodedBytes: 25 * 1024 * 1024
			}),
			projectSessionSnapshot
		};

		renderComponent(`<img src="${path}">`);

		expect(
			await screen.findByText('1 candidate · 2.7 KB estimated encoded size.')
		).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getByLabelText('Embed referenced media')).toBeChecked()
		);
		expect(projectSessionSnapshot).toHaveBeenCalledWith(
			'/project/moon-castle.twine.rs',
			['story-id']
		);
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

	it('passes desktop embedding through to prepared HTML and reporting', async () => {
		const path = 'assets/cover.png';

		saveProjectMetadata('story-id', {
			rootPath: '/project/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const readProjectAssetPayloads = jest.fn().mockResolvedValue({
			failures: [],
			payloads: [
				{
					bytes: new Uint8Array([0, 1, 255]),
					encodedSizeBytes: 4,
					mediaType: 'image/png',
					path,
					sizeBytes: 3
				}
			],
			totalEncodedBytes: 4,
			totalSourceBytes: 3
		});
		(window as any).twineElectron = {
			getReferencedMediaEmbeddingCapability: jest.fn().mockResolvedValue({
				available: true,
				maxFileBytes: 25 * 1024 * 1024,
				maxFileCount: 25,
				maxTotalEncodedBytes: 25 * 1024 * 1024
			}),
			readProjectAssetPayloads
		};
		replaceKnownAssetInventoryForStory('story-id', [exportableAsset(path, 3)]);
		renderComponent(`<img src="${path}">`);

		await waitFor(() =>
			expect(screen.getByLabelText('Embed referenced media')).toBeChecked()
		);
		fireEvent.click(screen.getByRole('button', {name: 'Export Playable HTML'}));

		await waitFor(() =>
			expect(saveFile).toHaveBeenCalledWith(
				expect.stringContaining('data:image/png;base64,AAH/'),
				'Moon Castle.html',
				'text/html;charset=utf-8'
			)
		);
		expect(readProjectAssetPayloads).toHaveBeenCalledWith(
			'/project/moon-castle.twine.rs',
			[path],
			expect.objectContaining({maxFileCount: 25})
		);
		expect(screen.getByText(/1 embedded, 0 external/)).toBeInTheDocument();
	});

	it('frames source-only formats as info and hides publish packaging', async () => {
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /Twee Source/}));

		expect(screen.getByText('Source-only format')).toBeInTheDocument();
		expect(screen.getByText('Ready to export')).toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Prepare publish package/})
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
