import {
	bootstrapStory,
	clearBootstrapStories,
	metadataStory,
	registerBootstrapStories
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
});
