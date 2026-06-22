import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {createMemoryHistory} from 'history';
import {axe} from 'jest-axe';
import * as React from 'react';
import {Router} from 'react-router-dom';
import {
	FakeStateProvider,
	fakeLoadedStoryFormat,
	fakeStory,
	StoryInspector
} from '../../../test-util';
import {NewProjectRoute} from '../new-project-route';

describe('<NewProjectRoute>', () => {
	function renderComponent(path = '/new-project') {
		const format = fakeLoadedStoryFormat(
			{name: 'Harlowe', version: '3.3.9'},
			{name: 'Harlowe', version: '3.3.9'}
		);
		const history = createMemoryHistory({initialEntries: [path]});
		const result = render(
			<Router history={history}>
				<FakeStateProvider
					prefs={{storyFormat: {name: 'Harlowe', version: '3.3.9'}}}
					stories={[]}
					storyFormats={[format]}
				>
					<NewProjectRoute />
					<StoryInspector />
				</FakeStateProvider>
			</Router>
		);

		return {...result, history};
	}

	afterEach(() => {
		delete (window as any).twineElectron;
	});

	it('creates a native project folder and a story with a named start passage', async () => {
		(window as any).twineElectron = {
			createProjectFolder: jest.fn(async story => ({
				rootPath: `/native/${story.name}.twine.rs`,
				stories: [story],
				storyIds: [story.id]
			})),
			getStoryLibraryFolder: jest.fn(async () => '/native/library')
		};
		const {container, history} = renderComponent();

		fireEvent.change(screen.getByLabelText('Project name'), {
			target: {value: 'Moon Castle'}
		});
		fireEvent.change(screen.getByLabelText('Start passage'), {
			target: {value: 'Opening'}
		});
		fireEvent.click(screen.getByRole('button', {name: /create project/i}));

		await waitFor(() =>
			expect(screen.getByTestId('story-inspector-default')).toHaveAttribute(
				'data-name',
				'Moon Castle'
			)
		);
		expect(
			(window as any).twineElectron.createProjectFolder
		).toHaveBeenCalled();
		expect(history.location.pathname).toMatch(/^\/stories\//);
		expect(
			container.querySelector('[data-name="Opening"]')
		).toBeInTheDocument();
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
		const {container, history} = renderComponent('/new-project/import');
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
		expect(history.location.pathname).toBe('/');
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

		const {history} = renderComponent('/new-project/import');

		fireEvent.click(screen.getByRole('button', {name: /open project folder/i}));

		await waitFor(() =>
			expect(screen.getByTestId('story-inspector-default')).toHaveAttribute(
				'data-name',
				'Native Story'
			)
		);
		expect(history.location.pathname).toBe('/');
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
