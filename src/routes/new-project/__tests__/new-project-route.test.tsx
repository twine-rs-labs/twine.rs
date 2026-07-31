import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {MemoryRouter, useNavigate} from 'react-router';
import {
	bootstrapStory,
	bootstrapStoryPerformanceDiagnostics,
	clearBootstrapStories,
	CoreProjectHost,
	knownAssetInventoryForStory,
	metadataStory,
	useCoreProjectHost
} from '../../../core';
import {Story} from '../../../store/stories';
import {
	loadProjectMetadata,
	saveProjectMetadata
} from '../../../store/project-metadata';
import {
	markProjectStoryHydration,
	projectStoryHydration
} from '../../../store/project-hydration';
import {
	FakeStateProvider,
	fakeLoadedStoryFormat,
	fakeStory,
	LocationInspector,
	StoryInspector
} from '../../../test-util';
import {NewProjectRoute} from '../new-project-route';
import {maxImportSourceBytes} from '../../../util/import-limits';

const HistoryBackButton: React.FC = () => {
	const navigate = useNavigate();

	return <button onClick={() => navigate(-1)}>History back</button>;
};

const CoreHostCapture: React.FC<{
	onHost?: (host: CoreProjectHost) => void;
}> = ({onHost}) => {
	const host = useCoreProjectHost();

	React.useLayoutEffect(() => onHost?.(host), [host, onHost]);
	return null;
};

describe('<NewProjectRoute>', () => {
	function renderComponent(
		path = '/new-project',
		initialEntries: string[] = [path],
		options: {
			coreProjectHost?: CoreProjectHost;
			onCoreProjectHost?: (host: CoreProjectHost) => void;
			stories?: Story[];
		} = {}
	) {
		const harloweFormat = fakeLoadedStoryFormat(
			{name: 'Harlowe', version: '3.3.9'},
			{name: 'Harlowe', version: '3.3.9'}
		);
		const sugarCubeFormat = fakeLoadedStoryFormat(
			{name: 'SugarCube', version: '2.37.3'},
			{name: 'SugarCube', version: '2.37.3'}
		);
		const sugarCubeLegacyFormat = fakeLoadedStoryFormat(
			{name: 'SugarCube', version: '2.35.0'},
			{name: 'SugarCube', version: '2.35.0'}
		);
		const result = render(
			<MemoryRouter initialEntries={initialEntries}>
				<FakeStateProvider
					coreProjectHost={options.coreProjectHost}
					prefs={{storyFormat: {name: 'Harlowe', version: '3.3.9'}}}
					stories={options.stories ?? []}
					storyFormats={[harloweFormat, sugarCubeFormat, sugarCubeLegacyFormat]}
				>
					<NewProjectRoute />
					<CoreHostCapture onHost={options.onCoreProjectHost} />
					<StoryInspector />
				</FakeStateProvider>
				<LocationInspector />
				<HistoryBackButton />
			</MemoryRouter>
		);

		return result;
	}

	afterEach(() => {
		clearBootstrapStories();
		delete (window as any).twineElectron;
		window.localStorage.clear();
	});

	it.each([
		{
			absentPreview: ['story.twee'],
			layout: 'passage-files',
			preview: [
				'passages/',
				'moon-castle-2026-bonus/',
				'0001-opening-scene-1.twee',
				'scripts/',
				'moon-castle-2026-bonus.js',
				'styles/',
				'moon-castle-2026-bonus.css'
			],
			selection: 'Multi (Recommended)'
		},
		{
			absentPreview: [
				'passages/',
				'moon-castle-2026-bonus/',
				'0001-opening-scene-1.twee'
			],
			layout: 'single-twee',
			preview: [
				'story.twee',
				'scripts/',
				'moon-castle-2026-bonus.js',
				'styles/',
				'moon-castle-2026-bonus.css'
			],
			selection: 'Single'
		}
	])(
		'creates a $layout project with matching preview and blank starter text',
		async ({absentPreview, layout, preview, selection}) => {
			const createProjectFolder = jest.fn(async story => ({
				rootPath: `/native/${story.name}.twine.rs`,
				stories: [story],
				storyIds: [story.id]
			}));

			(window as any).twineElectron = {
				createProjectFolder,
				getStoryLibraryFolder: jest.fn(async () => '/native/library')
			};
			const {container} = renderComponent();
			const sourceLayoutButton = screen.getByText(selection).closest('button');

			if (selection === 'Multi (Recommended)') {
				expect(sourceLayoutButton).toHaveAttribute('aria-selected', 'true');
			} else {
				fireEvent.click(sourceLayoutButton!);
			}

			fireEvent.change(screen.getByLabelText('Project name'), {
				target: {value: 'Moon.Castle_2026 + Bonus'}
			});
			fireEvent.change(screen.getByLabelText('Start passage'), {
				target: {value: 'Opening.Scene_1'}
			});

			expect(
				screen.getByText('moon-castle-2026-bonus.twine.rs/')
			).toBeInTheDocument();
			for (const label of preview) {
				expect(screen.getByText(label)).toBeInTheDocument();
			}
			for (const label of absentPreview) {
				expect(screen.queryByText(label)).not.toBeInTheDocument();
			}

			fireEvent.click(screen.getByRole('button', {name: /create project/i}));

			await waitFor(() =>
				expect(createProjectFolder).toHaveBeenCalledWith(
					expect.objectContaining({
						name: 'Moon.Castle_2026 + Bonus',
						passages: [
							expect.objectContaining({
								name: 'Opening.Scene_1',
								text: ''
							})
						]
					}),
					undefined,
					layout
				)
			);
			await waitFor(() =>
				expect(screen.getByTestId('story-inspector-default')).toHaveAttribute(
					'data-name',
					'Moon.Castle_2026 + Bonus'
				)
			);
			await waitFor(() =>
				expect(
					screen.getByTestId('location').getAttribute('data-pathname')
				).toMatch(/^\/stories\//)
			);
			expect(
				container.querySelector('[data-name="Opening.Scene_1"]')
			).toBeInTheDocument();
		}
	);

	it('previews canonical source slugs for long and reserved story names', () => {
		renderComponent();
		const longName = `___${'A'.repeat(80)}`;
		const truncatedSlug = 'a'.repeat(63);

		fireEvent.change(screen.getByLabelText('Project name'), {
			target: {value: longName}
		});
		fireEvent.change(screen.getByLabelText('Start passage'), {
			target: {value: 'Élan___Passage'}
		});

		expect(
			screen.getByDisplayValue(
				`~/Documents/Twine RS/Stories/${truncatedSlug}.twine.rs`
			)
		).toBeInTheDocument();
		expect(screen.getByText(`${truncatedSlug}/`)).toBeInTheDocument();
		expect(screen.getByText(`${truncatedSlug}.js`)).toBeInTheDocument();
		expect(screen.getByText('0001-lan-passage.twee')).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText('Project name'), {
			target: {value: 'Item'}
		});
		const folderPath = (
			screen.getByLabelText('Project folder') as HTMLInputElement
		).value;
		const reservedFallback = folderPath.match(
			/\/([a-f0-9-]+)\.twine\.rs$/
		)?.[1];

		expect(reservedFallback).toBeDefined();
		expect(screen.getByText(`${reservedFallback}/`)).toBeInTheDocument();
		expect(screen.getByText(`${reservedFallback}.css`)).toBeInTheDocument();
	});

	it('shows disk-only slug collisions without creating or navigating', async () => {
		const errorMessage = `A project named "A?B" already exists in this folder. Choose a different name.`;
		const createProjectFolder = jest.fn(async () => {
			throw new Error(
				"Error invoking remote method 'create-project-folder': Error: A new project cannot replace an existing filesystem entry."
			);
		});

		(window as any).twineElectron = {
			createProjectFolder,
			getStoryLibraryFolder: jest.fn(async () => '/native/library')
		};
		renderComponent();

		fireEvent.change(screen.getByLabelText('Project name'), {
			target: {value: 'A?B'}
		});
		fireEvent.click(screen.getByRole('button', {name: /create project/i}));

		await waitFor(() =>
			expect(createProjectFolder).toHaveBeenCalledWith(
				expect.objectContaining({name: 'A?B'}),
				undefined,
				'passage-files'
			)
		);
		expect(await screen.findByText(errorMessage)).toBeInTheDocument();
		expect(screen.getByTestId('location')).toHaveAttribute(
			'data-pathname',
			'/new-project'
		);
		expect(
			screen.queryByTestId('story-inspector-default')
		).not.toBeInTheDocument();
	});

	it.each([
		'EPERM: operation not permitted',
		'Permission denied (os error 13)',
		'Operation not permitted (os error 1)',
		'Access is denied. (os error 5)'
	])('shows a focused project-folder permission error for %s', async detail => {
		const createProjectFolder = jest.fn(async () => {
			throw new Error(
				`Error invoking remote method 'create-project-folder': Error: ${detail}`
			);
		});

		(window as any).twineElectron = {
			createProjectFolder,
			getStoryLibraryFolder: jest.fn(async () => '/native/library')
		};
		renderComponent();

		fireEvent.click(screen.getByRole('button', {name: /create project/i}));

		expect(
			await screen.findByText(
				'Twine could not access the project folder. Check its permissions or choose a different project folder.'
			)
		).toBeInTheDocument();
	});

	it('does not classify a duplicate story named EPERM as a permission error', async () => {
		const createProjectFolder = jest.fn();

		(window as any).twineElectron = {
			createProjectFolder,
			getStoryLibraryFolder: jest.fn(async () => '/native/library')
		};
		renderComponent('/new-project', ['/new-project'], {
			stories: [{...fakeStory(1), name: 'EPERM'}]
		});

		fireEvent.change(screen.getByLabelText('Project name'), {
			target: {value: 'EPERM'}
		});
		fireEvent.click(screen.getByRole('button', {name: /create project/i}));

		expect(
			await screen.findByText('There is already a story named "EPERM"')
		).toBeInTheDocument();
		expect(createProjectFolder).not.toHaveBeenCalled();
	});

	it('renders the import workspace for /new-project/import', () => {
		renderComponent('/new-project/import');

		expect(
			screen.getByRole('button', {name: /choose file/i})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /open project folder/i})
		).toBeInTheDocument();
		expect(screen.getByLabelText('Source file')).toHaveAttribute(
			'accept',
			'.html,.htm,.twee,.tw,.zip'
		);
	});

	it('replaces the current history entry when changing workspace tabs', async () => {
		renderComponent('/new-project', ['/before', '/new-project']);

		fireEvent.click(screen.getByRole('tab', {name: 'Import'}));
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/new-project/import'
			)
		);

		fireEvent.click(screen.getByRole('button', {name: 'History back'}));
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/before'
			)
		);
	});

	it('imports a dropped zip through the native importer and copies prepared assets', async () => {
		(window as any).twineElectron = {
			copyProjectImportAssets: jest.fn(async () => []),
			createProjectFolder: jest.fn(async story => ({
				rootPath: `/native/${story.name}.twine.rs`,
				stories: [story],
				storyIds: [story.id]
			})),
			discardProjectImport: jest.fn(async () => undefined),
			filePathForFile: jest.fn(() => '/imports/Transylvania.zip'),
			prepareProjectImport: jest.fn(async () => ({
				assets: [
					{
						originalPath: 'audio/theme.mp3',
						sourcePath: '/tmp/import/audio/theme.mp3',
						targetPath: 'assets/audio/theme.mp3'
					}
				],
				htmlFilePath: '/tmp/import/Transylvania.html',
				htmlSource: `
					<tw-storydata name="Zip Story" startnode="1" format="SugarCube" format-version="2.37.0" ifid="ZIP-STORY" hidden>
						<tw-passagedata pid="1" name="Start" position="10,20" size="140,100">assets/audio/theme.mp3</tw-passagedata>
					</tw-storydata>
				`,
				id: 'import-1',
				sourceKind: 'zip',
				sourcePath: '/imports/Transylvania.zip'
			}))
		};
		const zipFile = new File(['zip'], 'Transylvania.zip', {
			type: 'application/zip'
		});
		const {container} = renderComponent('/new-project/import');
		const importScreen = container.querySelector('.new-project-route__import');

		fireEvent.drop(importScreen!, {
			dataTransfer: {dropEffect: 'copy', files: [zipFile]}
		});

		await screen.findByText('Zip Story');
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));

		await waitFor(() =>
			expect(
				(window as any).twineElectron.copyProjectImportAssets
			).toHaveBeenCalledWith('import-1', '/native/Zip Story.twine.rs')
		);
		expect(
			(window as any).twineElectron.prepareProjectImport
		).toHaveBeenCalledWith('/imports/Transylvania.zip');
		expect(
			(window as any).twineElectron.createProjectFolder
		).toHaveBeenCalledWith(
			expect.objectContaining({
				name: 'Zip Story',
				passages: [
					expect.objectContaining({
						left: 10,
						text: 'assets/audio/theme.mp3',
						top: 20
					})
				]
			}),
			undefined
		);
		expect(
			(window as any).twineElectron.discardProjectImport
		).toHaveBeenCalledWith('import-1');
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/'
			)
		);
	});

	it('rejects oversized browser imports before reading or parsing them', async () => {
		const prepareProjectImport = jest.fn();

		(window as any).twineElectron = {
			filePathForFile: jest.fn(() => '/imports/oversized.html'),
			prepareProjectImport
		};
		const source = new File(['small'], 'oversized.html', {type: 'text/html'});

		Object.defineProperty(source, 'size', {
			value: maxImportSourceBytes + 1
		});
		renderComponent('/new-project/import');
		fireEvent.change(screen.getByLabelText('Source file'), {
			target: {files: [source]}
		});

		expect(
			await screen.findByText('Import source exceeds the 50 MiB limit.')
		).toBeInTheDocument();
		expect(prepareProjectImport).not.toHaveBeenCalled();
	});

	it('repairs a SugarCube zip before writing the imported project folder', async () => {
		(window as any).twineElectron = {
			copyProjectImportAssets: jest.fn(async () => []),
			createProjectFolder: jest.fn(async story => ({
				rootPath: `/native/${story.name}.twine.rs`,
				stories: [story],
				storyIds: [story.id]
			})),
			discardProjectImport: jest.fn(async () => undefined),
			filePathForFile: jest.fn(() => '/imports/Trigaea.zip'),
			prepareProjectImport: jest.fn(async () => ({
				assets: [],
				htmlFilePath: '/tmp/import/Trigaea.html',
				htmlSource: `
					<tw-storydata name="Trigaea" startnode="1" format="Harlowe" format-version="3.3.9" ifid="TRIGAEA" hidden>
						<tw-passagedata pid="1" name="Start">&lt;&lt;set $visited to true&gt;&gt;</tw-passagedata>
					</tw-storydata>
				`,
				id: 'import-1',
				sourceKind: 'zip',
				sourcePath: '/imports/Trigaea.zip'
			}))
		};
		const zipFile = new File(['zip'], 'Trigaea.zip', {
			type: 'application/zip'
		});
		const {container} = renderComponent('/new-project/import');
		const importScreen = container.querySelector('.new-project-route__import');

		fireEvent.drop(importScreen!, {
			dataTransfer: {dropEffect: 'copy', files: [zipFile]}
		});

		await screen.findByText('Trigaea');
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));

		await waitFor(() =>
			expect(
				(window as any).twineElectron.createProjectFolder
			).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'Trigaea',
					storyFormat: 'SugarCube',
					storyFormatVersion: '2.37.3'
				}),
				undefined
			)
		);
	});

	it('preserves a matching SugarCube local/offline import version', async () => {
		(window as any).twineElectron = {
			copyProjectImportAssets: jest.fn(async () => []),
			createProjectFolder: jest.fn(async story => ({
				rootPath: `/native/${story.name}.twine.rs`,
				stories: [story],
				storyIds: [story.id]
			})),
			discardProjectImport: jest.fn(async () => undefined),
			filePathForFile: jest.fn(() => '/imports/Trigaea.zip'),
			prepareProjectImport: jest.fn(async () => ({
				assets: [],
				htmlFilePath: '/tmp/import/Trigaea.html',
				htmlSource: `
					<tw-storydata name="Trigaea" startnode="1" format="SugarCube 2 (local/offline)" format-version="2.35.0" ifid="TRIGAEA" hidden>
						<tw-passagedata pid="1" name="Start">Welcome.</tw-passagedata>
					</tw-storydata>
				`,
				id: 'import-1',
				sourceKind: 'zip',
				sourcePath: '/imports/Trigaea.zip'
			}))
		};
		const zipFile = new File(['zip'], 'Trigaea.zip', {
			type: 'application/zip'
		});
		const {container} = renderComponent('/new-project/import');
		const importScreen = container.querySelector('.new-project-route__import');

		fireEvent.drop(importScreen!, {
			dataTransfer: {dropEffect: 'copy', files: [zipFile]}
		});

		await screen.findByText('Trigaea');
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));

		await waitFor(() =>
			expect(
				(window as any).twineElectron.createProjectFolder
			).toHaveBeenCalledWith(
				expect.objectContaining({
					name: 'Trigaea',
					storyFormat: 'SugarCube',
					storyFormatVersion: '2.35.0'
				}),
				undefined
			)
		);
	});

	it('does not register new documents when a mixed replacement fails', async () => {
		const existingStory = fakeStory(1);
		const applyStoryCommand = jest.fn(async command => {
			expect(bootstrapStory(existingStory.id)).toEqual(
				expect.objectContaining({
					passages: [
						expect.objectContaining({text: existingStory.passages[0].text})
					]
				})
			);
			expect(command).toEqual(
				expect.objectContaining({
					story: expect.objectContaining({
						passages: [expect.objectContaining({text: 'replacement body'})]
					})
				})
			);
			throw new Error('replacement failed');
		});

		existingStory.name = 'Existing import target';
		renderComponent('/new-project/import', undefined, {
			coreProjectHost: {
				applyStoryCommand
			} as unknown as CoreProjectHost,
			stories: [existingStory]
		});
		const source = new File(
			[
				'<tw-storydata name="Fresh imported story" startnode="1" ifid="FRESH">',
				'<tw-passagedata pid="1" name="Start">fresh body</tw-passagedata>',
				'</tw-storydata>',
				'<tw-storydata name="Existing import target" startnode="1" ifid="REPLACEMENT">',
				'<tw-passagedata pid="1" name="Start">replacement body</tw-passagedata>',
				'</tw-storydata>'
			],
			'mixed.html',
			{type: 'text/html'}
		);

		fireEvent.change(screen.getByLabelText('Source file'), {
			target: {files: [source]}
		});
		await screen.findByText('Fresh imported story');
		const conflictRow = screen
			.getByText('Existing import target', {exact: true})
			.closest('tr');

		fireEvent.click(conflictRow!.querySelector('input[type="checkbox"]')!);
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));

		expect(await screen.findByText('replacement failed')).toBeInTheDocument();
		expect(applyStoryCommand).toHaveBeenCalled();
		expect(bootstrapStoryPerformanceDiagnostics().storyCount).toBe(0);
		expect(screen.getByTestId('location')).toHaveAttribute(
			'data-pathname',
			'/new-project/import'
		);
	});

	it('keeps shell hydration pending when another replacement materialization fails', async () => {
		const firstDocuments = {
			...fakeStory(1),
			name: 'First shell replacement'
		};
		const secondDocuments = {
			...fakeStory(1),
			name: 'Second shell replacement'
		};
		const firstRoot = '/native/first-shell.twine.rs';
		const secondRoot = '/native/second-shell.twine.rs';
		let rejectSecondHydration: (error: Error) => void = () => undefined;
		const secondHydration = new Promise<never>((_resolve, reject) => {
			rejectSecondHydration = reject;
		});
		const hydrateProjectFolder = jest.fn((rootPath: string) => {
			if (rootPath === firstRoot) {
				return Promise.resolve({
					passageTextLoaded: true,
					rootPath,
					stories: [firstDocuments],
					storyIds: [firstDocuments.id]
				});
			}

			return secondHydration;
		});

		for (const [story, rootPath] of [
			[firstDocuments, firstRoot],
			[secondDocuments, secondRoot]
		] as const) {
			saveProjectMetadata(story.id, {
				rootPath,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
			markProjectStoryHydration(story.id, {
				passageTextLoaded: false,
				rootPath
			});
		}
		(window as any).twineElectron = {hydrateProjectFolder};
		renderComponent('/new-project/import', undefined, {
			stories: [metadataStory(firstDocuments), metadataStory(secondDocuments)]
		});
		const source = new File(
			[
				`<tw-storydata name="${firstDocuments.name}" startnode="1" ifid="FIRST">`,
				'<tw-passagedata pid="1" name="Start">first replacement</tw-passagedata>',
				'</tw-storydata>',
				`<tw-storydata name="${secondDocuments.name}" startnode="1" ifid="SECOND">`,
				'<tw-passagedata pid="1" name="Start">second replacement</tw-passagedata>',
				'</tw-storydata>'
			],
			'replacements.html',
			{type: 'text/html'}
		);

		fireEvent.change(screen.getByLabelText('Source file'), {
			target: {files: [source]}
		});
		for (const story of [firstDocuments, secondDocuments]) {
			await screen.findByText(story.name, {exact: true});
			const row = screen.getByText(story.name, {exact: true}).closest('tr');

			fireEvent.click(row!.querySelector('input[type="checkbox"]')!);
		}
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));
		await waitFor(() => expect(hydrateProjectFolder).toHaveBeenCalledTimes(2));
		await act(async () => {
			await Promise.resolve();
			rejectSecondHydration(new Error('second hydration failed'));
			await Promise.resolve();
		});

		expect(
			await screen.findByText('second hydration failed')
		).toBeInTheDocument();
		expect(projectStoryHydration(firstDocuments.id)).toEqual(
			expect.objectContaining({
				passageTextLoaded: false,
				rootPath: firstRoot
			})
		);
		expect(bootstrapStory(firstDocuments.id)).toBeUndefined();
	});

	it('restores shell hydration when replacement fails after session setup', async () => {
		const currentDocuments = {
			...fakeStory(1),
			name: 'Hydrated replacement target'
		};
		const oldRoot = '/native/current-target.twine.rs';
		const newRoot = '/native/replacement-target.twine.rs';
		const applyStoryCommand = jest.fn(async () => {
			throw new Error('replacement command failed');
		});
		const ensureSessionReady = jest.fn(async () => undefined);
		const deleteProjectFolder = jest.fn(async () => undefined);

		saveProjectMetadata(currentDocuments.id, {
			rootPath: oldRoot,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(currentDocuments.id, {
			passageTextLoaded: false,
			rootPath: oldRoot
		});
		(window as any).twineElectron = {
			createProjectFolder: jest.fn(async story => ({
				rootPath: newRoot,
				stories: [story],
				storyIds: [story.id]
			})),
			deleteProjectFolder,
			hydrateProjectFolder: jest.fn(async () => ({
				passageTextLoaded: true,
				rootPath: oldRoot,
				stories: [currentDocuments],
				storyIds: [currentDocuments.id]
			})),
			listProjectAssets: jest.fn(async () => [])
		};
		renderComponent('/new-project/import', undefined, {
			coreProjectHost: {
				applyStoryCommand,
				ensureSessionReady
			} as unknown as CoreProjectHost,
			stories: [metadataStory(currentDocuments)]
		});
		const source = new File(
			[
				`<tw-storydata name="${currentDocuments.name}" startnode="1" ifid="REPLACEMENT">`,
				'<tw-passagedata pid="1" name="Start">replacement body</tw-passagedata>',
				'</tw-storydata>'
			],
			'replacement.html',
			{type: 'text/html'}
		);

		fireEvent.change(screen.getByLabelText('Source file'), {
			target: {files: [source]}
		});
		await screen.findByText(currentDocuments.name, {exact: true});
		const row = screen
			.getByText(currentDocuments.name, {exact: true})
			.closest('tr');

		fireEvent.click(row!.querySelector('input[type="checkbox"]')!);
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));

		expect(
			await screen.findByText('replacement command failed')
		).toBeInTheDocument();
		expect(ensureSessionReady).toHaveBeenCalledWith(currentDocuments.id);
		expect(applyStoryCommand).toHaveBeenCalled();
		expect(deleteProjectFolder).not.toHaveBeenCalled();
		expect(projectStoryHydration(currentDocuments.id)).toEqual(
			expect.objectContaining({
				passageTextLoaded: false,
				rootPath: newRoot
			})
		);
		expect(bootstrapStory(currentDocuments.id)).toBeUndefined();
	});

	it('deletes only replacement roots that have not been committed', async () => {
		const firstStory = {
			...fakeStory(1),
			name: 'Committed replacement'
		};
		const secondStory = {
			...fakeStory(1),
			name: 'Uncommitted replacement'
		};
		const firstRoot = '/native/committed-replacement.twine.rs';
		const secondRoot = '/native/uncommitted-replacement.twine.rs';
		const deleteProjectFolder = jest.fn(async () => undefined);
		const applyStoryCommand = jest.fn(async () => undefined);
		const ensureSessionReady = jest.fn(async (storyId: string) => {
			if (storyId === firstStory.id) {
				throw new Error('first replacement session failed');
			}
		});

		for (const story of [firstStory, secondStory]) {
			saveProjectMetadata(story.id, {
				status: 'local-only',
				storageKind: 'web-local'
			});
		}
		(window as any).twineElectron = {
			createProjectFolder: jest.fn(async story => ({
				rootPath: story.id === firstStory.id ? firstRoot : secondRoot,
				stories: [story],
				storyIds: [story.id]
			})),
			deleteProjectFolder,
			listProjectAssets: jest.fn(async () => [])
		};
		renderComponent('/new-project/import', undefined, {
			coreProjectHost: {
				applyStoryCommand,
				ensureSessionReady
			} as unknown as CoreProjectHost,
			stories: [firstStory, secondStory]
		});
		const source = new File(
			[
				`<tw-storydata name="${firstStory.name}" startnode="1" ifid="FIRST">`,
				'<tw-passagedata pid="1" name="Start">first body</tw-passagedata>',
				'</tw-storydata>',
				`<tw-storydata name="${secondStory.name}" startnode="1" ifid="SECOND">`,
				'<tw-passagedata pid="1" name="Start">second body</tw-passagedata>',
				'</tw-storydata>'
			],
			'replacements.html',
			{type: 'text/html'}
		);

		fireEvent.change(screen.getByLabelText('Source file'), {
			target: {files: [source]}
		});
		for (const story of [firstStory, secondStory]) {
			await screen.findByText(story.name, {exact: true});
			const row = screen.getByText(story.name, {exact: true}).closest('tr');

			fireEvent.click(row!.querySelector('input[type="checkbox"]')!);
		}
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));

		expect(
			await screen.findByText('first replacement session failed')
		).toBeInTheDocument();
		await waitFor(() =>
			expect(deleteProjectFolder).toHaveBeenCalledWith(secondRoot)
		);
		expect(deleteProjectFolder).toHaveBeenCalledTimes(1);
		expect(deleteProjectFolder).not.toHaveBeenCalledWith(firstRoot);
		expect(ensureSessionReady).toHaveBeenCalledTimes(1);
		expect(applyStoryCommand).not.toHaveBeenCalled();
		expect(loadProjectMetadata(firstStory.id)?.rootPath).toBe(firstRoot);
		expect(loadProjectMetadata(secondStory.id)).toEqual(
			expect.objectContaining({
				status: 'local-only',
				storageKind: 'web-local'
			})
		);
	});

	it('ignores a second import run while replacement materialization starts', async () => {
		const existingStory = fakeStory(1);
		const applyStoryCommand = jest.fn(async () => undefined);

		existingStory.name = 'Existing import target';
		renderComponent('/new-project/import', undefined, {
			coreProjectHost: {
				applyStoryCommand
			} as unknown as CoreProjectHost,
			stories: [existingStory]
		});
		const source = new File(
			[
				'<tw-storydata name="Existing import target" startnode="1" ifid="REPLACEMENT">',
				'<tw-passagedata pid="1" name="Start">replacement body</tw-passagedata>',
				'</tw-storydata>'
			],
			'replacement.html',
			{type: 'text/html'}
		);

		fireEvent.change(screen.getByLabelText('Source file'), {
			target: {files: [source]}
		});
		await screen.findByText('Existing import target', {exact: true});
		const conflictRow = screen
			.getByText('Existing import target', {exact: true})
			.closest('tr');

		fireEvent.click(conflictRow!.querySelector('input[type="checkbox"]')!);
		const runImport = screen.getByRole('button', {name: /run import/i});

		await act(async () => {
			fireEvent.click(runImport);
			fireEvent.click(runImport);
			await Promise.resolve();
		});

		await waitFor(() => expect(applyStoryCommand).toHaveBeenCalledTimes(1));
	});

	it('refreshes replacement asset inventory after copying archive assets', async () => {
		const existingStory = fakeStory(1);
		const newRoot = '/native/rebound-import.twine.rs';
		const importedAsset = {
			normalizedPath: 'assets/image.png',
			path: 'assets/image.png'
		};
		const copyProjectImportAssets = jest.fn(async () => []);
		const listProjectAssets = jest.fn(async () => {
			expect(copyProjectImportAssets).toHaveBeenCalledWith(
				'import-success',
				newRoot
			);
			return [importedAsset];
		});
		const applyStoryCommand = jest.fn(async () => undefined);
		const ensureSessionReady = jest.fn(async () => {
			expect(listProjectAssets).toHaveBeenCalledWith(newRoot);
			expect(knownAssetInventoryForStory(existingStory.id)).toEqual([
				importedAsset
			]);
		});

		existingStory.name = 'Existing import target';
		saveProjectMetadata(existingStory.id, {
			status: 'local-only',
			storageKind: 'web-local'
		});
		(window as any).twineElectron = {
			copyProjectImportAssets,
			createProjectFolder: jest.fn(async story => ({
				rootPath: newRoot,
				stories: [story],
				storyIds: [story.id]
			})),
			discardProjectImport: jest.fn(async () => undefined),
			filePathForFile: jest.fn(() => '/imports/replacement.zip'),
			getStoryLibraryFolder: jest.fn(async () => '/native/library'),
			listProjectAssets,
			prepareProjectImport: jest.fn(async () => ({
				assets: [
					{
						originalPath: 'image.png',
						sourcePath: '/tmp/import/image.png',
						targetPath: 'assets/image.png'
					}
				],
				htmlFilePath: '/tmp/import/replacement.html',
				htmlSource: `
					<tw-storydata name="Existing import target" startnode="1" format="Harlowe" format-version="3.3.9" ifid="REPLACEMENT" hidden>
						<tw-passagedata pid="1" name="Start">replacement body</tw-passagedata>
					</tw-storydata>
				`,
				id: 'import-success',
				sourceKind: 'zip',
				sourcePath: '/imports/replacement.zip'
			}))
		};
		const zipFile = new File(['zip'], 'replacement.zip', {
			type: 'application/zip'
		});
		const {container} = renderComponent('/new-project/import', undefined, {
			coreProjectHost: {
				applyStoryCommand,
				ensureSessionReady
			} as unknown as CoreProjectHost,
			stories: [existingStory]
		});

		fireEvent.drop(container.querySelector('.new-project-route__import')!, {
			dataTransfer: {dropEffect: 'copy', files: [zipFile]}
		});
		await screen.findByText('Existing import target', {exact: true});
		const conflictRow = screen
			.getByText('Existing import target', {exact: true})
			.closest('tr');

		fireEvent.click(conflictRow!.querySelector('input[type="checkbox"]')!);
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));

		await waitFor(() =>
			expect(listProjectAssets).toHaveBeenCalledWith(newRoot)
		);
		expect(ensureSessionReady).toHaveBeenCalledWith(existingStory.id);
		expect(knownAssetInventoryForStory(existingStory.id)).toEqual([
			importedAsset
		]);
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/'
			)
		);
	});

	it.each(['copy', 'inventory'] as const)(
		'keeps the current story usable when replacement asset %s fails',
		async failureStage => {
			const existingStory = fakeStory(1);
			const newRoot = '/native/rebound-import.twine.rs';
			let capturedHost: CoreProjectHost | undefined;
			const failureMessage = `asset ${failureStage} failed`;
			const deleteProjectFolder = jest.fn(async () => undefined);

			existingStory.name = 'Existing import target';
			saveProjectMetadata(existingStory.id, {
				status: 'local-only',
				storageKind: 'web-local'
			});
			(window as any).twineElectron = {
				copyProjectImportAssets: jest.fn(async () => {
					if (failureStage === 'copy') {
						throw new Error(failureMessage);
					}
					return [];
				}),
				createProjectFolder: jest.fn(async story => {
					expect(story.passages).toEqual([
						expect.objectContaining({
							id: existingStory.passages[0].id,
							text: existingStory.passages[0].text
						})
					]);
					return {rootPath: newRoot, stories: [story], storyIds: [story.id]};
				}),
				deleteProjectFolder,
				discardProjectImport: jest.fn(async () => undefined),
				filePathForFile: jest.fn(() => '/imports/replacement.zip'),
				getStoryLibraryFolder: jest.fn(async () => '/native/library'),
				listProjectAssets: jest.fn(async () => {
					if (failureStage === 'inventory') {
						throw new Error(failureMessage);
					}
					return [];
				}),
				prepareProjectImport: jest.fn(async () => ({
					assets: [
						{
							originalPath: 'image.png',
							sourcePath: '/tmp/import/image.png',
							targetPath: 'assets/image.png'
						}
					],
					htmlFilePath: '/tmp/import/replacement.html',
					htmlSource: `
					<tw-storydata name="Existing import target" startnode="1" format="Harlowe" format-version="3.3.9" ifid="REPLACEMENT" hidden>
						<tw-passagedata pid="1" name="Start">replacement body</tw-passagedata>
					</tw-storydata>
				`,
					id: 'import-failure',
					sourceKind: 'zip',
					sourcePath: '/imports/replacement.zip'
				}))
			};
			const zipFile = new File(['zip'], 'replacement.zip', {
				type: 'application/zip'
			});
			const {container} = renderComponent('/new-project/import', undefined, {
				onCoreProjectHost: host => {
					capturedHost = host;
				},
				stories: [existingStory]
			});

			fireEvent.drop(container.querySelector('.new-project-route__import')!, {
				dataTransfer: {dropEffect: 'copy', files: [zipFile]}
			});
			await screen.findByText('Existing import target', {exact: true});
			const conflictRow = screen
				.getByText('Existing import target', {exact: true})
				.closest('tr');

			fireEvent.click(conflictRow!.querySelector('input[type="checkbox"]')!);
			fireEvent.click(screen.getByRole('button', {name: /run import/i}));

			expect(await screen.findByText(failureMessage)).toBeInTheDocument();
			await waitFor(() =>
				expect(deleteProjectFolder).toHaveBeenCalledWith(newRoot)
			);
			expect(deleteProjectFolder).toHaveBeenCalledTimes(1);
			expect(loadProjectMetadata(existingStory.id)).toEqual(
				expect.objectContaining({
					status: 'local-only',
					storageKind: 'web-local'
				})
			);
			if (failureStage === 'inventory') {
				expect(
					(window as any).twineElectron.listProjectAssets
				).toHaveBeenCalledWith(newRoot);
			} else {
				expect(
					(window as any).twineElectron.listProjectAssets
				).not.toHaveBeenCalled();
			}
			expect(bootstrapStory(existingStory.id)).toBeUndefined();
			expect(
				screen.getByTestId(`passage-${existingStory.passages[0].id}`)
			).toBeInTheDocument();
			await expect(
				capturedHost!.queryDocumentPageAsync(existingStory.id, {limit: 10})
			).resolves.toEqual(
				expect.objectContaining({
					documents: expect.arrayContaining([
						expect.objectContaining({
							kind: 'passage',
							text: existingStory.passages[0].text
						})
					])
				})
			);
		}
	);

	it('removes an uncommitted replacement folder before a same-name retry', async () => {
		const existingStory = fakeStory(1);
		const newRoot = '/native/retry-target.twine.rs';
		const operationOrder: string[] = [];
		let folderExists = false;
		let inventoryAttempts = 0;
		let finishDeletion: () => void = () => undefined;
		const deletion = new Promise<void>(resolve => {
			finishDeletion = resolve;
		});
		const createProjectFolder = jest.fn(async story => {
			operationOrder.push('create');
			if (folderExists) {
				throw Object.assign(new Error('project folder already exists'), {
					code: 'EEXIST'
				});
			}
			folderExists = true;
			return {rootPath: newRoot, stories: [story], storyIds: [story.id]};
		});
		const deleteProjectFolder = jest.fn(async (rootPath: string) => {
			expect(rootPath).toBe(newRoot);
			operationOrder.push('delete-start');
			await deletion;
			operationOrder.push('delete');
			folderExists = false;
		});
		const listProjectAssets = jest.fn(async () => {
			operationOrder.push('inventory');
			inventoryAttempts += 1;
			if (inventoryAttempts === 1) {
				throw new Error('first inventory failed');
			}
			return [];
		});

		existingStory.name = 'Retry import target';
		saveProjectMetadata(existingStory.id, {
			status: 'local-only',
			storageKind: 'web-local'
		});
		(window as any).twineElectron = {
			createProjectFolder,
			deleteProjectFolder,
			listProjectAssets
		};
		renderComponent('/new-project/import', undefined, {
			coreProjectHost: {
				applyStoryCommand: jest.fn(async () => undefined),
				ensureSessionReady: jest.fn(async () => undefined)
			} as unknown as CoreProjectHost,
			stories: [existingStory]
		});
		const source = new File(
			[
				`<tw-storydata name="${existingStory.name}" startnode="1" ifid="RETRY">`,
				'<tw-passagedata pid="1" name="Start">replacement body</tw-passagedata>',
				'</tw-storydata>'
			],
			'retry.html',
			{type: 'text/html'}
		);

		fireEvent.change(screen.getByLabelText('Source file'), {
			target: {files: [source]}
		});
		await screen.findByText(existingStory.name, {exact: true});
		const row = screen
			.getByText(existingStory.name, {exact: true})
			.closest('tr');
		const runImportButton = screen.getByRole('button', {name: /run import/i});

		fireEvent.click(row!.querySelector('input[type="checkbox"]')!);
		fireEvent.click(runImportButton);

		expect(
			await screen.findByText('first inventory failed')
		).toBeInTheDocument();
		await waitFor(() => expect(deleteProjectFolder).toHaveBeenCalledTimes(1));
		expect(runImportButton).toBeDisabled();
		await act(async () => {
			finishDeletion();
			await deletion;
		});
		await waitFor(() => expect(runImportButton).not.toBeDisabled());

		fireEvent.click(runImportButton);

		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/'
			)
		);
		expect(createProjectFolder).toHaveBeenCalledTimes(2);
		expect(deleteProjectFolder).toHaveBeenCalledTimes(1);
		expect(operationOrder).toEqual([
			'create',
			'inventory',
			'delete-start',
			'delete',
			'create',
			'inventory'
		]);
		expect(folderExists).toBe(true);
		expect(loadProjectMetadata(existingStory.id)?.rootPath).toBe(newRoot);
	});

	it('reports an uncommitted replacement folder that cleanup cannot remove', async () => {
		const existingStory = fakeStory(1);
		const newRoot = '/native/stranded-replacement.twine.rs';
		const deleteProjectFolder = jest.fn(async () => {
			throw new Error('trash unavailable');
		});

		existingStory.name = 'Stranded import target';
		saveProjectMetadata(existingStory.id, {
			status: 'local-only',
			storageKind: 'web-local'
		});
		(window as any).twineElectron = {
			createProjectFolder: jest.fn(async story => ({
				rootPath: newRoot,
				stories: [story],
				storyIds: [story.id]
			})),
			deleteProjectFolder,
			listProjectAssets: jest.fn(async () => {
				throw new Error('inventory failed');
			})
		};
		renderComponent('/new-project/import', undefined, {
			stories: [existingStory]
		});
		const source = new File(
			[
				`<tw-storydata name="${existingStory.name}" startnode="1" ifid="STRANDED">`,
				'<tw-passagedata pid="1" name="Start">replacement body</tw-passagedata>',
				'</tw-storydata>'
			],
			'stranded.html',
			{type: 'text/html'}
		);

		fireEvent.change(screen.getByLabelText('Source file'), {
			target: {files: [source]}
		});
		await screen.findByText(existingStory.name, {exact: true});
		const row = screen
			.getByText(existingStory.name, {exact: true})
			.closest('tr');

		fireEvent.click(row!.querySelector('input[type="checkbox"]')!);
		fireEvent.click(screen.getByRole('button', {name: /run import/i}));

		await waitFor(() => {
			const error = screen.getByText(/inventory failed/);

			expect(error).toHaveTextContent(newRoot);
			expect(error).toHaveTextContent('trash unavailable');
		});
		expect(deleteProjectFolder).toHaveBeenCalledWith(newRoot);
		expect(loadProjectMetadata(existingStory.id)).toEqual(
			expect.objectContaining({
				status: 'local-only',
				storageKind: 'web-local'
			})
		);
	});

	it('opens native project folders from the import workspace', async () => {
		const story = {
			...fakeStory(1),
			id: 'native-story',
			name: 'Native Story',
			storyFormat: 'Harlowe',
			storyFormatVersion: '3.3.9'
		};

		(window as any).twineElectron = {
			openProjectFolder: jest.fn(async () => ({
				rootPath: '/native/Native Story.twine.rs',
				stories: [story],
				storyIds: [story.id]
			}))
		};

		renderComponent('/new-project/import');

		fireEvent.click(screen.getByRole('button', {name: /open project folder/i}));

		await waitFor(() =>
			expect(screen.getByTestId('story-inspector-default')).toHaveAttribute(
				'data-name',
				'Native Story'
			)
		);
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/'
			)
		);
	});

	it('shows progress while opening native project folders', async () => {
		const story = {
			...fakeStory(1),
			id: 'native-story',
			name: 'Native Story',
			storyFormat: 'Harlowe',
			storyFormatVersion: '3.3.9'
		};
		let resolveOpen: (value: any) => void = () => undefined;

		(window as any).twineElectron = {
			openProjectFolder: jest.fn(
				() =>
					new Promise(resolve => {
						resolveOpen = resolve;
					})
			)
		};

		renderComponent('/new-project/import');
		fireEvent.click(screen.getByRole('button', {name: /open project folder/i}));

		expect(
			screen.getByRole('progressbar', {name: /opening story/i})
		).toHaveTextContent('Opening project folder');

		await waitFor(() =>
			expect((window as any).twineElectron.openProjectFolder).toHaveBeenCalled()
		);

		resolveOpen({
			rootPath: '/native/Native Story.twine.rs',
			stories: [story],
			storyIds: [story.id]
		});

		await waitFor(() =>
			expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
		);
	});

	it('defers native project folder passage body hydration after shell open', async () => {
		const shellStory = {
			...fakeStory(1),
			id: 'native-story',
			name: 'Native Story',
			passages: [
				{
					...fakeStory(1).passages[0],
					id: 'start',
					name: 'Start',
					story: 'native-story',
					text: ''
				}
			],
			startPassage: 'start',
			storyFormat: 'Harlowe',
			storyFormatVersion: '3.3.9'
		};
		(window as any).twineElectron = {
			hydrateProjectFolder: jest.fn(),
			openProjectFolder: jest.fn(async () => ({
				passageTextLoaded: false,
				rootPath: '/native/Native Story.twine.rs',
				stories: [shellStory],
				storyIds: [shellStory.id]
			}))
		};

		renderComponent('/new-project/import');

		fireEvent.click(screen.getByRole('button', {name: /open project folder/i}));

		await waitFor(() =>
			expect(screen.getByTestId('story-inspector-default')).toHaveAttribute(
				'data-name',
				'Native Story'
			)
		);
		expect(
			(window as any).twineElectron.hydrateProjectFolder
		).not.toHaveBeenCalled();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
