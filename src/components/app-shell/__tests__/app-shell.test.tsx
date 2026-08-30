import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, useNavigate} from 'react-router';
import {
	CoreProjectHostProvider,
	diagnosticDismissalsChangedEvent,
	diagnosticIdentity,
	saveDismissedDiagnosticIds
} from '../../../core';
import {StoreCoreProjectHost} from '../../../test-util/core-project-host-runtime';
import type {CoreDiagnostic} from '../../../core/bindings/CoreDiagnostic';
import type {CoreDiagnosticsPage} from '../../../core/bindings/CoreDiagnosticsPage';
import type {CoreDiagnosticsSummary} from '../../../core/bindings/CoreDiagnosticsSummary';
import {publishStorySaveStatus} from '../../../store/persistence/save-status';
import {saveProjectMetadata} from '../../../store/project-metadata';
import {markProjectStoryHydration} from '../../../store/project-hydration';
import {StoriesContext, Story} from '../../../store/stories';
import {fakeStory} from '../../../test-util/fakes';
import {waitForMockPromises} from '../../../test-util';
import {workbenchBufferCoordinator} from '../../../util/workbench-buffer-coordinator';
import {AppShell} from '../app-shell';
import {useAppShellContext} from '../app-shell-context';

const mockPlayStory = jest.fn();
const mockProofStory = jest.fn();
const mockTestStory = jest.fn();

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});

	return {promise, reject, resolve};
}

function diagnostic(
	severity: CoreDiagnostic['severity'],
	code: string
): CoreDiagnostic {
	return {
		code,
		end: 1,
		line: 1,
		message: `${severity} diagnostic`,
		passageId: null,
		quickFixes: [],
		severity,
		sourceId: 'story.twee',
		start: 0
	};
}

function diagnosticsPage(
	diagnostics: CoreDiagnostic[],
	options: {nextCursor?: string | null; totalCount?: number} = {}
): CoreDiagnosticsPage {
	return {
		diagnostics,
		nextCursor: options.nextCursor ?? null,
		revision: 1,
		storyId: 'mock-story',
		totalCount: options.totalCount ?? diagnostics.length
	};
}

function diagnosticsSummary(
	overrides: Partial<CoreDiagnosticsSummary> = {}
): CoreDiagnosticsSummary {
	return {
		diagnosticCount: 0,
		dismissedCount: 0,
		errorCount: 0,
		infoCount: 0,
		revision: 1,
		storyId: 'mock-story',
		warningCount: 0,
		...overrides
	};
}

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

const ShellRouteNavigator: React.FC<{storyId: string}> = ({storyId}) => {
	const navigate = useNavigate();

	return (
		<button onClick={() => navigate(`/stories/${storyId}`)} type="button">
			Switch shell story
		</button>
	);
};

async function renderShell(story: Story, route = `/stories/${story.id}`) {
	const queryWordCount = jest.spyOn(
		StoreCoreProjectHost.prototype,
		'queryStoryWordCountAsync'
	);
	const result = render(
		<StoriesContext.Provider value={{dispatch: jest.fn(), stories: [story]}}>
			<CoreProjectHostProvider>
				<MemoryRouter initialEntries={[route]}>
					<AppShell>
						<MockRouteActions />
					</AppShell>
				</MemoryRouter>
			</CoreProjectHostProvider>
		</StoriesContext.Provider>
	);

	await waitForMockPromises(queryWordCount);
	return result;
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
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockResolvedValue(diagnosticsSummary());
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

	afterEach(() => jest.restoreAllMocks());

	it('wraps route content with shell anatomy and command-bar slots', async () => {
		await renderShell(story);

		expect(screen.getByTestId('app-shell')).toBeInTheDocument();
		expect(screen.getByLabelText('twine.rs')).toBeInTheDocument();
		expect(screen.getByText('Moon Castle')).toBeInTheDocument();
		expect(
			screen.getByText('Saved').closest('.app-shell__status-save')
		).toHaveClass('app-shell__status-save--success');
		expect(screen.getByText('Ready')).toHaveClass('tw-badge--success');
		const uncheckedDiagnostics = screen.getByText('Diagnostics not checked');

		expect(uncheckedDiagnostics).toHaveClass(
			'app-shell__status-diagnostics--neutral'
		);
		expect(
			uncheckedDiagnostics.querySelector('[data-icon-name="circle-dashed"]')
		).toBeInTheDocument();
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
		expect(await screen.findByText('5 words')).toBeInTheDocument();
	});

	it('models diagnostics loading and retains the last result when closed', async () => {
		const pending = deferred<CoreDiagnosticsPage>();
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockReturnValue(pending.promise);

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);

		const checkingStatus = await screen.findByRole('button', {
			name: 'Checking diagnostics'
		});

		expect(checkingStatus).toHaveClass(
			'app-shell__status-diagnostics--neutral'
		);
		expect(
			checkingStatus.querySelector('[data-icon-name="loader-2"]')
		).toBeInTheDocument();
		expect(
			screen.getByText('Checking diagnostics for Moon Castle…')
		).toBeInTheDocument();
		expect(screen.queryByText(/No active diagnostics/)).not.toBeInTheDocument();

		await act(async () => pending.resolve(diagnosticsPage([])));

		expect(
			await screen.findByRole('button', {name: '0 diagnostics'})
		).toHaveClass('app-shell__status-diagnostics--success');
		expect(
			screen.getByText('No active diagnostics for Moon Castle')
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Close diagnostics'}));

		expect(screen.getByRole('button', {name: '0 diagnostics'})).toHaveClass(
			'app-shell__status-diagnostics--success'
		);
		expect(queryDiagnostics).toHaveBeenCalledTimes(1);
	});

	it('invalidates a closed in-flight diagnostics query after a project patch', async () => {
		const pending = deferred<CoreDiagnosticsPage>();
		const patchListeners: Array<
			Parameters<StoreCoreProjectHost['subscribeToPatches']>[0]
		> = [];

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'subscribeToPatches')
			.mockImplementation(listener => {
				patchListeners.push(listener);
				return jest.fn();
			});
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockReturnValue(pending.promise);

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);
		await screen.findByRole('button', {name: 'Checking diagnostics'});
		fireEvent.click(screen.getByRole('button', {name: 'Close diagnostics'}));

		act(() => {
			for (const listener of patchListeners) {
				listener({label: 'test', patches: [], transactionId: 1n});
			}
		});

		expect(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		).toHaveClass('app-shell__status-diagnostics--neutral');

		await act(async () =>
			pending.resolve(diagnosticsPage([diagnostic('error', 'STALE')]))
		);

		expect(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: '1 diagnostic'})
		).not.toBeInTheDocument();
	});

	it('uses the highest active diagnostic severity in the footer', async () => {
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockResolvedValue(
				diagnosticsSummary({diagnosticCount: 2, errorCount: 1, warningCount: 1})
			);
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValue(
				diagnosticsPage([
					diagnostic('warning', 'TW-WARN'),
					diagnostic('error', 'TW-ERROR')
				])
			);

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);

		const status = await screen.findByRole('button', {name: '2 diagnostics'});

		expect(status).toHaveClass('app-shell__status-diagnostics--error');
		expect(
			status.querySelector('[data-icon-name="alert-octagon"]')
		).toBeInTheDocument();
	});

	it('uses a bounded preview and diagnostics summary for status', async () => {
		const querySummary = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockResolvedValue(
				diagnosticsSummary({diagnosticCount: 2, errorCount: 1, warningCount: 1})
			);
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValue(
				diagnosticsPage([diagnostic('warning', 'FIRST')], {
					nextCursor: 'page-2',
					totalCount: 2
				})
			);

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);

		const status = await screen.findByRole('button', {name: '2 diagnostics'});

		expect(status).toHaveClass('app-shell__status-diagnostics--error');
		expect(queryDiagnostics).toHaveBeenCalledTimes(1);
		expect(queryDiagnostics).toHaveBeenCalledWith(story.id, {
			cursor: null,
			limit: 8,
			severity: null
		});
		expect(querySummary).toHaveBeenCalledWith(story.id, {dismissedIds: []});
	});

	it('describes a fully previewed dismissed result without implying truncation', async () => {
		const records = [
			diagnostic('warning', 'TW-WARN'),
			diagnostic('error', 'TW-ERROR')
		];

		saveDismissedDiagnosticIds(
			story.id,
			new Set(records.map(diagnosticIdentity))
		);
		const querySummary = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockResolvedValue(
				diagnosticsSummary({
					dismissedCount: 2,
					diagnosticCount: 0,
					errorCount: 0,
					warningCount: 0
				})
			);
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValue(diagnosticsPage(records));

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);

		expect(
			await screen.findByText(
				'No active diagnostics for Moon Castle (2 dismissed)'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByText(/No diagnostics are available in this preview/)
		).not.toBeInTheDocument();
		const status = screen.getByRole('button', {name: '0 diagnostics'});
		expect(status).toHaveClass('app-shell__status-diagnostics--success');
		expect(
			screen.getByTitle('Diagnostics').querySelector('.app-shell__rail-count')
		).not.toBeInTheDocument();
		expect(querySummary).toHaveBeenCalledWith(story.id, {
			dismissedIds: records.map(diagnosticIdentity).sort()
		});
	});

	it('refreshes active status for current-story dismissals only', async () => {
		const records = [diagnostic('error', 'TW-ERROR')];
		const refreshedSummary = deferred<CoreDiagnosticsSummary>();
		const refreshedPage = deferred<CoreDiagnosticsPage>();
		const querySummary = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockResolvedValueOnce(
				diagnosticsSummary({diagnosticCount: 1, errorCount: 1})
			)
			.mockReturnValueOnce(refreshedSummary.promise);
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValueOnce(diagnosticsPage(records))
			.mockReturnValueOnce(refreshedPage.promise);

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);
		expect(
			await screen.findByRole('button', {name: '1 diagnostic'})
		).toHaveClass('app-shell__status-diagnostics--error');

		act(() => {
			window.dispatchEvent(
				new CustomEvent(diagnosticDismissalsChangedEvent, {
					detail: {storyId: 'another-story'}
				})
			);
		});
		expect(querySummary).toHaveBeenCalledTimes(1);
		expect(queryDiagnostics).toHaveBeenCalledTimes(1);
		expect(
			screen.getByRole('button', {name: '1 diagnostic'})
		).toBeInTheDocument();

		act(() => {
			saveDismissedDiagnosticIds(
				story.id,
				new Set(records.map(diagnosticIdentity))
			);
		});
		expect(
			screen.queryByRole('button', {name: '1 diagnostic'})
		).not.toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Checking diagnostics'})
		).toBeInTheDocument();
		expect(querySummary).toHaveBeenCalledTimes(2);
		expect(queryDiagnostics).toHaveBeenCalledTimes(2);

		await act(async () => {
			refreshedSummary.resolve(
				diagnosticsSummary({dismissedCount: 1, storyId: story.id})
			);
			refreshedPage.resolve(diagnosticsPage(records));
		});
		expect(
			await screen.findByRole('button', {name: '0 diagnostics'})
		).toHaveClass('app-shell__status-diagnostics--success');
		expect(
			screen.getByTitle('Diagnostics').querySelector('.app-shell__rail-count')
		).not.toBeInTheDocument();
		expect(querySummary).toHaveBeenLastCalledWith(story.id, {
			dismissedIds: records.map(diagnosticIdentity)
		});
	});

	it('coalesces rapid patches before refreshing diagnostics', async () => {
		const patchListeners: Array<
			Parameters<StoreCoreProjectHost['subscribeToPatches']>[0]
		> = [];

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'subscribeToPatches')
			.mockImplementation(listener => {
				patchListeners.push(listener);
				return jest.fn();
			});
		const querySummary = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockResolvedValue(
				diagnosticsSummary({diagnosticCount: 2, errorCount: 1, warningCount: 1})
			);
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValueOnce(
				diagnosticsPage([
					diagnostic('warning', 'TW-WARN'),
					diagnostic('error', 'TW-ERROR')
				])
			)
			.mockRejectedValueOnce(new Error('Refresh failed'));

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);
		await screen.findByRole('button', {name: '2 diagnostics'});

		const railButton = screen.getByTitle('Diagnostics');
		expect(
			railButton.querySelector('.app-shell__rail-count')
		).toHaveTextContent('2');

		jest.useFakeTimers();
		try {
			for (const transactionId of [2n, 3n, 4n]) {
				act(() => {
					for (const listener of patchListeners) {
						listener({label: 'test', patches: [], transactionId});
					}
				});
				if (transactionId !== 4n) {
					act(() => jest.advanceTimersByTime(100));
				}
			}

			expect(
				railButton.querySelector('.app-shell__rail-count')
			).not.toBeInTheDocument();
			expect(
				screen.getByRole('button', {name: 'Checking diagnostics'})
			).toBeInTheDocument();
			expect(querySummary).toHaveBeenCalledTimes(1);
			expect(queryDiagnostics).toHaveBeenCalledTimes(1);

			act(() => jest.advanceTimersByTime(299));
			expect(querySummary).toHaveBeenCalledTimes(1);
			expect(queryDiagnostics).toHaveBeenCalledTimes(1);

			await act(async () => {
				jest.advanceTimersByTime(1);
				await Promise.resolve();
			});
			expect(querySummary).toHaveBeenCalledTimes(2);
			expect(queryDiagnostics).toHaveBeenCalledTimes(2);
			expect(
				screen.getByRole('button', {name: 'Diagnostics unavailable'})
			).toBeInTheDocument();
			expect(
				railButton.querySelector('.app-shell__rail-count')
			).not.toBeInTheDocument();
		} finally {
			jest.useRealTimers();
		}
	});

	it('cancels a scheduled refresh when the drawer closes as its debounce fires', async () => {
		const patchListeners: Array<
			Parameters<StoreCoreProjectHost['subscribeToPatches']>[0]
		> = [];
		const querySummary = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockResolvedValueOnce(
				diagnosticsSummary({diagnosticCount: 1, errorCount: 1})
			)
			.mockResolvedValueOnce(diagnosticsSummary());
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValueOnce(diagnosticsPage([diagnostic('error', 'TW-ERROR')]))
			.mockResolvedValueOnce(diagnosticsPage([]));

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'subscribeToPatches')
			.mockImplementation(listener => {
				patchListeners.push(listener);
				return jest.fn();
			});

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);
		await screen.findByRole('button', {name: '1 diagnostic'});

		jest.useFakeTimers();
		try {
			act(() => {
				for (const listener of patchListeners) {
					listener({label: 'test', patches: [], transactionId: 2n});
				}
			});
			expect(
				screen.getByRole('button', {name: 'Checking diagnostics'})
			).toBeInTheDocument();

			act(() => {
				jest.advanceTimersByTime(300);
				screen.getByRole('button', {name: 'Close diagnostics'}).click();
			});
			expect(
				screen.getByRole('button', {name: 'Diagnostics not checked'})
			).toBeInTheDocument();

			act(() => jest.advanceTimersByTime(300));
			expect(querySummary).toHaveBeenCalledTimes(1);
			expect(queryDiagnostics).toHaveBeenCalledTimes(1);

			fireEvent.click(
				screen.getByRole('button', {name: 'Diagnostics not checked'})
			);
			await act(async () => {
				await Promise.resolve();
				await Promise.resolve();
			});
			expect(screen.getByRole('button', {name: '0 diagnostics'})).toHaveClass(
				'app-shell__status-diagnostics--success'
			);
			expect(querySummary).toHaveBeenCalledTimes(2);
			expect(queryDiagnostics).toHaveBeenCalledTimes(2);
		} finally {
			jest.useRealTimers();
		}
	});

	it('does not run an expired debounce before a newly batched patch', async () => {
		const patchListeners: Array<
			Parameters<StoreCoreProjectHost['subscribeToPatches']>[0]
		> = [];
		const querySummary = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockResolvedValue(diagnosticsSummary());
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValue(diagnosticsPage([]));

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'subscribeToPatches')
			.mockImplementation(listener => {
				patchListeners.push(listener);
				return jest.fn();
			});

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);
		await screen.findByRole('button', {name: '0 diagnostics'});

		jest.useFakeTimers();
		try {
			act(() => {
				for (const listener of patchListeners) {
					listener({label: 'test', patches: [], transactionId: 2n});
				}
			});

			act(() => {
				jest.advanceTimersByTime(300);
				for (const listener of patchListeners) {
					listener({label: 'test', patches: [], transactionId: 3n});
				}
			});

			expect(querySummary).toHaveBeenCalledTimes(1);
			expect(queryDiagnostics).toHaveBeenCalledTimes(1);
			expect(
				screen.getByRole('button', {name: 'Checking diagnostics'})
			).toBeInTheDocument();

			act(() => jest.advanceTimersByTime(299));
			expect(querySummary).toHaveBeenCalledTimes(1);
			expect(queryDiagnostics).toHaveBeenCalledTimes(1);

			await act(async () => {
				jest.advanceTimersByTime(1);
				await Promise.resolve();
			});
			expect(querySummary).toHaveBeenCalledTimes(2);
			expect(queryDiagnostics).toHaveBeenCalledTimes(2);
			expect(
				screen.getByRole('button', {name: '0 diagnostics'})
			).toBeInTheDocument();
		} finally {
			jest.useRealTimers();
		}
	});

	it('does not render diagnostics owned by the previous route story', async () => {
		const nextSummary = deferred<CoreDiagnosticsSummary>();
		const nextPage = deferred<CoreDiagnosticsPage>();
		const nextStory: Story = {
			...fakeStory(1),
			id: 'next-story',
			name: 'Sun Castle',
			passages: fakeStory(1).passages.map(passage => ({
				...passage,
				story: 'next-story'
			})),
			selected: false
		};

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStoryWordCountAsync')
			.mockResolvedValue(5);
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsSummaryAsync')
			.mockImplementation(storyId =>
				storyId === story.id
					? Promise.resolve(
							diagnosticsSummary({
								diagnosticCount: 2,
								errorCount: 1,
								storyId,
								warningCount: 1
							})
						)
					: nextSummary.promise
			);
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockImplementation(storyId =>
				storyId === story.id
					? Promise.resolve(
							diagnosticsPage([
								diagnostic('warning', 'TW-WARN'),
								diagnostic('error', 'TW-ERROR')
							])
						)
					: nextPage.promise
			);

		render(
			<StoriesContext.Provider
				value={{dispatch: jest.fn(), stories: [story, nextStory]}}
			>
				<CoreProjectHostProvider>
					<MemoryRouter initialEntries={[`/stories/${story.id}`]}>
						<AppShell>
							<MockRouteActions />
							<ShellRouteNavigator storyId={nextStory.id} />
						</AppShell>
					</MemoryRouter>
				</CoreProjectHostProvider>
			</StoriesContext.Provider>
		);

		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);
		await screen.findByRole('button', {name: '2 diagnostics'});
		expect(
			screen.getByTitle('Diagnostics').querySelector('.app-shell__rail-count')
		).toHaveTextContent('2');

		fireEvent.click(screen.getByRole('button', {name: 'Switch shell story'}));

		expect(
			screen.getByTitle('Diagnostics').querySelector('.app-shell__rail-count')
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: '2 diagnostics'})
		).not.toBeInTheDocument();

		await act(async () => {
			nextSummary.resolve(
				diagnosticsSummary({storyId: nextStory.id, warningCount: 0})
			);
			nextPage.resolve({
				diagnostics: [],
				nextCursor: null,
				revision: 1,
				storyId: nextStory.id,
				totalCount: 0
			});
		});
		expect(
			await screen.findByRole('button', {name: '0 diagnostics'})
		).toHaveClass('app-shell__status-diagnostics--success');
	});

	it('shows an explicit diagnostics error state when the query fails', async () => {
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockRejectedValue(new Error('Worker unavailable'));

		await renderShell(story);
		fireEvent.click(
			screen.getByRole('button', {name: 'Diagnostics not checked'})
		);

		const status = await screen.findByRole('button', {
			name: 'Diagnostics unavailable'
		});

		expect(status).toHaveClass('app-shell__status-diagnostics--error');
		expect(status).toHaveAttribute('title', 'Worker unavailable');
		expect(screen.getByRole('alert')).toHaveTextContent(
			'Diagnostics unavailable: Worker unavailable'
		);
		expect(screen.queryByText(/No active diagnostics/)).not.toBeInTheDocument();
	});

	it('shows shell story-opening progress while a file-backed story hydrates', async () => {
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStoryWordCountAsync')
			.mockResolvedValue(5);
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath: '/native/moon-castle.twine.rs'
		});

		await renderShell(story);

		expect(
			screen.getByRole('progressbar', {name: 'Opening story'})
		).toHaveTextContent('Loading passage text');
		expect(
			screen.getByRole('button', {name: /Loading passage text/})
		).toBeInTheDocument();
		expect(await screen.findByText('5 words')).toBeInTheDocument();
	});

	it('does not show story-opening progress from the library route', async () => {
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryStoryWordCountAsync')
			.mockResolvedValue(5);
		saveProjectMetadata(story.id, {
			rootPath: '/native/moon-castle.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath: '/native/moon-castle.twine.rs'
		});

		await renderShell(story, '/');

		expect(
			screen.queryByRole('progressbar', {name: 'Opening story'})
		).not.toBeInTheDocument();
		expect(screen.getByRole('button', {name: /Opening/})).toBeInTheDocument();
	});

	it('opens the global command palette and runs shell commands', async () => {
		await renderShell(story);

		fireEvent.keyDown(window, {key: 'k', metaKey: true});

		const input = await screen.findByLabelText('Command');

		fireEvent.change(input, {target: {value: 'play'}});
		fireEvent.keyDown(input, {key: 'Enter'});

		await waitFor(() => expect(mockPlayStory).toHaveBeenCalledWith(story.id));
		expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
	});

	it('opens the global command palette from the visible Command button', async () => {
		await renderShell(story);

		fireEvent.click(screen.getByRole('button', {name: 'Command'}));

		const input = await screen.findByLabelText('Command');

		await waitFor(() => expect(input).toHaveFocus());
		expect(screen.getByText('⌘ Enter')).toBeInTheDocument();
	});

	it('runs accessible keyboard shortcuts for shell commands', async () => {
		await renderShell(story);

		fireEvent.keyDown(window, {key: 'Enter', metaKey: true});

		await waitFor(() => expect(mockPlayStory).toHaveBeenCalledWith(story.id));
	});

	it('navigates to the first-class Build surface from commands', async () => {
		await renderShell(story);

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

	it('marks the Story Formats surface in shell navigation', async () => {
		await renderShell(story, '/formats');

		expect(screen.getByTitle('Story Formats')).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect(screen.getByText('Story Formats')).toBeInTheDocument();
	});

	it('marks the Settings surface in shell navigation', async () => {
		await renderShell(story, '/settings');

		expect(screen.getByTitle('Settings')).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect(screen.getAllByText('Settings').length).toBeGreaterThanOrEqual(1);
	});

	it('does not mark Workbench as current on the Preview route', async () => {
		await renderShell(story, `/stories/${story.id}/preview?target=test`);

		expect(screen.getByTitle('Workbench')).not.toHaveAttribute('aria-current');
	});

	it('keeps the current route when a dirty-buffer navigation flush fails', async () => {
		const flush = jest
			.spyOn(workbenchBufferCoordinator, 'flushAll')
			.mockRejectedValue(new Error('final edit could not be saved'));

		await renderShell(story);
		fireEvent.click(screen.getByTitle('Stories'));

		await waitFor(() => expect(flush).toHaveBeenCalled());
		expect(screen.getByTitle('Workbench')).toHaveAttribute(
			'aria-current',
			'page'
		);
		expect(
			await screen.findByTitle('final edit could not be saved')
		).toHaveTextContent('Save');
		flush.mockRestore();
	});

	it('reports persistence errors in the status bar', async () => {
		await renderShell(story);

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
		expect(status.closest('.app-shell__status-item')).toHaveClass(
			'app-shell__status-save--error'
		);
		expect(await screen.findByText('5 words')).toBeInTheDocument();
	});
});
