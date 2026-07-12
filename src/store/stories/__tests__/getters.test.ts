import {
	passageWithId,
	passageWithName,
	storyPassageTags,
	storyTags,
	storyWithId,
	storyWithName
} from '../getters';
import {fakePassage, fakeStory} from '../../../test-util';
import type {StoryWithDocuments as Story} from '../stories.types';

describe('passageWithId()', () => {
	let story: Story;

	beforeEach(() => (story = fakeStory(3)));

	it('returns the matching passage in a story', () =>
		expect(passageWithId([story], story.id, story.passages[0].id)).toBe(
			story.passages[0]
		));

	it('throws an error if there is no matching story', () =>
		expect(() =>
			passageWithId([story], story.id + 'nonexistent', story.passages[0].id)
		).toThrow());

	it('throws an error if there is no matching passage', () =>
		expect(() =>
			passageWithId([story], story.id, story.passages[0].id + 'nonexistent')
		).toThrow());
});

describe('passageWithName()', () => {
	let story: Story;

	beforeEach(() => (story = fakeStory(3)));

	it('returns the matching passage in a story', () =>
		expect(passageWithName([story], story.id, story.passages[0].name)).toBe(
			story.passages[0]
		));

	it('throws an error if there is no matching story', () =>
		expect(() =>
			passageWithName([story], story.id + 'nonexistent', story.passages[0].name)
		).toThrow());

	it('throws an error if there is no matching passage', () =>
		expect(() =>
			passageWithName([story], story.id, story.passages[0].name + 'nonexistent')
		).toThrow());
});

describe('storyPassageTags()', () => {
	it('returns a sorted array of unique tags across passages', () => {
		const story = fakeStory(2);

		story.passages[0].tags = ['c', 'a'];
		story.passages[1].tags = ['a', 'b'];

		expect(storyPassageTags(story)).toEqual(['a', 'b', 'c']);
	});

	it('ignores stories with no tags property', () => {
		const story = fakeStory(2);

		delete (story.passages[0] as any).tags;
		story.passages[1].tags = ['a'];
		expect(storyPassageTags(story)).toEqual(['a']);
	});
});

describe('storyTags()', () => {
	it('returns a sorted array of unique tags across stories', () => {
		const stories = [fakeStory(), fakeStory()];

		stories[0].tags = ['c', 'a'];
		stories[1].tags = ['a', 'b'];

		expect(storyTags(stories)).toEqual(['a', 'b', 'c']);
	});

	it('ignores stories with no tags property', () => {
		const stories = [fakeStory(), fakeStory()];

		delete (stories[0] as any).tags;
		stories[1].tags = ['a'];
		expect(storyTags(stories)).toEqual(['a']);
	});
});

describe('storyWithId()', () => {
	let story: Story;

	beforeEach(() => (story = fakeStory()));

	it('returns the matching story', () =>
		expect(storyWithId([fakeStory(), story, fakeStory()], story.id)).toBe(
			story
		));

	it('throws an error if there is no matching story', () =>
		expect(() => storyWithId([story], story.id + 'nonexistent')).toThrow());
});

describe('storyWithName()', () => {
	let story: Story;

	beforeEach(() => (story = fakeStory()));

	it('returns the matching story', () =>
		expect(storyWithName([fakeStory(), story, fakeStory()], story.name)).toBe(
			story
		));

	it('throws an error if there is no matching story', () =>
		expect(() => storyWithName([story], story.name + 'nonexistent')).toThrow());
});
