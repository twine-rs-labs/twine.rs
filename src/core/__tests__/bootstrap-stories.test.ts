import {
	bootstrapStory,
	bootstrapStoryPerformanceDiagnostics,
	clearBootstrapStories,
	metadataStory,
	registerBootstrapStories,
	registerStoryDocuments,
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

	it('registers an explicit document story while returning metadata only', () => {
		const story = fakeStory(2);
		story.passages[0].text = 'first registered body';
		story.passages[1].text = 'second registered body';

		const metadata = registerStoryDocuments(story);

		expect(metadata).toEqual(metadataStory(story));
		expect(metadata.passages.every(passage => !('text' in passage))).toBe(true);
		expect(bootstrapStory(story.id)).toBe(story);
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
