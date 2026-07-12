import type {CoreAssetInventoryEntry, PatchBatch} from '..';
import {
	applyProjectPatchBatch,
	projectPatchBatchStoryActions
} from '../patch-applier';

function batch(patches: PatchBatch['patches']): PatchBatch {
	return {
		label: 'Rust Patches',
		patches,
		transactionId: BigInt(1)
	};
}

function asset(path: string): CoreAssetInventoryEntry {
	return {
		durationMs: null,
		exists: true,
		height: null,
		kind: 'image',
		missing: false,
		modifiedAt: null,
		normalizedPath: path,
		path,
		previewUrl: null,
		publish: {
			copy: true,
			outputPath: path,
			reason: 'Copy asset into published output'
		},
		referenceCount: 0,
		references: [],
		sizeBytes: null,
		snippet: {
			label: path,
			mediaType: 'image/png',
			text: `<img src="${path}" alt="">`
		},
		thumbnailUrl: null,
		unused: true,
		width: null
	};
}

describe('applyProjectPatchBatch', () => {
	it('turns story patches into reducer helper actions', () => {
		const patches = batch([
			{
				changes: {
					layout: null,
					name: 'Rust Name',
					tags: null,
					text: 'Rust text'
				},
				passage_id: 'passage-1',
				story_id: 'story-1',
				type: 'passageUpdated'
			},
			{
				changes: {
					name: 'Story From Rust',
					snapToGrid: null,
					storyFormat: null,
					storyFormatVersion: null,
					tagColors: null,
					tags: ['playable'],
					zoom: null
				},
				story_id: 'story-1',
				type: 'storyMetadataUpdated'
			},
			{
				passage_id: 'passage-1',
				story_id: 'story-1',
				type: 'startPassageChanged'
			}
		]);

		expect(projectPatchBatchStoryActions(patches)).toEqual([
			{
				passageId: 'passage-1',
				props: {name: 'Rust Name', text: 'Rust text'},
				storyId: 'story-1',
				type: 'updatePassage'
			},
			{
				props: {name: 'Story From Rust', tags: ['playable']},
				storyId: 'story-1',
				type: 'updateStory'
			},
			{
				props: {startPassage: 'passage-1'},
				storyId: 'story-1',
				type: 'updateStory'
			}
		]);
	});

	it('applies UI and asset effects while dispatching only story actions', () => {
		const cover = asset('assets/cover.png');
		const inventory = [cover];
		const dispatch = jest.fn();
		const sinks = {
			deleteAsset: jest.fn(),
			dispatch,
			renameAsset: jest.fn(),
			replaceAssetInventory: jest.fn(),
			setDirty: jest.fn(),
			upsertAsset: jest.fn()
		};
		const patches = batch([
			{dirty: true, type: 'dirtyStateChanged'},
			{asset: cover, story_id: 'story-1', type: 'assetImported'},
			{
				inventory,
				story_id: 'story-1',
				type: 'assetInventoryUpdated'
			},
			{
				changes: {layout: null, name: null, tags: null, text: 'patched'},
				passage_id: 'passage-1',
				story_id: 'story-1',
				type: 'passageUpdated'
			},
			{
				index: {
					assetInventory: [],
					assets: [],
					contents: [],
					diagnostics: [],
					files: [],
					graph: {
						brokenLinks: 0,
						emptyPassages: 0,
						links: 0,
						orphanPassages: 0,
						passages: 0,
						resolvedLinks: 0,
						selfLinks: 0,
						taggedPassages: 0,
						unreachablePassages: 0
					},
					replacePreviews: [],
					searchHits: [],
					storyId: 'story-1',
					symbols: [],
					tagEntries: [],
					tags: []
				},
				story_id: 'story-1',
				type: 'storyIndexUpdated'
			}
		]);

		const result = applyProjectPatchBatch(patches, sinks);

		expect(result).toEqual({dispatchedStoryActions: 1});
		expect(sinks.setDirty).toHaveBeenCalledWith(true);
		expect(sinks.upsertAsset).toHaveBeenCalledWith('story-1', cover);
		expect(sinks.replaceAssetInventory).toHaveBeenCalledWith(
			'story-1',
			inventory
		);
		expect(dispatch).toHaveBeenCalledWith({
			passageId: 'passage-1',
			props: {text: 'patched'},
			storyId: 'story-1',
			type: 'updatePassage'
		});
		expect(sinks.deleteAsset).not.toHaveBeenCalled();
		expect(sinks.renameAsset).not.toHaveBeenCalled();
	});

	it('keeps session-owned text out of the React story mirror', () => {
		const patches = batch([
			{
				changes: {layout: null, name: null, tags: null, text: 'patched'},
				passage_id: 'passage-1',
				story_id: 'story-1',
				type: 'passageUpdated'
			}
		]);
		const dispatchBatch = jest.fn();
		const actions = projectPatchBatchStoryActions(patches, {
			sessionOwnedDocumentsForStory: () => true
		});

		expect(actions).toEqual([]);
		applyProjectPatchBatch(
			patches,
			{
				deleteAsset: jest.fn(),
				dispatch: jest.fn(),
				dispatchBatch,
				dispatchEmptyBatch: true,
				renameAsset: jest.fn(),
				replaceAssetInventory: jest.fn(),
				setDirty: jest.fn(),
				upsertAsset: jest.fn()
			},
			actions
		);
		expect(dispatchBatch).toHaveBeenCalledWith([]);
	});
});
