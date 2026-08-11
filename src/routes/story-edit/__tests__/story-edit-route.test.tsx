import {redo, undo} from '@codemirror/commands';
import {EditorView} from '@codemirror/view';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {
	createMemoryRouter,
	MemoryRouter,
	RouterProvider,
	useNavigate
} from 'react-router';
import {AppShell} from '../../../components/app-shell';
import {StoreCoreProjectHost} from '../../../core/project-host';
import {Story} from '../../../store/stories';
import {useStoryFormatsContext} from '../../../store/story-formats';
import {
	fakeLoadedStoryFormat,
	FakeStateProvider,
	FakeStateProviderProps,
	fakeStory,
	LocationInspector,
	StoryInspector,
	TestRoute,
	waitForMockPromises
} from '../../../test-util';
import {InnerStoryEditRoute} from '../story-edit-route';
import {rendererQuitQuiescence} from '../../../util/renderer-quit-quiescence';

const HistoryBackButton: React.FC = () => {
	const navigate = useNavigate();

	return <button onClick={() => navigate(-1)}>History back</button>;
};

const FormatDiagnosticInspector: React.FC = () => {
	const {formats} = useStoryFormatsContext();
	const diagnostic = formats[0]?.editorIntegrationDiagnostic;

	return (
		<div
			data-testid="format-editor-diagnostic"
			data-unsupported-api={diagnostic?.unsupportedApi}
		>
			{diagnostic?.message ?? ''}
		</div>
	);
};

const TestStoryEditRoute: React.FC = () => {
	return (
		<>
			<AppShell>
				<TestRoute path="/stories/:storyId">
					<InnerStoryEditRoute />
					<StoryInspector />
					<FormatDiagnosticInspector />
				</TestRoute>
			</AppShell>
			<LocationInspector />
			<HistoryBackButton />
		</>
	);
};

describe('<StoryEditRoute>', () => {
	beforeEach(() => {
		window.localStorage.clear();
	});

	async function renderComponent(
		story: Story,
		contexts?: FakeStateProviderProps,
		initialEntry?: (story: Story) => string | string[]
	) {
		const format = fakeLoadedStoryFormat();

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStoryWordCountAsync')
			.mockImplementation(() => new Promise<never>(() => {}));

		format.name = story.storyFormat;
		format.version = story.storyFormatVersion;
		const storyFormats = contexts?.storyFormats ?? [format];

		jest.useFakeTimers();

		const requestedEntry = initialEntry?.(story) ?? `/stories/${story.id}`;
		const result = render(
			<MemoryRouter
				initialEntries={
					Array.isArray(requestedEntry) ? requestedEntry : [requestedEntry]
				}
			>
				<FakeStateProvider
					{...contexts}
					stories={[story]}
					storyFormats={storyFormats}
				>
					<TestStoryEditRoute />
				</FakeStateProvider>
			</MemoryRouter>
		);

		act(() => {
			jest.runAllTimers();
		});

		jest.useRealTimers();

		// Need this because of <PromptButton>
		await act(async () => Promise.resolve());
		return result;
	}

	async function renderDataRouterComponent(story: Story) {
		const format = fakeLoadedStoryFormat();
		if (typeof globalThis.Request === 'undefined') {
			class TestNavigationRequest {
				readonly method: string;
				readonly signal?: AbortSignal | null;
				readonly url: string;

				constructor(input: string | URL, init?: RequestInit) {
					this.method = init?.method ?? 'GET';
					this.signal = init?.signal;
					this.url = input.toString();
				}
			}

			Object.defineProperty(globalThis, 'Request', {
				configurable: true,
				value: TestNavigationRequest
			});
		}

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStoryWordCountAsync')
			.mockImplementation(() => new Promise<never>(() => {}));
		format.name = story.storyFormat;
		format.version = story.storyFormatVersion;
		const router = createMemoryRouter(
			[{element: <TestStoryEditRoute />, path: '*'}],
			{initialEntries: ['/before', `/stories/${story.id}`]}
		);

		jest.useFakeTimers();
		const result = render(
			<FakeStateProvider stories={[story]} storyFormats={[format]}>
				<RouterProvider router={router} />
			</FakeStateProvider>
		);

		act(() => {
			jest.runAllTimers();
		});
		jest.useRealTimers();
		await act(async () => Promise.resolve());

		return {...result, router};
	}

	it('sets the document title to the story name', async () => {
		const story = fakeStory();

		await renderComponent(story);
		expect(document.title).toBe(`${story.name} - Twine RS`);
	});

	it('replaces the missing story route with the story list route', async () => {
		await renderComponent(fakeStory(), undefined, () => [
			'/before',
			'/stories/missing'
		]);

		await waitFor(() =>
			expect(
				screen.queryByTestId('story-inspector-default')
			).not.toBeInTheDocument()
		);
		expect(screen.getByTestId('location')).toHaveAttribute(
			'data-pathname',
			'/'
		);

		await act(async () => {
			fireEvent.click(screen.getByRole('button', {name: 'History back'}));
			await Promise.resolve();
			await Promise.resolve();
		});
		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				'/before'
			)
		);
	});

	it('registers story edit actions in the app shell', async () => {
		await renderComponent(fakeStory());
		expect(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		).toBeInTheDocument();
		expect(
			screen.getByRole('tab', {name: 'common.passage'})
		).toBeInTheDocument();
	});

	it('contains a live unsupported command, stays editable, and records its format diagnostic', async () => {
		const previousCompatibilityVersion =
			process.env.VITE_TWINE_COMPATIBILITY_VERSION;
		const warn = jest.spyOn(console, 'warn').mockImplementation();
		const story = fakeStory();
		const format = fakeLoadedStoryFormat(
			{name: 'Unsupported Legacy Editor', version: '1.0.0'},
			{
				editorExtensions: {
					twine: {
						'^2.0.0': {
							codeMirror: {
								commands: {
									break(editor) {
										void (editor as unknown as {display: unknown}).display;
									}
								},
								toolbar: () => [
									{
										command: 'break',
										icon: 'data:image/png;base64,AA==',
										label: 'Break unsupported command',
										type: 'button'
									}
								]
							}
						}
					}
				},
				name: 'Unsupported Legacy Editor',
				source: '{{STORY_DATA}}',
				version: '1.0.0'
			}
		);

		story.storyFormat = format.name;
		story.storyFormatVersion = format.version;
		story.passages[0].text = '(if: true)[still editable]';
		process.env.VITE_TWINE_COMPATIBILITY_VERSION = '2.12.0';
		const {container} = await renderComponent(story, {
			storyFormats: [format]
		});

		fireEvent.click(
			screen.getByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		await waitFor(() =>
			expect(
				container.querySelector('[data-testid^="story-editor-window-"]')
			).toBeInTheDocument()
		);
		fireEvent.click(
			await screen.findByRole('button', {
				name: 'Break unsupported command'
			})
		);
		await waitFor(() =>
			expect(screen.getByTestId('format-editor-diagnostic')).toHaveTextContent(
				'Legacy editor command disabled after an unsupported format API call'
			)
		);
		await waitFor(() =>
			expect(
				container.querySelector(
					'[data-testid^="story-editor-window-"] .cm-twine-macro'
				)
			).toBeInTheDocument()
		);

		const content = container.querySelector(
			'[data-testid^="story-editor-window-"] .cm-content'
		);

		if (!(content instanceof HTMLElement)) {
			throw new Error('Live story editor content was not mounted');
		}
		const view = EditorView.findFromDOM(content);

		if (!view) {
			throw new Error('Live story editor view was not available');
		}
		await waitFor(() =>
			expect(view.state.doc.toString()).toBe('(if: true)[still editable]')
		);

		act(() => {
			view.dispatch({
				changes: {
					from: 0,
					insert: '(if: false)[fallback saved]',
					to: view.state.doc.length
				}
			});
		});
		expect(view.state.doc.toString()).toBe('(if: false)[fallback saved]');
		act(() => {
			expect(undo(view)).toBe(true);
		});
		expect(view.state.doc.toString()).not.toBe('(if: false)[fallback saved]');
		act(() => {
			expect(redo(view)).toBe(true);
		});
		expect(view.state.doc.toString()).toBe('(if: false)[fallback saved]');
		try {
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining(
					'Story format editor fallback for Unsupported Legacy Editor 1.0.0: command failed (UnsupportedLegacyEditorApiError: display)'
				)
			);
		} finally {
			warn.mockRestore();
			if (previousCompatibilityVersion === undefined) {
				delete process.env.VITE_TWINE_COMPATIBILITY_VERSION;
			} else {
				process.env.VITE_TWINE_COMPATIBILITY_VERSION =
					previousCompatibilityVersion;
			}
		}
	}, 15_000);

	it('reports a live stream-mode failure without misdiagnosing it as an unsupported API', async () => {
		const previousCompatibilityVersion =
			process.env.VITE_TWINE_COMPATIBILITY_VERSION;
		const warn = jest.spyOn(console, 'warn').mockImplementation();
		const story = fakeStory();
		const format = fakeLoadedStoryFormat(
			{name: 'Broken Legacy Mode', version: '1.0.0'},
			{
				editorExtensions: {
					twine: {
						'^2.0.0': {
							codeMirror: {
								mode: () => ({
									token() {
										throw new Error('mode exploded');
									}
								})
							}
						}
					}
				},
				name: 'Broken Legacy Mode',
				source: '{{STORY_DATA}}',
				version: '1.0.0'
			}
		);

		story.storyFormat = format.name;
		story.storyFormatVersion = format.version;
		story.passages[0].text = 'still editable';
		process.env.VITE_TWINE_COMPATIBILITY_VERSION = '2.12.0';
		const {container} = await renderComponent(story, {
			storyFormats: [format]
		});

		fireEvent.click(
			screen.getByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		await waitFor(() =>
			expect(
				container.querySelector('[data-testid^="story-editor-window-"]')
			).toBeInTheDocument()
		);
		await waitFor(() =>
			expect(screen.getByTestId('format-editor-diagnostic')).toHaveTextContent(
				'Legacy editor mode disabled: Legacy stream mode threw during token.'
			)
		);
		expect(screen.getByTestId('format-editor-diagnostic')).not.toHaveAttribute(
			'data-unsupported-api'
		);

		try {
			expect(warn).toHaveBeenCalledWith(
				expect.stringContaining(
					'mode failed (LegacyStreamModeexception: Legacy stream mode threw during token.)'
				)
			);
		} finally {
			warn.mockRestore();
			if (previousCompatibilityVersion === undefined) {
				delete process.env.VITE_TWINE_COMPATIBILITY_VERSION;
			} else {
				process.env.VITE_TWINE_COMPATIBILITY_VERSION =
					previousCompatibilityVersion;
			}
		}
	}, 15_000);

	it('displays a story graph panel', async () => {
		await renderComponent(fakeStory());
		expect(screen.getByLabelText('Story graph')).toBeInTheDocument();
	});

	it('edits graph passages in the workspace instead of opening the legacy passage dialog', async () => {
		const story = fakeStory(1);

		story.passages[0].left = 125;
		story.passages[0].top = 125;
		window.localStorage.setItem(
			'twine-story-edit-workspace',
			JSON.stringify({mode: 'graph'})
		);
		const {container, unmount} = await renderComponent(story);
		let graphNode: HTMLElement | null = null;

		await waitFor(
			() => {
				graphNode = container.querySelector(
					`[data-passage-id="${story.passages[0].id}"] .tw-node`
				);
				expect(graphNode).toBeTruthy();
			},
			{timeout: 4000}
		);

		fireEvent.doubleClick(graphNode!);

		await waitFor(
			() =>
				expect(
					container.querySelector('.story-edit-editor-window')
				).toBeTruthy(),
			{timeout: 4000}
		);
		expect(container.querySelector('.passage-edit-stack')).toBeNull();

		await waitFor(() =>
			expect(
				JSON.parse(
					window.localStorage.getItem(
						`twine-story-edit-workspace-${story.id}`
					) ?? '{}'
				)
			).toEqual(
				expect.objectContaining({
					activeWindowId: `passage:${story.passages[0].id}`,
					editorWindows: [{kind: 'passage', passageId: story.passages[0].id}],
					mode: 'split'
				})
			)
		);

		unmount();

		await renderComponent(story);
		expect(
			await screen.findByTestId(`story-editor-window-${story.passages[0].id}`)
		).toBeInTheDocument();
	});

	it('restores persisted editor windows and prunes stale passage windows', async () => {
		const story = fakeStory(2);

		story.passages[0].id = 'start';
		story.passages[0].name = 'Start';
		story.passages[1].id = 'next';
		story.passages[1].name = 'Next';
		story.startPassage = 'start';
		story.stylesheet = 'tw-story { color: red; }';
		window.localStorage.setItem(
			`twine-story-edit-workspace-${story.id}`,
			JSON.stringify({
				activeWindowId: 'stylesheet',
				editorWindows: [
					{kind: 'passage', passageId: 'start'},
					{kind: 'stylesheet'},
					{kind: 'passage', passageId: 'deleted'}
				],
				mode: 'split'
			})
		);

		const {container} = await renderComponent(story);

		expect(
			await screen.findByTestId('story-editor-window-start')
		).toBeInTheDocument();
		expect(
			screen.getByTestId(`story-editor-window-${story.id}:stylesheet`)
		).toBeInTheDocument();
		expect(
			container.querySelector('#story-editor-window-deleted')
		).not.toBeInTheDocument();
		expect(
			container.querySelector(
				`.story-edit-editor-window.is-active #story-editor-window-${story.id}\\:stylesheet`
			)
		).toBeInTheDocument();
	});

	it('returns to graph mode after closing the last editor from split mode', async () => {
		const story = fakeStory(1);

		story.passages[0].left = 125;
		story.passages[0].top = 125;
		window.localStorage.setItem(
			'twine-story-edit-workspace',
			JSON.stringify({mode: 'graph'})
		);
		const {container} = await renderComponent(story);
		let graphNode: HTMLElement | null = null;

		await waitFor(
			() => {
				graphNode = container.querySelector(
					`[data-passage-id="${story.passages[0].id}"] .tw-node`
				);
				expect(graphNode).toBeTruthy();
			},
			{timeout: 4000}
		);

		fireEvent.doubleClick(graphNode!);

		await waitFor(
			() =>
				expect(
					container.querySelector('.story-edit-editor-window')
				).toBeTruthy(),
			{timeout: 4000}
		);

		fireEvent.click(
			container.querySelector(
				'.story-edit-editor-window [aria-label^="common.close"]'
			)!
		);

		await waitFor(() =>
			expect(container.querySelector('.story-edit-text-layer')).toBeNull()
		);
		expect(screen.getByLabelText('Story graph')).toBeInTheDocument();
	});

	it('opens the Go To Passage finder from text mode above the workspace', async () => {
		const story = fakeStory(1);

		story.passages[0].name = 'Start';
		story.passages[0].text = 'Opening text.';
		const {container} = await renderComponent(story);

		fireEvent.click(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		await waitFor(() =>
			expect(
				container.querySelector(
					`[data-testid="story-editor-window-${story.passages[0].id}"] .cm-content`
				)
			).toHaveTextContent('Opening text.')
		);
		fireEvent.click(
			screen.getByRole('button', {name: 'routes.storyEdit.toolbar.goTo'})
		);

		expect(
			screen.getByLabelText('components.passageFuzzyFinder.prompt')
		).toBeInTheDocument();
		expect(
			container.querySelector('.story-edit-workspace > .fuzzy-finder')
		).toBeTruthy();
	});

	it('flushes pending editor text immediately and ignores post-freeze edits', async () => {
		const story = fakeStory(1);

		story.passages[0].text = 'Before quit';
		const {container} = await renderComponent(story);

		fireEvent.click(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		const content = await waitFor(() => {
			const candidate = container.querySelector(
				`[data-testid="story-editor-window-${story.passages[0].id}"] .cm-content`
			);

			expect(candidate).toBeInstanceOf(HTMLElement);
			return candidate as HTMLElement;
		});
		const view = EditorView.findFromDOM(content);

		if (!view) {
			throw new Error('Live story editor view was not available');
		}
		const apply = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommandPersisted')
			.mockResolvedValue({} as any);

		jest.useFakeTimers();
		act(() => {
			view.dispatch({
				changes: {
					from: 0,
					insert: 'Flushed at quit',
					to: view.state.doc.length
				}
			});
		});
		expect(
			apply.mock.calls.filter(
				([command]) => command.type === 'updatePassageText'
			)
		).toHaveLength(0);

		let draining: Promise<void> = Promise.resolve();
		act(() => {
			draining = rendererQuitQuiescence.drain();
		});
		await act(async () => draining);
		expect(
			apply.mock.calls.filter(
				([command]) =>
					command.type === 'updatePassageText' &&
					command.text === 'Flushed at quit'
			)
		).toHaveLength(1);

		act(() => {
			view.dispatch({
				changes: {from: 0, insert: 'Ignored', to: view.state.doc.length}
			});
			jest.advanceTimersByTime(500);
		});
		expect(
			apply.mock.calls.filter(
				([command]) => command.type === 'updatePassageText'
			)
		).toHaveLength(1);

		act(() => rendererQuitQuiescence.cancel());
		act(() => {
			view.dispatch({
				changes: {from: 0, insert: 'Reopened', to: view.state.doc.length}
			});
		});
		await act(async () => {
			jest.advanceTimersByTime(300);
			await Promise.resolve();
		});
		expect(
			apply.mock.calls.filter(
				([command]) =>
					command.type === 'updatePassageText' && command.text === 'Reopened'
			)
		).toHaveLength(1);
		jest.useRealTimers();
	});

	it('restores a failed editor flush for the next quit attempt', async () => {
		const story = fakeStory(1);

		story.passages[0].text = 'Before quit';
		const {container} = await renderComponent(story);

		fireEvent.click(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		const content = await waitFor(() => {
			const candidate = container.querySelector(
				`[data-testid="story-editor-window-${story.passages[0].id}"] .cm-content`
			);

			expect(candidate).toBeInstanceOf(HTMLElement);
			return candidate as HTMLElement;
		});
		const view = EditorView.findFromDOM(content);

		if (!view) {
			throw new Error('Live story editor view was not available');
		}
		const apply = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommandPersisted')
			.mockRejectedValueOnce(new Error('first flush failed'))
			.mockResolvedValueOnce({} as any);

		jest.useFakeTimers();
		act(() => {
			view.dispatch({
				changes: {
					from: 0,
					insert: 'Retry at quit',
					to: view.state.doc.length
				}
			});
		});

		let failedDrain: Promise<void> = Promise.resolve();

		act(() => {
			failedDrain = rendererQuitQuiescence.drain();
		});
		await act(async () => {
			await expect(failedDrain).rejects.toThrow('first flush failed');
		});
		expect(
			apply.mock.calls.filter(
				([command]) =>
					command.type === 'updatePassageText' &&
					command.text === 'Retry at quit'
			)
		).toHaveLength(1);

		act(() => rendererQuitQuiescence.cancel());
		let retryDrain: Promise<void> = Promise.resolve();

		act(() => {
			retryDrain = rendererQuitQuiescence.drain();
		});
		await act(async () => retryDrain);
		expect(
			apply.mock.calls.filter(
				([command]) =>
					command.type === 'updatePassageText' &&
					command.text === 'Retry at quit'
			)
		).toHaveLength(2);

		act(() => rendererQuitQuiescence.cancel());
		jest.useRealTimers();
	});

	it('does not restore an older failed flush over a newer pending edit', async () => {
		const story = fakeStory(1);

		story.passages[0].text = 'Before quit';
		const {container} = await renderComponent(story);

		fireEvent.click(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		const content = await waitFor(() => {
			const candidate = container.querySelector(
				`[data-testid="story-editor-window-${story.passages[0].id}"] .cm-content`
			);

			expect(candidate).toBeInstanceOf(HTMLElement);
			return candidate as HTMLElement;
		});
		const view = EditorView.findFromDOM(content);

		if (!view) {
			throw new Error('Live story editor view was not available');
		}
		let rejectFirstFlush: (error: Error) => void = () => {};
		const firstFlush = new Promise<any>((_, reject) => {
			rejectFirstFlush = reject;
		});
		const apply = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommandPersisted')
			.mockReturnValueOnce(firstFlush)
			.mockResolvedValueOnce({} as any);

		jest.useFakeTimers();
		act(() => {
			view.dispatch({
				changes: {
					from: 0,
					insert: 'Older pending edit',
					to: view.state.doc.length
				}
			});
		});
		let cancelledDrain: Promise<void> = Promise.resolve();

		act(() => {
			cancelledDrain = rendererQuitQuiescence.drain();
		});

		act(() => rendererQuitQuiescence.cancel());
		await expect(cancelledDrain).rejects.toThrow('was cancelled');
		act(() => {
			view.dispatch({
				changes: {
					from: 0,
					insert: 'Newer pending edit',
					to: view.state.doc.length
				}
			});
		});
		await act(async () => {
			rejectFirstFlush(new Error('older flush failed'));
			await Promise.resolve();
			await Promise.resolve();
			await Promise.resolve();
		});

		let retryDrain: Promise<void> = Promise.resolve();

		act(() => {
			retryDrain = rendererQuitQuiescence.drain();
		});
		await act(async () => retryDrain);
		expect(
			apply.mock.calls.flatMap(([command]) =>
				command.type === 'updatePassageText' ? [command.text] : []
			)
		).toEqual(['Older pending edit', 'Newer pending edit']);

		act(() => rendererQuitQuiescence.cancel());
		jest.useRealTimers();
	});

	it('keeps a dirty editor open when its final persisted flush fails', async () => {
		const story = fakeStory(1);
		const {container} = await renderComponent(story);

		fireEvent.click(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		const editorWindow = await screen.findByTestId(
			`story-editor-window-${story.passages[0].id}`
		);
		const editorShell = editorWindow.closest('.story-edit-editor-window');
		const content = editorWindow.querySelector('.cm-content');
		const view = content
			? EditorView.findFromDOM(content as HTMLElement)
			: undefined;

		if (!editorShell || !view) {
			throw new Error('Live story editor view was not available');
		}
		let rejectSave!: (error: Error) => void;
		const failedSave = new Promise<never>((_resolve, reject) => {
			rejectSave = reject;
		});
		const apply = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommandPersisted')
			.mockReturnValueOnce(failedSave)
			.mockResolvedValueOnce({} as any);

		jest.useFakeTimers();
		act(() => {
			view.dispatch({
				changes: {
					from: 0,
					insert: 'Unsaved final edit',
					to: view.state.doc.length
				}
			});
		});
		await act(async () => {
			fireEvent.click(
				editorShell.querySelector('[aria-label^="common.close"]')!
			);
			await Promise.resolve();
		});
		await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
		await act(async () => {
			rejectSave(new Error('disk unavailable'));
			await Promise.resolve();
			await Promise.resolve();
		});

		expect(container.querySelector('.story-edit-editor-window')).toBeTruthy();
		expect(screen.getByText('Save failed')).toHaveAttribute(
			'title',
			'disk unavailable'
		);

		await act(async () => {
			fireEvent.click(
				editorShell.querySelector('[aria-label^="common.close"]')!
			);
			await Promise.resolve();
			await Promise.resolve();
		});
		expect(apply).toHaveBeenCalledTimes(2);
		await waitFor(() =>
			expect(container.querySelector('.story-edit-editor-window')).toBeNull()
		);
		jest.useRealTimers();
	});

	it('blocks history navigation until dirty text is durably committed', async () => {
		const story = fakeStory(1);
		const {container, router} = await renderDataRouterComponent(story);

		fireEvent.click(
			await screen.findByRole('tab', {
				name: 'routes.storyEdit.workspace.textMode'
			})
		);
		const editorWindow = await screen.findByTestId(
			`story-editor-window-${story.passages[0].id}`
		);
		const content = editorWindow.querySelector('.cm-content');
		const view = content
			? EditorView.findFromDOM(content as HTMLElement)
			: undefined;

		if (!view) {
			throw new Error('Live story editor view was not available');
		}

		let rejectSave!: (error: Error) => void;
		const failedSave = new Promise<never>((_resolve, reject) => {
			rejectSave = reject;
		});
		const apply = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyStoryCommandPersisted')
			.mockReturnValueOnce(failedSave)
			.mockResolvedValueOnce({} as any);

		act(() => {
			view.dispatch({
				changes: {
					from: 0,
					insert: 'Navigate only after saving',
					to: view.state.doc.length
				}
			});
		});
		fireEvent.click(screen.getByRole('button', {name: 'History back'}));
		await waitFor(() => expect(apply).toHaveBeenCalledTimes(1));
		await act(async () => {
			rejectSave(new Error('disk unavailable'));
			await Promise.resolve();
			await Promise.resolve();
		});

		await waitFor(() =>
			expect(screen.getByText('Save failed')).toHaveAttribute(
				'title',
				'disk unavailable'
			)
		);
		expect(router.state.location.pathname).toBe(`/stories/${story.id}`);
		expect(container.querySelector('.story-edit-editor-window')).toBeTruthy();

		fireEvent.click(screen.getByRole('button', {name: 'History back'}));
		await waitFor(() => expect(router.state.location.pathname).toBe('/before'));
		expect(apply).toHaveBeenCalledTimes(2);
	});

	it('opens story find and replace from shell toolbar story actions', async () => {
		const querySearchPage = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'querySearchPageAsync'
		);

		await renderComponent(fakeStory());

		fireEvent.click(await screen.findByRole('tab', {name: 'common.story'}));
		fireEvent.click(
			screen.getByRole('button', {
				name: 'routes.storyEdit.toolbar.findAndReplace'
			})
		);
		await waitForMockPromises(querySearchPage);

		expect(screen.getByRole('tabpanel')).toHaveAttribute(
			'data-workbench-panel',
			'find-replace'
		);
		expect(
			screen.getByRole('textbox', {name: 'dialogs.storySearch.find'})
		).toBeInTheDocument();
	});

	it('opens the stylesheet editor for a stylesheet source route target', async () => {
		const story = fakeStory(1);

		story.stylesheet = '.hero { background: url("assets/bg.png"); }';

		await renderComponent(
			story,
			undefined,
			story => `/stories/${story.id}?mode=text&source=stylesheet`
		);

		expect(
			await screen.findByTestId(`story-editor-window-${story.id}:stylesheet`)
		).toBeInTheDocument();
		expect(
			screen.getByLabelText('routes.storyEdit.toolbar.stylesheet')
		).toBeInTheDocument();
	});

	it('opens story search for variable source route queries', async () => {
		const story = fakeStory(1);

		story.passages[0].text = 'Set $score here.';

		await renderComponent(
			story,
			undefined,
			story => `/stories/${story.id}?mode=text&q=%24score&scope=variable`
		);

		expect(screen.getByRole('tabpanel')).toHaveAttribute(
			'data-workbench-panel',
			'find-replace'
		);
		expect(
			screen.getByRole('textbox', {name: 'dialogs.storySearch.find'})
		).toHaveValue('$score');
	});

	it('opens story details from shell toolbar story actions', async () => {
		const queryStorySummary = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'queryStorySummaryAsync'
		);

		await renderComponent(fakeStory());

		fireEvent.click(await screen.findByRole('tab', {name: 'common.story'}));
		fireEvent.click(screen.getByRole('button', {name: 'common.details'}));
		await waitForMockPromises(queryStorySummary);

		expect(screen.getByRole('tabpanel')).toHaveAttribute(
			'data-workbench-panel',
			'story-details'
		);
		expect(
			screen.getByLabelText('dialogs.storyDetails.snapToGrid')
		).toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = await renderComponent(fakeStory());

		expect(await axe(container)).toHaveNoViolations();
	});
});
