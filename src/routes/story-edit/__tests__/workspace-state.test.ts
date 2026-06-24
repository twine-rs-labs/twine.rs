import {fakePassage, fakeStory} from '../../../test-util';
import {
	initialModeForStory,
	preferredModeForStory,
	readProjectWorkspaceForStory,
	setStoryEditScrollMemory
} from '../workspace-state';

describe('story edit workspace state', () => {
	beforeEach(() => window.localStorage.clear());

	afterAll(() => window.localStorage.clear());

	it('opens source-only stories in text mode', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 0, text: 'Once', top: 0, width: 100})
		];

		expect(preferredModeForStory(story)).toBe('text');
	});

	it('opens graph-backed stories in graph mode', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 120, text: '', top: 80, width: 100})
		];

		expect(preferredModeForStory(story)).toBe('graph');
	});

	it('opens mixed text and graph stories in graph mode', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 120, text: 'Once', top: 80, width: 100}),
			fakePassage({height: 100, left: 320, text: 'Again', top: 80, width: 100})
		];

		expect(preferredModeForStory(story)).toBe('graph');
	});

	it('uses project mode memory before the story preference', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 120, text: 'Once', top: 80, width: 100}),
			fakePassage({height: 100, left: 320, text: 'Again', top: 80, width: 100})
		];

		expect(initialModeForStory(story, 'graph', 'text')).toBe('graph');
	});

	it('uses the preferred editor mode before workspace mode memory', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 120, text: 'Once', top: 80, width: 100}),
			fakePassage({height: 100, left: 320, text: 'Again', top: 80, width: 100})
		];

		expect(initialModeForStory(story, undefined, 'graph', 'text')).toBe('text');
		expect(initialModeForStory(story, 'split', 'graph', 'text')).toBe('text');
	});

	it('ignores stale split workspace memory for graph-backed stories', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 120, text: 'Once', top: 80, width: 100}),
			fakePassage({height: 100, left: 320, text: 'Again', top: 80, width: 100})
		];

		expect(initialModeForStory(story, 'split', 'split')).toBe('graph');
		expect(initialModeForStory(story, undefined, 'split')).toBe('graph');
	});

	it('restores split workspace memory when open editor windows are present', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 120, text: 'Once', top: 80, width: 100}),
			fakePassage({height: 100, left: 320, text: 'Again', top: 80, width: 100})
		];

		expect(initialModeForStory(story, 'split', 'graph', 'auto', true)).toBe(
			'split'
		);
	});

	it('opens source-only stories in text mode before workspace mode memory', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 0, text: 'Once', top: 0, width: 100})
		];

		expect(initialModeForStory(story, undefined, 'graph')).toBe('text');
	});

	it('keeps per-mode scroll positions with project workspace state', () => {
		setStoryEditScrollMemory('story-1', 'graph', {left: 10, top: 20});
		setStoryEditScrollMemory('story-1', 'text', {left: 30, top: 40});

		expect(
			JSON.parse(
				window.localStorage.getItem('twine-story-edit-workspace-story-1')!
			).scrollByMode
		).toEqual({
			graph: {left: 10, top: 20},
			text: {left: 30, top: 40}
		});
	});

	it('sanitizes stale editor windows and graph workspace state on read', () => {
		const story = fakeStory(2);

		story.id = 'story-1';
		story.passages[0].id = 'start';
		story.passages[1].id = 'next';

		window.localStorage.setItem(
			'twine-story-edit-workspace-story-1',
			JSON.stringify({
				activeWindowId: 'passage:missing',
				editorDockLayout: 'stack',
				editorWindows: [
					{kind: 'passage', passageId: 'start'},
					{kind: 'passage', passageId: 'missing'},
					{kind: 'script'},
					{kind: 'script'},
					{kind: 'bogus'}
				],
				graphOptions: {
					density: 'names',
					focusSelection: true,
					layers: {broken: false, resolved: true, selfLinks: false},
					orientation: 'right',
					tool: 'pan'
				},
				graphView: {k: 1.4, x: -120, y: 80},
				mode: 'split'
			})
		);

		expect(readProjectWorkspaceForStory(story)).toEqual(
			expect.objectContaining({
				activeWindowId: 'passage:start',
				editorDockLayout: 'stack',
				editorWindows: [
					{kind: 'passage', passageId: 'start'},
					{kind: 'script'}
				],
				graphOptions: {
					density: 'names',
					focusSelection: true,
					layers: {broken: false, resolved: true, selfLinks: false},
					orientation: 'right',
					tool: 'pan'
				},
				graphView: {k: 1.4, x: -120, y: 80},
				mode: 'split'
			})
		);
	});

	it('ignores invalid editor dock layout memory', () => {
		const story = fakeStory(1);

		story.id = 'story-1';
		window.localStorage.setItem(
			'twine-story-edit-workspace-story-1',
			JSON.stringify({
				editorDockLayout: 'carousel'
			})
		);

		expect(
			readProjectWorkspaceForStory(story).editorDockLayout
		).toBeUndefined();
	});
});
