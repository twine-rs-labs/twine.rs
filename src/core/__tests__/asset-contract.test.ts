import {
	copyAssetSnippetCommand,
	deleteAssetCommand,
	importAssetCommand,
	insertAssetSnippetCommand,
	renameAssetCommand,
	replaceAssetCommand,
	revealAssetCommand,
	validateAssetReferencesCommand
} from '../index';
import {storyToCoreIndex} from '../story-index';
import {assetManagerViewModel} from '../view-models';
import {fakePassage, fakeStory} from '../../test-util';

describe('asset M5 contract', () => {
	it('creates host-first asset command shapes', () => {
		expect(importAssetCommand('story', '/tmp/cover.png')).toEqual({
			type: 'importAsset',
			overwrite: false,
			source_path: '/tmp/cover.png',
			story_id: 'story',
			target_path: null
		});
		expect(renameAssetCommand('story', 'assets/a.png', 'assets/b.png')).toEqual(
			{
				type: 'renameAsset',
				new_path: 'assets/b.png',
				path: 'assets/a.png',
				story_id: 'story',
				update_references: true
			}
		);
		expect(deleteAssetCommand('story', 'assets/a.png', true)).toEqual({
			type: 'deleteAsset',
			path: 'assets/a.png',
			remove_references: true,
			story_id: 'story'
		});
		expect(
			replaceAssetCommand('story', 'assets/a.png', '/tmp/new.png')
		).toEqual({
			type: 'replaceAsset',
			path: 'assets/a.png',
			source_path: '/tmp/new.png',
			story_id: 'story'
		});
		expect(revealAssetCommand('story', 'assets/a.png')).toEqual({
			type: 'revealAsset',
			path: 'assets/a.png',
			story_id: 'story'
		});
		expect(copyAssetSnippetCommand('story', 'assets/a.png')).toEqual({
			type: 'copyAssetSnippet',
			path: 'assets/a.png',
			snippet: null,
			story_id: 'story'
		});
		expect(
			insertAssetSnippetCommand('story', 'assets/a.png', 'passage', 12, {
				passageId: 'passage',
				snippet: '<img src="assets/a.png" alt="">'
			})
		).toEqual({
			type: 'insertAssetSnippet',
			passage_id: 'passage',
			path: 'assets/a.png',
			position: 12,
			snippet: '<img src="assets/a.png" alt="">',
			source_id: 'passage',
			story_id: 'story'
		});
		expect(validateAssetReferencesCommand('story')).toEqual({
			type: 'validateAssetReferences',
			story_id: 'story'
		});
	});

	it('feeds Asset Manager entries from inventory with reference fallback', () => {
		const story = fakeStory(0);

		story.passages = [
			fakePassage({
				id: 'start',
				name: 'Start',
				story: story.id,
				text: '<img src="assets/cover.png">'
			})
		];

		const referenceBacked = assetManagerViewModel(storyToCoreIndex(story));

		expect(referenceBacked.entries).toEqual([
			expect.objectContaining({
				exists: null,
				missing: false,
				path: 'assets/cover.png',
				referenceCount: 1,
				unused: false
			})
		]);

		const inventoryBacked = assetManagerViewModel(
			storyToCoreIndex(story, {
				knownAssets: [
					{
						...referenceBacked.entries[0].inventory,
						exists: true,
						sizeBytes: 2048,
						thumbnailUrl: 'file:///project/assets/cover.png'
					}
				]
			})
		);

		expect(inventoryBacked.entries).toEqual([
			expect.objectContaining({
				exists: true,
				path: 'assets/cover.png',
				referenceCount: 1,
				sizeBytes: 2048,
				thumbnailUrl: 'file:///project/assets/cover.png'
			})
		]);
	});
});
