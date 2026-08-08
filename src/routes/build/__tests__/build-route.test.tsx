import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {webcrypto} from 'node:crypto';
import * as React from 'react';
import {MemoryRouter, useNavigate} from 'react-router';
import {
	replaceKnownAssetInventoryForStory,
	updatePassageTextCommand,
	useCoreProjectHost,
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
import type {
	NativeProjectPackageAssetPayloadBatch,
	TwineElectronWindow
} from '../../../electron/shared';
import {BuildRoute} from '../build-route';

const mockPlayStory = jest.fn();
const mockProofStory = jest.fn();
const mockTestStory = jest.fn();
let navigateForTest: ReturnType<typeof useNavigate>;
let coreProjectHostForTest: ReturnType<typeof useCoreProjectHost>;

interface Deferred<T> {
	promise: Promise<T>;
	resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(promiseResolve => {
		resolve = promiseResolve;
	});

	return {promise, resolve};
}

const BuildRouteTestControls: React.FC = () => {
	navigateForTest = useNavigate();
	coreProjectHostForTest = useCoreProjectHost();
	return null;
};

Object.defineProperty(globalThis, 'crypto', {
	configurable: true,
	value: webcrypto
});

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

function packageAssetBatch(
	props: Partial<NativeProjectPackageAssetPayloadBatch> = {}
): NativeProjectPackageAssetPayloadBatch {
	return {
		appliedLimits: {
			maxAssetFileBytes: 50 * 1024 * 1024,
			maxAssetFileCount: 1000,
			maxAssetTotalBytes: 50 * 1024 * 1024
		},
		excluded: [],
		failures: [],
		inventory: [],
		payloads: [],
		snapshot: {
			contentFingerprint: 'a'.repeat(64),
			generation: 3,
			inventoryFingerprint: 'b'.repeat(64),
			sessionInstanceId: 'session-1'
		},
		totalEncodedBytes: 0,
		totalSourceBytes: 0,
		...props
	};
}

describe('<BuildRoute>', () => {
	async function selectPackageForPreparation() {
		fireEvent.click(screen.getByText('Package (.zip)'));
		const prepare = screen.getByRole('button', {name: 'Prepare Package'});

		await waitFor(() => expect(prepare).toBeEnabled());
		return prepare;
	}

	function renderComponent(
		openingText = 'Look north.',
		options: {includeSecondStory?: boolean; missingStartPassage?: boolean} = {}
	) {
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
		if (options.missingStartPassage) story.startPassage = 'missing-passage';
		const secondStory = {
			...fakeStory(1),
			id: 'story-id-b',
			ifid: '11111111-2222-4333-8444-555555555555',
			name: 'Sunken Library',
			passages: fakeStory(1).passages.map(passage => ({
				...passage,
				id: 'passage-b',
				name: 'Vestibule',
				story: 'story-id-b',
				text: 'Dusty shelves.'
			})),
			selected: false,
			startPassage: 'passage-b',
			storyFormat: format.name,
			storyFormatVersion: format.version
		};

		render(
			<FakeStateProvider
				prefs={{
					proofingFormat: {name: format.name, version: format.version},
					storyFormat: {name: format.name, version: format.version}
				}}
				stories={options.includeSecondStory ? [story, secondStory] : [story]}
				storyFormats={[format]}
			>
				<MemoryRouter initialEntries={[`/stories/${story.id}/build`]}>
					<BuildRouteTestControls />
					<TestRoute path="/stories/:storyId/build">
						<BuildRoute />
					</TestRoute>
				</MemoryRouter>
			</FakeStateProvider>
		);

		return {format, secondStory, story};
	}

	beforeEach(() => {
		jest.restoreAllMocks();
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
		expect(screen.getByText('Package (.zip)')).toBeInTheDocument();
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

	it('prepares and reviews a complete package before saving the exact archive', async () => {
		const readProjectPackageAssetPayloads = jest
			.fn()
			.mockResolvedValue(packageAssetBatch());

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
			readProjectPackageAssetPayloads
		};
		renderComponent();

		fireEvent.click(await selectPackageForPreparation());

		expect(
			await screen.findByRole('region', {name: 'Package review'})
		).toBeInTheDocument();
		expect(screen.getByText('Complete in assessed scopes')).toBeInTheDocument();
		expect(saveFile).not.toHaveBeenCalled();
		expect(readProjectPackageAssetPayloads).toHaveBeenCalledWith(
			'/project/moon-castle.twine.rs',
			[]
		);

		fireEvent.click(
			screen.getByRole('button', {name: 'Save Complete Package'})
		);

		const savedBlob = (saveFile as jest.Mock).mock.calls[0][0] as Blob;
		const expectedSize =
			savedBlob.size < 1024
				? `${savedBlob.size} B`
				: `${(savedBlob.size / 1024).toFixed(1)} KB`;

		expect(saveFile).toHaveBeenCalledWith(
			savedBlob,
			'Moon Castle.zip',
			'application/zip'
		);
		expect(screen.getByText('Prepared size').parentElement).toHaveTextContent(
			expectedSize
		);

		fireEvent.click(
			screen.getByRole('button', {name: 'Save Complete Package'})
		);
		expect((saveFile as jest.Mock).mock.calls[1][0]).toBe(savedBlob);
		expect(readProjectPackageAssetPayloads).toHaveBeenCalledTimes(1);
	});

	it('requires explicit confirmation before saving an incomplete package', async () => {
		const confirm = jest.spyOn(window, 'confirm').mockReturnValue(false);

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
			readProjectPackageAssetPayloads: jest.fn().mockResolvedValue(
				packageAssetBatch({
					failures: [
						{
							message: 'The file could not be read.',
							path: 'assets/missing.png',
							reason: 'unreadable'
						}
					],
					inventory: [
						{
							modifiedAtMs: 1,
							path: 'assets/missing.png',
							requiredByStaticReference: false,
							sizeBytes: 10
						}
					]
				})
			)
		};
		renderComponent('<img src="assets/missing.png">');

		fireEvent.click(await selectPackageForPreparation());
		const saveIncomplete = await screen.findByRole('button', {
			name: 'Save Incomplete Package'
		});

		expect(screen.getByText(/The file could not be read/)).toBeInTheDocument();
		fireEvent.click(saveIncomplete);
		expect(confirm).toHaveBeenCalled();
		expect(saveFile).not.toHaveBeenCalled();

		confirm.mockReturnValue(true);
		fireEvent.click(saveIncomplete);
		expect(saveFile).toHaveBeenCalledWith(
			expect.any(Blob),
			'Moon Castle.zip',
			'application/zip'
		);
		confirm.mockRestore();
	});

	it('blocks saving a package with security-grade inventory failures', async () => {
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
			readProjectPackageAssetPayloads: jest.fn().mockResolvedValue(
				packageAssetBatch({
					failures: [
						{
							message: 'A symbolic link was not followed.',
							path: 'assets/link.bin',
							reason: 'symlink'
						}
					]
				})
			)
		};
		renderComponent();

		fireEvent.click(await selectPackageForPreparation());

		const blocked = await screen.findByRole('button', {
			name: 'Package blocked'
		});
		expect(blocked).toBeDisabled();
		expect(
			screen.getByText(/symbolic link was not followed/)
		).toBeInTheDocument();
		expect(saveFile).not.toHaveBeenCalled();
	});

	it('rejects saving when the story revision changes after review', async () => {
		saveProjectMetadata('story-id', {
			rootPath: '/project/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			readProjectPackageAssetPayloads: jest
				.fn()
				.mockResolvedValue(packageAssetBatch())
		};
		const {story} = renderComponent();

		fireEvent.click(await selectPackageForPreparation());
		await screen.findByRole('button', {name: 'Save Complete Package'});
		await act(async () => {
			await coreProjectHostForTest.applyStoryCommand(
				updatePassageTextCommand(
					story.id,
					story.passages[0].id,
					'Changed after package review.'
				)
			);
		});

		fireEvent.click(
			screen.getByRole('button', {name: 'Save Complete Package'})
		);

		expect(
			await screen.findByText(
				'The story changed after this package was prepared. Prepare it again before saving.'
			)
		).toBeInTheDocument();
		expect(saveFile).not.toHaveBeenCalled();
		expect(
			screen.queryByRole('region', {name: 'Package review'})
		).not.toBeInTheDocument();
	});

	it('invalidates a reviewed package when navigating to another story', async () => {
		const readProjectPackageAssetPayloads = jest
			.fn()
			.mockResolvedValue(packageAssetBatch());

		for (const [id, rootPath] of [
			['story-id', '/project/moon-castle.twine.rs'],
			['story-id-b', '/project/sunken-library.twine.rs']
		] as const) {
			saveProjectMetadata(id, {
				rootPath,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
		}
		(window as any).twineElectron = {readProjectPackageAssetPayloads};
		renderComponent('Look north.', {includeSecondStory: true});

		fireEvent.click(await selectPackageForPreparation());
		await screen.findByRole('region', {name: 'Package review'});

		act(() => navigateForTest('/stories/story-id-b/build'));

		await waitFor(() =>
			expect(
				screen.queryByRole('region', {name: 'Package review'})
			).not.toBeInTheDocument()
		);
		expect(
			screen.queryByRole('button', {name: /Save .* Package/})
		).not.toBeInTheDocument();
		expect(saveFile).not.toHaveBeenCalled();
	});

	it('discards an in-flight package when navigating to another story', async () => {
		const pending = deferred<NativeProjectPackageAssetPayloadBatch>();
		const readProjectPackageAssetPayloads = jest
			.fn()
			.mockReturnValueOnce(pending.promise);

		for (const [id, rootPath] of [
			['story-id', '/project/moon-castle.twine.rs'],
			['story-id-b', '/project/sunken-library.twine.rs']
		] as const) {
			saveProjectMetadata(id, {
				rootPath,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
		}
		(window as any).twineElectron = {readProjectPackageAssetPayloads};
		renderComponent('Look north.', {includeSecondStory: true});

		fireEvent.click(await selectPackageForPreparation());
		await waitFor(() =>
			expect(readProjectPackageAssetPayloads).toHaveBeenCalledTimes(1)
		);
		act(() => navigateForTest('/stories/story-id-b/build'));
		await act(async () => {
			pending.resolve(packageAssetBatch());
			await pending.promise;
		});

		await waitFor(() =>
			expect(
				screen.queryByRole('region', {name: 'Package review'})
			).not.toBeInTheDocument()
		);
		expect(
			screen.queryByRole('button', {name: /Save .* Package/})
		).not.toBeInTheDocument();
		expect(saveFile).not.toHaveBeenCalled();
	});

	it('prepares an asset-free Package without the desktop reader', async () => {
		saveProjectMetadata('story-id', {
			status: 'local-only',
			storageKind: 'web-local'
		});
		renderComponent();

		fireEvent.click(await selectPackageForPreparation());

		expect(
			await screen.findByRole('region', {name: 'Package review'})
		).toBeInTheDocument();
		expect(
			screen.queryByText('Package export unavailable')
		).not.toBeInTheDocument();
		expect(screen.getByText('Complete in assessed scopes')).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Save Complete Package'})
		).toBeEnabled();
	});

	it('blocks an asset-free native Package without the desktop reader', async () => {
		saveProjectMetadata('story-id', {
			rootPath: '/project/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		renderComponent();

		fireEvent.click(screen.getByText('Package (.zip)'));

		expect(
			await screen.findByText('Package export unavailable')
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Prepare Package'})
		).toBeDisabled();
	});

	it('does not allow Inspect output to bypass active Core errors', async () => {
		const readProjectPackageAssetPayloads = jest
			.fn()
			.mockResolvedValue(packageAssetBatch());

		saveProjectMetadata('story-id', {
			rootPath: '/project/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {readProjectPackageAssetPayloads};
		renderComponent('Look north.', {missingStartPassage: true});

		fireEvent.click(screen.getByText('Package (.zip)'));
		await screen.findByText('1 story issue');

		const inspect = screen.getByRole('button', {name: 'Inspect output'});
		expect(
			screen.getByRole('button', {name: 'Prepare Package'})
		).toBeDisabled();
		expect(inspect).toBeDisabled();
		fireEvent.click(inspect);
		expect(readProjectPackageAssetPayloads).not.toHaveBeenCalled();
		expect(saveFile).not.toHaveBeenCalled();
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
					sha256: 'a'.repeat(64),
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
