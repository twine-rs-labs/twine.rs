import type {CoreRect} from './bindings/CoreRect';
import type {PassageSnapshot} from './bindings/PassageSnapshot';
import type {ProjectSnapshot} from './bindings/ProjectSnapshot';
import type {StorySnapshot} from './bindings/StorySnapshot';
import type {PassageWithText, StoryWithDocuments} from '../store/stories';

function finiteLayout(passage: PassageWithText): CoreRect | null {
	const layout = {
		height: passage.height,
		left: passage.left,
		top: passage.top,
		width: passage.width
	};

	return Object.values(layout).every(Number.isFinite) &&
		layout.width > 0 &&
		layout.height > 0
		? layout
		: null;
}

export function passageToSnapshot(passage: PassageWithText): PassageSnapshot {
	return {
		id: passage.id,
		layout: finiteLayout(passage),
		name: passage.name,
		storyId: passage.story,
		tags: passage.tags,
		text: passage.text
	};
}

export function storyToSnapshot(story: StoryWithDocuments): StorySnapshot {
	return {
		id: story.id,
		ifid: story.ifid,
		name: story.name,
		passages: story.passages.map(passageToSnapshot),
		script: story.script,
		snapToGrid: story.snapToGrid,
		startPassageId: story.startPassage,
		storyFormat: story.storyFormat,
		storyFormatVersion: story.storyFormatVersion,
		stylesheet: story.stylesheet,
		tags: story.tags,
		tagColors: story.tagColors,
		zoom: story.zoom
	};
}

export function projectSnapshotFromStories(
	stories: StoryWithDocuments[],
	name = stories[0]?.name ?? 'Twine Project'
): ProjectSnapshot {
	return {
		dirty: false,
		name,
		schemaVersion: 2,
		stories: stories.map(storyToSnapshot)
	};
}
