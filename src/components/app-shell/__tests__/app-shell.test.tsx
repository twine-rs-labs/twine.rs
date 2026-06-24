import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter} from 'react-router-dom';
import {publishStorySaveStatus} from '../../../store/persistence/save-status';
import {saveProjectMetadata} from '../../../store/project-metadata';
import {markProjectStoryHydration} from '../../../store/project-hydration';
import {StoriesContext, Story} from '../../../store/stories';
import {fakeStory} from '../../../test-util/fakes';
import {AppShell} from '../app-shell';
import {useAppShellContext} from '../app-shell-context';

const mockPlayStory = jest.fn();
const mockProofStory = jest.fn();
const mockTestStory = jest.fn();

jest.mock('../../../store/use-publishing', () => ({
	usePublishing: () => ({
		publishStory: jest.fn(async () => '<html></html>')
	})
}));

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		playStory: mockPlayStory,
		proofStory: mockProofStory,
		testStory: mockTestStory
	})
}));

const MockRouteActions: React.FC = () => {
	const appShell = useAppShellContext();

	React.useEffect(() => {
		appShell.setToolbar({
			pinnedControls: <span>Pin Control</span>,
			tabs: {
				Build: <button type="button">Build Action</button>,
				Story: <button type="button">Story Action</button>
			}
		});
		appShell.setDock({
			content: <span>Dock Content</span>,
			label: 'Inspector'
		});

		return () => {
			appShell.setDock(undefined);
			appShell.setToolbar(undefined);
		};
	}, [appShell]);

	return null;
};

function renderShell(story: Story, route = `/stories/${story.id}`) {
	return render(
		<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
			<MemoryRouter initialEntries={[route]}>
				<AppShell>
					<MockRouteActions />
				</AppShell>
			</MemoryRouter>
		</StoriesContext.Provider>
	);
}

function mockPlatform(platform: string) {
	Object.defineProperty(window.navigator, 'platform', {
		configurable: true,
		value: platform
	});
}

describe('AppShell', () => {
	let story: Story;

	beforeEach(() => {
		mockPlatform('MacIntel');
		jest.clearAllMocks();
		window.localStorage.clear();
		publishStorySaveStatus({kind: 'idle'});
		markProjectStoryHydration('mock-story', {passageTextLoaded: true});
		story = {
			...fakeStory(2),
			id: 'mock-story',
			name: 'Moon Castle',
			passages: fakeStory(2).passages.map((passage, index) => ({
				...passage,
				name: index === 0 ? 'Opening' : 'Atrium',
				selected: index === 0,
				text: index === 0 ? 'one two three' : 'four five'
			})),
			selected: true
		};
	});

	it('wraps route content with shell anatomy and command-bar slots', async () => {
		renderShell(story);

		expect(screen.getByTestId('app-shell')).toBeInTheDocument();
		expect(screen.getByLabelText('twine.rs')).toBeInTheDocument();
		expect(screen.getByText('Moon Castle')).toBeInTheDocument();
		expect(screen.getByTitle('Workbench')).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect(await screen.findByText('Build Action')).toBeInTheDocument();
		expect(screen.getByText('Pin Control')).toBeInTheDocument();
		expect(
			screen.getByRole('complementary', {name: 'Inspector'})
		).toBeInTheDocument();
		expect(screen.getByText('Dock Content')).toBeInTheDocument();
		expect(screen.getByText('Opening')).toBeInTheDocument();
		expect(screen.getByTitle('Open Opening')).toBeInTheDocument();
		expect(screen.getByText('5 words')).toBeInTheDocument();
	});

	it('shows shell story-opening progress while a file-backed story hydrates', () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath: '/native/moon-castle.twine.rs'
		});

		renderShell(story);

		expect(
			screen.getByRole('progressbar', {name: 'Opening story'})
		).toHaveTextContent('Loading passage text');
		expect(
			screen.getByRole('button', {name: /Loading passage text/})
		).toBeInTheDocument();
	});

	it('does not show story-opening progress from the library route', () => {
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath: '/native/moon-castle.twine.rs'
		});

		renderShell(story, '/');

		expect(
			screen.queryByRole('progressbar', {name: 'Opening story'})
		).not.toBeInTheDocument();
		expect(screen.getByRole('button', {name: /Opening/})).toBeInTheDocument();
	});

	it('opens the global command palette and runs shell commands', async () => {
		renderShell(story);

		fireEvent.keyDown(window, {key: 'k', metaKey: true});

		const input = await screen.findByLabelText('Command');

		fireEvent.change(input, {target: {value: 'play'}});
		fireEvent.keyDown(input, {key: 'Enter'});

		await waitFor(() => expect(mockPlayStory).toHaveBeenCalledWith(story.id));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('opens the global command palette from the visible Command button', async () => {
		renderShell(story);

		fireEvent.click(screen.getByRole('button', {name: 'Command'}));

		const input = await screen.findByLabelText('Command');

		await waitFor(() => expect(input).toHaveFocus());
		expect(screen.getByText('⌘ Enter')).toBeInTheDocument();
	});

	it('runs accessible keyboard shortcuts for shell commands', async () => {
		renderShell(story);

		fireEvent.keyDown(window, {key: 'Enter', metaKey: true});

		await waitFor(() => expect(mockPlayStory).toHaveBeenCalledWith(story.id));
	});

	it('navigates to the first-class Build surface from commands', async () => {
		renderShell(story);

		fireEvent.keyDown(window, {key: 'k', metaKey: true});

		const input = await screen.findByLabelText('Command');

		fireEvent.change(input, {target: {value: 'build export'}});
		fireEvent.keyDown(input, {key: 'Enter'});

		await waitFor(() =>
			expect(screen.getByTitle('Build & Export')).toHaveAttribute(
				'aria-current',
				'page'
			)
		);
		expect(screen.getByTitle('Workbench')).not.toHaveAttribute('aria-current');
	});

	it('marks the Story Formats surface in shell navigation', () => {
		renderShell(story, '/formats');

		expect(screen.getByTitle('Story Formats')).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect(screen.getByText('Story Formats')).toBeInTheDocument();
	});

	it('marks the Settings surface in shell navigation', () => {
		renderShell(story, '/settings');

		expect(screen.getByTitle('Settings')).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect(screen.getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
	});

	it('reports persistence errors in the status bar', async () => {
		renderShell(story);

		act(() => {
			publishStorySaveStatus({
				error: new Error('Disk is full'),
				kind: 'error'
			});
		});

		const status = await screen.findByText('Save error');

		expect(status.closest('.app-shell__status-item')).toHaveAttribute(
			'title',
			'Disk is full'
		);
	});
});
