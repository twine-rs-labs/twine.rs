import {passageReplaceError, replaceInStoryCommand} from '../find-replace';
import {fakeStory} from '../../../../test-util';

describe('passageReplaceError', () => {
	it('rejects invalid regular expressions', () => {
		const story = fakeStory();

		expect(
			passageReplaceError(story.passages, '(', '', {useRegexes: true})
		).toEqual({error: 'invalidRegex'});
	});

	it('rejects empty and conflicting passage names', () => {
		const story = fakeStory(2);

		story.passages[0].name = 'a';
		story.passages[1].name = 'a1';
		expect(
			passageReplaceError(story.passages, '1', '', {
				includePassageNames: true
			})
		).toEqual({passage: story.passages[1], error: 'nameConflict'});

		story.passages = [story.passages[0]];
		expect(
			passageReplaceError(story.passages, 'a', '', {
				includePassageNames: true
			})
		).toEqual({passage: story.passages[0], error: 'emptyName'});
	});

	it('skips name validation when names are not included', () => {
		const story = fakeStory();

		story.passages[0].name = 'a';
		expect(
			passageReplaceError(story.passages, 'a', '', {
				includePassageNames: false
			})
		).toBeUndefined();
	});
});

describe('replaceInStoryCommand', () => {
	it('builds one Rust batch for passages, script, and stylesheet', () => {
		const story = fakeStory(2);

		story.passages[0].name = 'Coin';
		story.passages[0].text = 'Take coin';
		story.passages[1].name = 'End';
		story.passages[1].text = 'No match';
		story.script = 'const coin = 1;';
		story.stylesheet = '.coin {}';

		expect(
			replaceInStoryCommand(story, 'coin', 'gem', {
				includePassageNames: true
			})
		).toEqual({
			commands: [
				{
					changes: {
						layout: null,
						name: 'gem',
						tags: null,
						text: 'Take gem'
					},
					passage_id: story.passages[0].id,
					story_id: story.id,
					type: 'updatePassage',
					update_references: true
				},
				{
					script: 'const gem = 1;',
					story_id: story.id,
					type: 'updateStoryScript'
				},
				{
					story_id: story.id,
					stylesheet: '.gem {}',
					type: 'updateStoryStylesheet'
				}
			],
			type: 'batch'
		});
	});

	it('returns an empty no-op batch when nothing matches', () => {
		const story = fakeStory();

		expect(replaceInStoryCommand(story, 'missing', 'replacement', {})).toEqual({
			commands: [],
			type: 'batch'
		});
	});

	it('rejects an empty search', () => {
		expect(() => replaceInStoryCommand(fakeStory(), '', 'x', {})).toThrow();
	});
});
