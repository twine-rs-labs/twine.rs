import {renderHook} from '@testing-library/react-hooks';
import * as React from 'react';
import {
	deleteAssetCommand,
	importAssetCommand,
	insertAssetSnippetCommand,
	queryGraphProjectionCommand,
	renameAssetCommand,
	renameStoryCommand,
	saveGeneratedLayoutCommand,
	setStoryFormatCommand,
	setStorySnapToGridCommand,
	setStoryZoomCommand
} from '..';
import {StoreCoreProjectHost, useCoreProjectHost} from '../project-host';
import {reducer as storiesReducer} from '../../store/stories/reducer';
import {StoriesContext, StoriesState} from '../../store/stories';
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

	it('publishes graph projection and layout save patches through commands', () => {
		const context = hostWithStory();
		const listener = jest.fn();

		context.host.subscribeToPatches(listener);
		context.host.applyStoryCommand(
			queryGraphProjectionCommand(context.story.id, {
				focus: null,
				layers: {broken: true, resolved: true, selfLinks: true},
				viewport: null
			})
		);
		expect(listener).toHaveBeenLastCalledWith(
			expect.objectContaining({
				patches: [
					expect.objectContaining({
						projection: expect.objectContaining({
							layoutState: 'saved',
							nodes: [expect.objectContaining({id: 'start'})]
						}),
						story_id: context.story.id,
						type: 'graphProjectionUpdated'
					})
				]
			})
		);

		context.host.applyStoryCommand(
			saveGeneratedLayoutCommand(context.story.id)
		);
		expect(listener).toHaveBeenLastCalledWith(
			expect.objectContaining({
				patches: [
					expect.objectContaining({
						projection: expect.objectContaining({layoutState: 'saved'}),
						story_id: context.story.id,
						type: 'layoutSaved'
					})
				]
			})
		);
	});

	it('applies story metadata commands through the host boundary', () => {
		const context = hostWithStory();

		context.host.applyStoryCommand(
			renameStoryCommand(context.story.id, 'Renamed Story')
		);
		context.host.applyStoryCommand(
			setStoryFormatCommand(context.story.id, 'Chapbook', '2.2.0')
		);
		context.host.applyStoryCommand(
			setStorySnapToGridCommand(context.story.id, false)
		);
		context.host.applyStoryCommand(setStoryZoomCommand(context.story.id, 0.6));

		expect(context.stories[0]).toEqual(
			expect.objectContaining({
				name: 'Renamed Story',
				snapToGrid: false,
				storyFormat: 'Chapbook',
				storyFormatVersion: '2.2.0',
				zoom: 0.6
			})
		);
		expect(
			(
				context.dispatch.mock.calls as unknown as Array<
					[StoriesActionOrThunk, string]
				>
			).map(call => call[1])
		).toEqual([
			'undoChange.renameStory',
			'undoChange.changeStoryDetails',
			'undoChange.changeStoryDetails',
			'undoChange.changeStoryDetails'
		]);
	});

	it('ignores stale worker graph caches after story updates', () => {
		const context = hostWithStory();
		const staleProjection = {stale: true};
		const fakeWasmClient = {
			cachedGraphProjection: jest.fn(
				(_storyId: string, _options: unknown, revision: number) =>
					revision === 1 ? staleProjection : undefined
			),
			enabled: true,
			lastGraphProjection: jest.fn()
		};

		(context.host as any).wasmClient = fakeWasmClient;

		expect(context.host.queryGraphProjection(context.story.id)).toBe(
			staleProjection
		);

		context.host.update(
			[{...context.stories[0], name: 'Updated'}],
			context.dispatch
		);

		expect(context.host.queryGraphProjection(context.story.id)).not.toBe(
			staleProjection
		);
		expect(fakeWasmClient.cachedGraphProjection).toHaveBeenLastCalledWith(
			context.story.id,
			expect.any(Object),
			2
		);
		expect(fakeWasmClient.lastGraphProjection).toHaveBeenLastCalledWith(
			context.story.id,
			2
		);
	});

	it('ignores stale worker story index caches after story updates', () => {
		const context = hostWithStory();
		const staleIndex = {storyId: context.story.id, stale: true};
		const fakeWasmClient = {
			cachedStoryIndex: jest.fn(
				(_storyId: string, _options: unknown, revision: number) =>
					revision === 1 ? staleIndex : undefined
			)
		};

		(context.host as any).wasmClient = fakeWasmClient;

		expect(context.host.queryStoryIndex(context.story.id)).toBe(staleIndex);

		context.host.update(
			[{...context.stories[0], name: 'Updated'}],
			context.dispatch
		);

		expect(context.host.queryStoryIndex(context.story.id)).not.toBe(staleIndex);
		expect(fakeWasmClient.cachedStoryIndex).toHaveBeenLastCalledWith(
			context.story.id,
			expect.any(Object),
			2
		);
	});
});

describe('useCoreProjectHost', () => {
	it('uses stories context when no undoable stories provider exists', () => {
		const story = fakeStory();
		const wrapper: React.FC = ({children}) =>
			React.createElement(
				StoriesContext.Provider,
				{value: {dispatch: jest.fn(), stories: [story]}},
				children
			);
		const {result} = renderHook(() => useCoreProjectHost(), {wrapper});

		expect(result.current.queryStoryIndex(story.id).storyId).toBe(story.id);
	});
});
