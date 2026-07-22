import {repairStory} from '../repair-story';
import * as repairPassage from '../repair-passage';
import {StoryWithDocuments as Story} from '../../../stories.types';
import {StoryFormat} from '../../../../story-formats';
import {fakeStory, fakeUnloadedStoryFormat} from '../../../../../test-util';

describe('repairStory', () => {
	let allFormats: StoryFormat[];
	let defaultFormat: StoryFormat;
	let story: Story;

	beforeEach(() => {
		jest.spyOn(console, 'info').mockReturnValue();
		defaultFormat = fakeUnloadedStoryFormat({
			name: 'default-format',
			version: '1.0.0'
		});
		allFormats = [defaultFormat, fakeUnloadedStoryFormat()];
		story = fakeStory(2);
		story.storyFormat = allFormats[1].name;
		story.storyFormatVersion = allFormats[1].version;
	});

	it('returns the story as-is if there is nothing wrong with it', () => {
		expect(repairStory(story, [story], allFormats, defaultFormat)).toBe(story);
	});

	it("sets the story's ID if it is undefined", () => {
		(story as any).id = undefined;

		const result = repairStory(story, [story], allFormats, defaultFormat);

		expect(result).toEqual({
			...story,
			id: expect.any(String),
			passages: story.passages.map(passage => ({
				...passage,
				story: expect.any(String)
			}))
		});
		expect(result.passages[0].story).toBe(result.id);
		expect(result.passages[1].story).toBe(result.id);
	});

	it("changes the story's ID if it conflicts with another story's", () => {
		const otherStory = fakeStory();

		story.id = otherStory.id;

		const result = repairStory(
			story,
			[story, otherStory],
			allFormats,
			defaultFormat
		);

		expect(result.id).not.toBe(otherStory.id);
	});

	it("sets the story's IFID if it is undefined", () => {
		(story as any).ifid = undefined;
		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			ifid: expect.any(String)
		});
	});

	it("sets the story's IFID if it is empty without changing its ID", () => {
		const originalId = story.id;

		story.ifid = '';
		const result = repairStory(story, [story], allFormats, defaultFormat);

		expect(result.id).toBe(originalId);
		expect(result.ifid).toEqual(expect.any(String));
		expect(result.ifid).not.toBe('');
	});

	it("preserves the story's IFID when repairing an empty ID", () => {
		const originalIfid = story.ifid;

		story.id = '';
		story.passages = [];
		const result = repairStory(story, [story], allFormats, defaultFormat);

		expect(result.id).toEqual(expect.any(String));
		expect(result.id).not.toBe('');
		expect(result.ifid).toBe(originalIfid);
	});

	it('sets a default on a story property if it is undefined', () => {
		(story as any).name = undefined;
		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			name: expect.any(String)
		});
	});

	it('sets a default on a story property if it is the wrong type', () => {
		(story as any).name = 1;
		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			name: expect.any(String)
		});
	});

	it('sets a default on a numeric story property if it is not a finite number', () => {
		(story as any).zoom = NaN;
		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			zoom: 1
		});
		(story as any).zoom = Infinity;
		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			zoom: 1
		});
	});

	it('assigns the default story format to a story if it is unset', () => {
		(story as any).storyFormat = undefined;

		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			storyFormat: defaultFormat.name,
			storyFormatVersion: defaultFormat.version
		});
	});

	it('canonicalizes the story format name if it matches installed formats', () => {
		allFormats[1].name = 'SugarCube';
		allFormats[1].version = '2.36.1';
		story.storyFormat = ' sugarcube ';
		story.storyFormatVersion = '2.36.1';

		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			storyFormat: 'SugarCube'
		});
	});

	it('repairs an obvious SugarCube story that was mislabeled as Harlowe', () => {
		defaultFormat.name = 'Harlowe';
		defaultFormat.version = '3.3.9';
		allFormats[1].name = 'SugarCube';
		allFormats[1].version = '2.36.1';
		story.storyFormat = 'Harlowe';
		story.storyFormatVersion = '3.3.9';
		story.passages[0].text = '<<set $visited to true>>';

		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			storyFormat: 'SugarCube',
			storyFormatVersion: '2.36.1'
		});
	});

	it('repairs a lazy SugarCube story shell from SugarCube passage tags', () => {
		defaultFormat.name = 'Harlowe';
		defaultFormat.version = '3.3.9';
		allFormats[1].name = 'SugarCube';
		allFormats[1].version = '2.36.1';
		story.storyFormat = 'Harlowe';
		story.storyFormatVersion = '3.3.9';
		story.passages[0].tags = ['widget'];
		story.passages[0].text = '';

		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			storyFormat: 'SugarCube',
			storyFormatVersion: '2.36.1'
		});
	});

	it('preserves SugarCube if the installed format list is temporarily incomplete', () => {
		allFormats = [defaultFormat];
		story.storyFormat = 'SugarCube';
		story.storyFormatVersion = '2.37.3';

		expect(repairStory(story, [story], allFormats, defaultFormat)).toBe(story);
	});

	it('preserves the version from SugarCube local/offline imports', () => {
		allFormats[1].name = 'SugarCube';
		allFormats[1].version = '2.35.0';
		story.storyFormat = 'SugarCube 2 (local/offline)';
		story.storyFormatVersion = '2.35.0';

		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			storyFormat: 'SugarCube'
		});
	});

	it('preserves a bundled format name when its version is unavailable', () => {
		allFormats = [defaultFormat];
		story.storyFormat = 'sugarcube';
		(story as any).storyFormatVersion = undefined;

		expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
			...story,
			storyFormat: 'SugarCube',
			storyFormatVersion: ''
		});
	});

	describe("when the story's story format does not exist", () => {
		it('assigns it the newest matching format when the version is unset', () => {
			allFormats[1].name = 'SugarCube';
			allFormats[1].version = '2.36.1';
			story.storyFormat = 'SugarCube';
			(story as any).storyFormatVersion = undefined;

			expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
				...story,
				storyFormat: 'SugarCube',
				storyFormatVersion: '2.36.1'
			});
		});

		it('assigns it one that matches semver', () => {
			allFormats[1].version = '1.2.0';
			story.storyFormatVersion = '1.1.0';

			expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
				...story,
				storyFormatVersion: allFormats[1].version
			});
		});

		it('keeps the named format if none of its versions match semver', () => {
			allFormats[1].version = '2.0.0';
			story.storyFormatVersion = '1.1.0';

			expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
				...story,
				storyFormatVersion: allFormats[1].version
			});
		});

		it('assigns the default format if no installed format name matches', () => {
			story.storyFormat = 'missing-format';
			story.storyFormatVersion = '1.1.0';

			expect(repairStory(story, [story], allFormats, defaultFormat)).toEqual({
				...story,
				storyFormat: defaultFormat.name,
				storyFormatVersion: defaultFormat.version
			});
		});
	});

	it('repairs all passages', () => {
		const repairSpy = jest.spyOn(repairPassage, 'repairPassage');

		repairStory(story, [story], allFormats, defaultFormat);
		expect(repairSpy.mock.calls).toEqual([
			[story.passages[0], story],
			[story.passages[1], story]
		]);
	});
});
