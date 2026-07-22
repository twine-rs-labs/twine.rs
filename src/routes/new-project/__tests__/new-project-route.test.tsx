import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {MemoryRouter, useNavigate} from 'react-router';
import {
	bootstrapStoryPerformanceDiagnostics,
	clearBootstrapStories,
	CoreProjectHost
} from '../../../core';
import {Story} from '../../../store/stories';
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

describe('<NewProjectRoute>', () => {
	function renderComponent(
		path = '/new-project',
		initialEntries: string[] = [path],
		options: {coreProjectHost?: CoreProjectHost; stories?: Story[]} = {}
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
		const errorMessage =
			'A new project cannot replace an existing filesystem entry.';
		const createProjectFolder = jest.fn(async () => {
			throw new Error(errorMessage);
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
		const applyStoryCommand = jest
			.fn()
			.mockRejectedValue(new Error('replacement failed'));

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
		expect(screen.getByTestId('location')).toHaveAttribute(
			'data-pathname',
			'/'
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
