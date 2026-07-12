import {
	bootstrapStory,
	bootstrapStoryPerformanceDiagnostics,
	clearBootstrapStories,
	metadataStory,
	registerBootstrapStories,
	releaseBootstrapStory
} from '../bootstrap-stories';
import {fakeStory} from '../../test-util';

describe('bootstrap stories', () => {
	afterEach(clearBootstrapStories);

	it('keeps full documents outside the metadata story', () => {
		const story = fakeStory(2);

		registerBootstrapStories([story]);
		const metadata = metadataStory(story);

		expect(bootstrapStory(story.id)).toBe(story);
		expect(metadata.passages).toHaveLength(story.passages.length);
		expect(metadata.passages.every(passage => !('text' in passage))).toBe(true);
		expect(metadata.script).toBe(story.script);
		expect(metadata.stylesheet).toBe(story.stylesheet);
	});

	it('reports and releases retained bootstrap documents', () => {
		const story = fakeStory(2);
		const textBytes = story.passages.reduce(
			(total, passage) => total + passage.text.length * 2,
			0
		);

		registerBootstrapStories([story]);
		expect(bootstrapStoryPerformanceDiagnostics()).toEqual({
			passageCount: 2,
			storyCount: 1,
			textBytes
		});
		releaseBootstrapStory(story.id);
		expect(bootstrapStory(story.id)).toBeUndefined();
		expect(bootstrapStoryPerformanceDiagnostics()).toEqual({
			passageCount: 0,
			storyCount: 0,
			textBytes: 0
		});
	});
});
