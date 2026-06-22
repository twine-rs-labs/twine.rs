import {fakePassage, fakeStory} from '../../../test-util';
import {
	initialModeForStory,
	preferredModeForStory,
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

	it('opens mixed text and graph stories in split mode', () => {
		const story = fakeStory();

		story.passages = [
			fakePassage({height: 100, left: 120, text: 'Once', top: 80, width: 100}),
			fakePassage({height: 100, left: 320, text: 'Again', top: 80, width: 100})
		];

		expect(preferredModeForStory(story)).toBe('split');
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
		expect(initialModeForStory(story, 'split', 'graph', 'text')).toBe('split');
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
});
