import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import {MemoryRouter, useNavigate} from 'react-router';
import {
	diagnosticIdentity,
	replaceKnownAssetInventoryForStory,
	type CoreAssetInventoryEntry
} from '../../../core';
import type {CoreDiagnostic} from '../../../core/bindings/CoreDiagnostic';
import type {CoreDiagnosticsPage} from '../../../core/bindings/CoreDiagnosticsPage';
import type {RefactorPlanSummary} from '../../../core/bindings/RefactorPlanSummary';
import {StoreCoreProjectHost} from '../../../test-util/core-project-host-runtime';
import {
	FakeStateProvider,
	fakePassage,
	fakeStory,
	LocationInspector,
	StoryInspector,
	TestRoute
} from '../../../test-util';
import {DiagnosticsRoute} from '../diagnostics-route';
import {diagnosticFixReviewNavigationState} from '../diagnostic-fix-navigation';

const mockTestStory = jest.fn();

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(resolvePromise => {
		resolve = resolvePromise;
	});

	return {promise, resolve};
}

function coreDiagnostic(
	code: string,
	severity: CoreDiagnostic['severity'] = 'warning'
): CoreDiagnostic {
	return {
		code,
		end: 1,
		line: 1,
		message: `${code} diagnostic`,
		passageId: null,
		quickFixes: [],
		severity,
		sourceId: 'story.twee',
		start: 0
	};
}

function automaticDiagnostic(code: string, command: string): CoreDiagnostic {
	return {
		...coreDiagnostic(code),
		end: code.length,
		message: `${code} automatic diagnostic`,
		quickFixes: [
			{
				applicability: 'automatic',
				command,
				title: `Fix ${code}`
			}
		],
		start: code.length
	};
}

const RouteNavigator: React.FC<{storyId: string}> = ({storyId}) => {
	const navigate = useNavigate();

	return (
		<button
			onClick={() => navigate(`/stories/${storyId}/diagnostics`)}
			type="button"
		>
			Switch diagnostic story
		</button>
	);
};

jest.mock('../../../store/use-story-launch', () => ({
	useStoryLaunch: () => ({
		testStory: mockTestStory
	})
}));

function diagnosticStory() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Diagnostic Castle',
		selected: true
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		text: 'Go to [[Missing]].'
	});
	const isolated = fakePassage({
		id: 'isolated',
		name: 'Isolated',
		selected: false,
		story: story.id,
		text: 'No one links here.'
	});

	story.passages = [start, isolated];
	story.startPassage = start.id;
	return {isolated, start, story};
}

function renderComponent() {
	const {story} = diagnosticStory();
	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/diagnostics`]}>
				<TestRoute path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
					<StoryInspector id={story.id} />
				</TestRoute>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

function renderComponentWithLocation(
	configure?: (story: ReturnType<typeof diagnosticStory>['story']) => void
) {
	const {story} = diagnosticStory();

	configure?.(story);

	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/diagnostics`]}>
				<TestRoute path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
					<StoryInspector id={story.id} />
				</TestRoute>
				<LocationInspector />
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

function renderCleanComponent() {
	const story = {
		...fakeStory(0),
		id: 'story-id',
		name: 'Healthy Castle',
		script: '',
		selected: true,
		stylesheet: ''
	};
	const start = fakePassage({
		id: 'start',
		name: 'Start',
		selected: true,
		story: story.id,
		text: 'A quiet room.'
	});

	story.passages = [start];
	story.startPassage = start.id;

	const result = render(
		<FakeStateProvider stories={[story]}>
			<MemoryRouter initialEntries={[`/stories/${story.id}/diagnostics`]}>
				<TestRoute path="/stories/:storyId/diagnostics">
					<DiagnosticsRoute />
				</TestRoute>
			</MemoryRouter>
		</FakeStateProvider>
	);

	return {result, story};
}

function missingAsset(path: string): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: false,
		height: null,
		kind: 'image',
		missing: true,
		modifiedAt: null,
		normalizedPath: path,
		path,
		previewUrl: null,
		publish: {
			copy: false,
			outputPath: path,
			reason: 'Referenced file is missing'
		},
		referenceCount: 1,
		references: [
			{
				context: 'css-url',
				end: path.length,
				fragment: null,
				kind: 'stylesheet',
				line: 1,
				original: path,
				passageId: null,
				path,
				query: null,
				sourceId: 'stylesheet',
				sourceName: 'Story Stylesheet',
				start: 0
			}
		],
		sizeBytes: null,
		snippet: {
			label: 'Insert asset reference',
			mediaType: 'image',
			text: `<img src="${path}" alt="">`
		},
		thumbnailUrl: null,
		unused: false,
		width: null
	};
}

function diagnosticFixSummary(): RefactorPlanSummary {
	return {
		affectedEntityCount: 1,
		changeCount: 1,
		coverage: 'deterministic-safe-fixes',
		expiresAtEpochMs: Date.now() + 60_000,
		firstDetailCursor: {planDigest: 'digest', planId: 'plan', position: 0},
		operationKind: 'diagnostic-fixes',
		planDigest: 'digest',
		planId: 'plan',
		projectRevision: 1,
		selectionCapabilities: {
			all: true,
			exclusions: false,
			groups: false,
			only: false
		},
		validationFailures: []
	};
}

describe('<DiagnosticsRoute>', () => {
	beforeEach(() => {
		window.localStorage.clear();
		mockTestStory.mockReset();
		replaceKnownAssetInventoryForStory('story-id', []);
	});

	afterEach(() => jest.restoreAllMocks());

	it('groups diagnostics and exposes source/graph reveal actions', async () => {
		renderComponent();

		expect(
			await screen.findByLabelText('Filter diagnostics')
		).toBeInTheDocument();
		await waitFor(() =>
			expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0)
		);
		expect(
			screen.getByRole('button', {name: /Active\s+1/})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Warnings\s+1/})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Broken Links\s+1/})
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: /Dismissed\s+0/})).toBeDisabled();
		expect(
			screen.queryByRole('button', {name: /Errors/})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Info/})
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Missing Assets/})
		).not.toBeInTheDocument();
		expect(
			screen.getAllByText(/Broken link to "Missing"/).length
		).toBeGreaterThan(0);
		expect(
			screen.getByText(
				/Change link target\. This fix requires additional input\./
			)
		).toBeInTheDocument();
		expect(screen.queryByText('unreachable-passage')).not.toBeInTheDocument();
		expect(screen.queryByText(/story-format macros/)).not.toBeInTheDocument();
		expect(screen.getAllByText('warning').length).toBeGreaterThan(0);
		expect(
			screen.getByRole('button', {name: 'Reveal Source'})
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: 'Reveal Graph'})
		).toBeInTheDocument();

		fireEvent.change(screen.getByLabelText('Filter diagnostics'), {
			target: {value: 'nothing matches this'}
		});

		expect(screen.getByText('No matching diagnostics')).toBeInTheDocument();
		expect(
			screen.getByText('Try another severity, category, or search term.')
		).toBeInTheDocument();
	});

	it('shows a healthy empty state instead of empty diagnostic categories', async () => {
		renderCleanComponent();

		expect(
			await screen.findByText('No issues found — your story is healthy')
		).toBeInTheDocument();
		expect(
			screen.getByText(/Diagnostics check story structure/)
		).toBeInTheDocument();
		expect(
			screen.getByRole('button', {name: /Active\s+0/})
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: /Dismissed\s+0/})).toBeDisabled();
		expect(screen.queryByText('Severity')).not.toBeInTheDocument();
		expect(screen.queryByText('Type')).not.toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: /Broken Links/})
		).not.toBeInTheDocument();
	});

	it('shows an error and retries when the diagnostics query fails', async () => {
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockRejectedValueOnce(new Error('Worker unavailable'));

		renderCleanComponent();

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Diagnostics unavailable: Worker unavailable'
		);
		expect(
			screen.queryByText('Checking diagnostics...')
		).not.toBeInTheDocument();

		queryDiagnostics.mockResolvedValueOnce({
			diagnostics: [],
			nextCursor: null,
			revision: 1,
			storyId: 'story-id',
			totalCount: 0
		});
		fireEvent.click(screen.getByRole('button', {name: 'Retry Diagnostics'}));

		expect(
			await screen.findByText('No issues found — your story is healthy')
		).toBeInTheDocument();
		expect(queryDiagnostics).toHaveBeenCalledTimes(2);
	});

	it('loads additional diagnostics one bounded page at a time', async () => {
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValueOnce({
				diagnostics: [coreDiagnostic('FIRST')],
				nextCursor: 'page-2',
				revision: 1,
				storyId: 'story-id',
				totalCount: 2
			})
			.mockResolvedValueOnce({
				diagnostics: [coreDiagnostic('SECOND', 'error')],
				nextCursor: null,
				revision: 1,
				storyId: 'story-id',
				totalCount: 2
			});

		renderCleanComponent();

		expect((await screen.findAllByText('FIRST')).length).toBeGreaterThan(0);
		expect(screen.getByText(/1 of 2 loaded/)).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole('button', {name: 'Load more diagnostics'})
		);

		expect((await screen.findAllByText('SECOND')).length).toBeGreaterThan(0);
		expect(screen.getByText(/2 of 2 loaded/)).toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: 'Load more diagnostics'})
		).not.toBeInTheDocument();
		expect(queryDiagnostics).toHaveBeenNthCalledWith(1, 'story-id', {
			cursor: null,
			limit: 250
		});
		expect(queryDiagnostics).toHaveBeenNthCalledWith(2, 'story-id', {
			cursor: 'page-2',
			limit: 250
		});
	});

	it('continues a filtered search across unloaded diagnostics pages', async () => {
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValueOnce({
				diagnostics: [coreDiagnostic('FIRST')],
				nextCursor: 'page-2',
				revision: 1,
				storyId: 'story-id',
				totalCount: 2
			})
			.mockResolvedValueOnce({
				diagnostics: [coreDiagnostic('SECOND')],
				nextCursor: null,
				revision: 1,
				storyId: 'story-id',
				totalCount: 2
			});

		renderCleanComponent();
		await screen.findByLabelText('Filter diagnostics');
		fireEvent.change(screen.getByLabelText('Filter diagnostics'), {
			target: {value: 'SECOND'}
		});

		expect(
			screen.getByText('No matching diagnostics in loaded results')
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Load more diagnostics to continue searching this project.'
			)
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {name: 'Load more diagnostics'})
		);
		expect((await screen.findAllByText('SECOND')).length).toBeGreaterThan(0);
		expect(
			screen.queryByText('No matching diagnostics in loaded results')
		).not.toBeInTheDocument();
	});

	it('retains the loaded page when loading more fails and retries safely', async () => {
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValueOnce({
				diagnostics: [coreDiagnostic('FIRST')],
				nextCursor: 'page-2',
				revision: 1,
				storyId: 'story-id',
				totalCount: 2
			})
			.mockRejectedValueOnce(new Error('Worker unavailable'))
			.mockResolvedValueOnce({
				diagnostics: [coreDiagnostic('SECOND')],
				nextCursor: null,
				revision: 1,
				storyId: 'story-id',
				totalCount: 2
			});

		renderCleanComponent();
		expect((await screen.findAllByText('FIRST')).length).toBeGreaterThan(0);

		fireEvent.click(
			screen.getByRole('button', {name: 'Load more diagnostics'})
		);
		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not load more diagnostics: Worker unavailable'
		);
		expect(screen.getAllByText('FIRST').length).toBeGreaterThan(0);
		expect(screen.queryByText('SECOND')).not.toBeInTheDocument();

		fireEvent.click(
			screen.getByRole('button', {name: 'Load more diagnostics'})
		);
		expect((await screen.findAllByText('SECOND')).length).toBeGreaterThan(0);
		expect(screen.getAllByText('FIRST').length).toBeGreaterThan(0);
		expect(screen.getByText(/2 of 2 loaded/)).toBeInTheDocument();
		expect(queryDiagnostics).toHaveBeenCalledTimes(3);
	});

	it('does not render diagnostics owned by the previous route story', async () => {
		const nextPage = deferred<CoreDiagnosticsPage>();
		const first = diagnosticStory().story;
		const second = {
			...diagnosticStory().story,
			id: 'second-story',
			name: 'Second Castle'
		};
		second.passages = second.passages.map(passage => ({
			...passage,
			story: second.id
		}));
		second.startPassage = second.passages[0].id;

		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockImplementation(storyId =>
				storyId === first.id
					? Promise.resolve({
							diagnostics: [coreDiagnostic('FIRST-STORY')],
							nextCursor: null,
							revision: 1,
							storyId,
							totalCount: 1
						})
					: nextPage.promise
			);

		render(
			<FakeStateProvider stories={[first, second]}>
				<MemoryRouter initialEntries={[`/stories/${first.id}/diagnostics`]}>
					<RouteNavigator storyId={second.id} />
					<TestRoute path="/stories/:storyId/diagnostics">
						<DiagnosticsRoute />
					</TestRoute>
				</MemoryRouter>
			</FakeStateProvider>
		);

		expect((await screen.findAllByText('FIRST-STORY')).length).toBeGreaterThan(
			0
		);
		fireEvent.click(
			screen.getByRole('button', {name: 'Switch diagnostic story'})
		);

		expect(screen.queryByText('FIRST-STORY')).not.toBeInTheDocument();
		expect(
			await screen.findByText('Checking diagnostics...')
		).toBeInTheDocument();

		nextPage.resolve({
			diagnostics: [],
			nextCursor: null,
			revision: 1,
			storyId: second.id,
			totalCount: 0
		});
		expect(
			await screen.findByText('No issues found — your story is healthy')
		).toBeInTheDocument();
	});

	it('dismisses and restores a specific validation diagnostic', async () => {
		renderComponent();

		await waitFor(() =>
			expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0)
		);

		fireEvent.click(screen.getByRole('button', {name: 'Dismiss Diagnostic'}));

		await waitFor(() =>
			expect(screen.queryByText('broken-link')).not.toBeInTheDocument()
		);
		expect(screen.getByText('No active diagnostics')).toBeInTheDocument();
		expect(screen.queryByText('unreachable-passage')).not.toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: /Dismissed/}));

		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
		expect(
			screen.getByRole('button', {name: 'Restore Diagnostic'})
		).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Restore Diagnostic'}));

		await waitFor(() =>
			expect(screen.queryByText('broken-link')).not.toBeInTheDocument()
		);

		fireEvent.click(screen.getByRole('button', {name: /Active/}));

		expect(screen.getAllByText('broken-link').length).toBeGreaterThan(0);
	});

	it('reviews a Rust-planned quick fix before applying the whole plan', async () => {
		const summary = diagnosticFixSummary();
		const plan = jest
			.spyOn(StoreCoreProjectHost.prototype, 'planDiagnosticFixes')
			.mockResolvedValue({summary, type: 'complete'});
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryRefactorPlanDetailAsync')
			.mockResolvedValue({
				page: {
					changes: [
						{
							affectedEntity: {
								entityId: 'passage-2',
								kind: 'passage',
								storyId: 'story-id'
							},
							after: {
								passage: {
									id: 'passage-2',
									layout: null,
									name: 'Missing',
									storyId: 'story-id',
									tags: [],
									text: ''
								},
								type: 'passage'
							},
							before: null,
							changeId: 'change-1',
							dependencies: [],
							description: 'Create passage "Missing"',
							groupId: null,
							kind: 'add-passage',
							location: null
						}
					],
					nextCursor: null
				},
				type: 'page'
			});
		const apply = jest
			.spyOn(StoreCoreProjectHost.prototype, 'applyRefactorPlan')
			.mockResolvedValue({
				batch: {} as never,
				receipt: {} as never,
				type: 'applied'
			});

		renderComponent();
		fireEvent.click(
			await screen.findByRole('button', {name: 'Review Create "Missing"'})
		);

		expect(
			await screen.findByRole('dialog', {name: 'Review Diagnostic Fixes'})
		).toBeInTheDocument();
		expect(plan).toHaveBeenCalledWith('story-id', {
			selection: {
				fixes: [
					{
						diagnosticId: expect.any(String),
						quickFixCommand: 'create-passage:Missing'
					}
				],
				type: 'only'
			},
			storyId: 'story-id'
		});
		fireEvent.click(await screen.findByRole('button', {name: 'Apply Fixes'}));
		await waitFor(() =>
			expect(apply).toHaveBeenCalledWith('story-id', {
				expectedProjectRevision: 1,
				planId: 'plan',
				selection: {type: 'all'}
			})
		);
		await waitFor(() =>
			expect(
				screen.queryByRole('dialog', {name: 'Review Diagnostic Fixes'})
			).not.toBeInTheDocument()
		);
	});

	it('opens the exact contextual diagnostic and command from transient navigation state', async () => {
		const first = automaticDiagnostic('FIRST', 'create-passage:First');
		const second = automaticDiagnostic('SECOND', 'create-passage:Second');
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValue({
				diagnostics: [first, second],
				nextCursor: null,
				revision: 1,
				storyId: 'story-id',
				totalCount: 2
			});
		const plan = jest
			.spyOn(StoreCoreProjectHost.prototype, 'planDiagnosticFixes')
			.mockResolvedValue({
				failure: {code: 'invalid-plan', message: 'Captured exact request.'},
				type: 'failure'
			});
		const {story} = diagnosticStory();

		render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter
					initialEntries={[
						{
							pathname: `/stories/${story.id}/diagnostics`,
							state: diagnosticFixReviewNavigationState(
								second,
								'create-passage:Second'
							)
						}
					]}
				>
					<TestRoute path="/stories/:storyId/diagnostics">
						<DiagnosticsRoute />
					</TestRoute>
				</MemoryRouter>
			</FakeStateProvider>
		);

		await waitFor(() =>
			expect(plan).toHaveBeenCalledWith('story-id', {
				selection: {
					fixes: [
						{
							diagnosticId: diagnosticIdentity(second),
							quickFixCommand: 'create-passage:Second'
						}
					],
					type: 'only'
				},
				storyId: 'story-id'
			})
		);
		expect(plan).not.toHaveBeenCalledWith(
			'story-id',
			expect.objectContaining({
				selection: expect.objectContaining({
					fixes: expect.arrayContaining([
						expect.objectContaining({
							quickFixCommand: 'create-passage:First'
						})
					])
				})
			})
		);
	});

	it('does not fall back to another fix when contextual route state is stale', async () => {
		const available = automaticDiagnostic(
			'AVAILABLE',
			'create-passage:Available'
		);
		jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValue({
				diagnostics: [available],
				nextCursor: null,
				revision: 1,
				storyId: 'story-id',
				totalCount: 1
			});
		const plan = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'planDiagnosticFixes'
		);
		const {story} = diagnosticStory();
		const stale = automaticDiagnostic('STALE', 'create-passage:Stale');

		render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter
					initialEntries={[
						{
							pathname: `/stories/${story.id}/diagnostics`,
							state: diagnosticFixReviewNavigationState(
								stale,
								'create-passage:Stale'
							)
						}
					]}
				>
					<TestRoute path="/stories/:storyId/diagnostics">
						<DiagnosticsRoute />
					</TestRoute>
				</MemoryRouter>
			</FakeStateProvider>
		);

		expect((await screen.findAllByText('AVAILABLE')).length).toBeGreaterThan(0);
		await waitFor(() => expect(plan).not.toHaveBeenCalled());
	});

	it('stops contextual page discovery after a load error until explicit retry', async () => {
		const available = automaticDiagnostic(
			'AVAILABLE',
			'create-passage:Available'
		);
		const target = automaticDiagnostic('TARGET', 'create-passage:Target');
		const queryDiagnostics = jest
			.spyOn(StoreCoreProjectHost.prototype, 'queryDiagnosticsPageAsync')
			.mockResolvedValueOnce({
				diagnostics: [available],
				nextCursor: 'page-2',
				revision: 1,
				storyId: 'story-id',
				totalCount: 2
			})
			.mockRejectedValueOnce(new Error('Worker unavailable'));
		const plan = jest.spyOn(
			StoreCoreProjectHost.prototype,
			'planDiagnosticFixes'
		);
		const {story} = diagnosticStory();

		render(
			<FakeStateProvider stories={[story]}>
				<MemoryRouter
					initialEntries={[
						{
							pathname: `/stories/${story.id}/diagnostics`,
							state: diagnosticFixReviewNavigationState(
								target,
								'create-passage:Target'
							)
						}
					]}
				>
					<TestRoute path="/stories/:storyId/diagnostics">
						<DiagnosticsRoute />
					</TestRoute>
				</MemoryRouter>
			</FakeStateProvider>
		);

		expect(await screen.findByRole('alert')).toHaveTextContent(
			'Could not load more diagnostics: Worker unavailable'
		);
		await act(async () => Promise.resolve());
		expect(queryDiagnostics).toHaveBeenCalledTimes(2);
		expect(plan).not.toHaveBeenCalled();
		expect(
			screen.getByRole('button', {name: 'Load more diagnostics'})
		).toBeEnabled();
	});

	it('plans Fix All Safe from the complete non-dismissed set, not the visible filter', async () => {
		const plan = jest
			.spyOn(StoreCoreProjectHost.prototype, 'planDiagnosticFixes')
			.mockResolvedValue({
				failure: {code: 'invalid-plan', message: 'No automatic fixes.'},
				type: 'failure'
			});
		renderComponent();
		await screen.findByRole('button', {name: 'Review Create "Missing"'});
		fireEvent.change(screen.getByLabelText('Filter diagnostics'), {
			target: {value: 'nothing matches this'}
		});
		expect(screen.getByText('No matching diagnostics')).toBeInTheDocument();

		fireEvent.click(screen.getByRole('button', {name: 'Fix All Safe'}));

		await waitFor(() =>
			expect(plan).toHaveBeenCalledWith('story-id', {
				selection: {excludedDiagnosticIds: [], type: 'allSafe'},
				storyId: 'story-id'
			})
		);
	});

	it('tests the passage attached to the selected diagnostic', async () => {
		const {story} = renderComponent();

		fireEvent.click(
			await screen.findByRole('button', {name: 'Test From Here'})
		);

		expect(mockTestStory).toHaveBeenCalledWith(story.id, story.passages[0].id);
	});

	it('disables and marks the diagnostic test action while launch is pending', async () => {
		mockTestStory.mockReturnValueOnce(new Promise<void>(() => {}));
		renderComponent();
		const action = await screen.findByRole('button', {name: 'Test From Here'});

		fireEvent.click(action);

		expect(action).toBeDisabled();
		expect(action).toHaveAttribute('aria-busy', 'true');
	});

	it('reports failures when testing a selected diagnostic', async () => {
		const alertSpy = jest.spyOn(window, 'alert').mockImplementation(() => {});
		const consoleSpy = jest
			.spyOn(console, 'error')
			.mockImplementation(() => {});

		try {
			mockTestStory.mockRejectedValueOnce(new Error('Preview launch failed'));
			renderComponent();
			fireEvent.click(
				await screen.findByRole('button', {name: 'Test From Here'})
			);
			await waitFor(() =>
				expect(alertSpy).toHaveBeenCalledWith(
					'Could not open story preview (Preview launch failed).'
				)
			);
		} finally {
			alertSpy.mockRestore();
			consoleSpy.mockRestore();
		}
	});

	it('reveals stylesheet diagnostics with a source target instead of a passage fallback', async () => {
		const {story} = renderComponentWithLocation(story => {
			story.id = 'stylesheet-diagnostic-story';
			story.passages = story.passages.map(passage => ({
				...passage,
				story: story.id
			}));
			story.passages[0].text = 'No broken links here.';
			story.stylesheet = '.hero { background: url("assets/missing.png"); }';
			replaceKnownAssetInventoryForStory(story.id, [
				missingAsset('assets/missing.png')
			]);
		});

		await waitFor(() =>
			expect(screen.getAllByText('missing-asset').length).toBeGreaterThan(0)
		);

		fireEvent.click(screen.getByRole('button', {name: 'Reveal Source'}));

		await waitFor(() =>
			expect(screen.getByTestId('location')).toHaveAttribute(
				'data-pathname',
				`/stories/${story.id}`
			)
		);
		const query = new URLSearchParams(
			screen.getByTestId('location').getAttribute('data-search') ?? ''
		);
		expect(query.get('mode')).toBe('text');
		expect(query.get('source')).toBe('stylesheet');
		expect(query.get('passage')).toBeNull();
		expect(Number(query.get('offset'))).toBe(
			story.stylesheet.indexOf('assets/missing.png')
		);
	});
});
