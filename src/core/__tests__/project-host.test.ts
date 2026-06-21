import {
	deleteAssetCommand,
	importAssetCommand,
	insertAssetSnippetCommand,
	renameAssetCommand
} from '..';
import {StoreCoreProjectHost} from '../project-host';
import {reducer as storiesReducer} from '../../store/stories/reducer';
import {StoriesState} from '../../store/stories';
import {StoriesActionOrThunk} from '../../store/undoable-stories';
import {fakePassage, fakeStory} from '../../test-util';

describe('StoreCoreProjectHost asset commands', () => {
	function hostWithStory() {
		const story = fakeStory(0);
		const start = fakePassage({
			id: 'start',
			name: 'Start',
			story: story.id,
			text: ''
		});
		let stories: StoriesState = [{...story, passages: [start]}];
		const hostRef: {current?: StoreCoreProjectHost} = {};
		const applyAction = (action: StoriesActionOrThunk) => {
			if (typeof action === 'function') {
				action(applyAction, () => stories);
			} else {
				stories = storiesReducer(stories, action);
			}
		};
		const dispatch = jest.fn((action: StoriesActionOrThunk) => {
			applyAction(action);

			hostRef.current?.update(stories, dispatch);
		});
		const host = new StoreCoreProjectHost(stories, dispatch);

		hostRef.current = host;

		return {
			dispatch,
			get stories() {
				return stories;
			},
			host,
			start,
			story
		};
	}

	it('imports, inserts, renames, and deletes asset references through commands', () => {
		const context = hostWithStory();

		context.host.applyStoryCommand(
			importAssetCommand(context.story.id, '/tmp/cover.png', {
				targetPath: 'assets/cover.png'
			})
		);

		expect(
			context.host.queryStoryIndex(context.story.id).assetInventory
		).toEqual([
				expect.objectContaining({
					exists: true,
					path: 'assets/cover.png',
					thumbnailUrl: 'file:///tmp/cover.png',
					unused: true
				})
		]);

		context.host.applyStoryCommand(
			insertAssetSnippetCommand(
				context.story.id,
				'assets/cover.png',
				context.start.id,
				0,
				{passageId: context.start.id}
			)
		);

		expect(context.stories[0].passages[0].text).toContain(
			'<img src="assets/cover.png" alt="">'
		);

		context.host.applyStoryCommand(
			renameAssetCommand(
				context.story.id,
				'assets/cover.png',
				'assets/hero.png'
			)
		);

		expect(context.stories[0].passages[0].text).toContain('assets/hero.png');
		expect(
			context.host.queryStoryIndex(context.story.id).assetInventory
		).toEqual([
			expect.objectContaining({
				path: 'assets/hero.png',
				referenceCount: 1,
				unused: false
			})
		]);

		context.host.applyStoryCommand(
			deleteAssetCommand(context.story.id, 'assets/hero.png', true)
		);

		expect(context.stories[0].passages[0].text).not.toContain(
			'assets/hero.png'
		);
	});
});
