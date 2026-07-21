import escape from 'lodash/escape';
import type {CoreAssetInventoryEntry} from '../core/bindings/CoreAssetInventoryEntry';
import {
	PassageWithText as Passage,
	StoryWithDocuments as Story
} from '../store/stories';
import {AppInfo} from './app-info';
import {i18n} from './i18n';
import type {AssetMode} from './inline-assets';
import {
	storyGraphMetadata,
	TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE
} from './story-graph-metadata';

export interface PublishOptions {
	/** Controls whether authoritative local media references remain external. */
	assetMode?: AssetMode;

	/**
	 * File-backed asset inventory from the core project host. When present, missing
	 * referenced assets block publish/preview output.
	 */
	assetInventory?: CoreAssetInventoryEntry[];

	/**
	 * Options that will be passed as-is to the format in the `options` attribute
	 * of the published `<tw-storydata>` tag.
	 */
	formatOptions?: string;

	/**
	 * Adds twine.rs graph metadata to StoryData for project-fidelity packages.
	 * Normal Twine compatibility exports leave this omitted by default while
	 * preserving standard passage position/size metadata.
	 */
	includeStoryGraph?: boolean;

	/**
	 * ID of the passage to start the story at. This overrides what is set at the
	 * story level.
	 */
	startId?: string;

	/**
	 * How a manually supplied startId should be reached. Test previews use
	 * "afterStartup" so story-format startup/init/widget passages can run before
	 * the selected passage renders.
	 */
	startMode?: 'afterStartup' | 'direct';

	/**
	 * If true, publishing will proceed even if the story has no starting passage
	 * set and one wasn't set manually.
	 */
	startOptional?: boolean;
}

export function assertAssetInventoryPublishable(
	assetInventory: CoreAssetInventoryEntry[] = []
) {
	const missingAssets = assetInventory.filter(asset => asset.missing);

	if (missingAssets.length === 0) {
		return;
	}

	throw new Error(
		`Cannot publish because ${
			missingAssets.length === 1
				? `asset "${missingAssets[0].path}" is missing`
				: `${missingAssets.length} referenced assets are missing`
		}.`
	);
}

/**
 * Returns a filename for an archive file.
 */
export function archiveFilename() {
	const timestamp = new Date().toLocaleString().replace(/[/:\\]/g, '.');

	return i18n.t('store.archiveFilename', {timestamp});
}

/**
 * Publishes an archive of stories, e.g. all stories in one file with no story
 * format binding.
 */
export function publishArchive(stories: Story[], appInfo: AppInfo) {
	return stories.reduce((output, story) => {
		// Force publishing even if there is no start point set.

		return (
			output + publishStory(story, appInfo, {startOptional: true}) + '\n\n'
		);
	}, '');
}

/**
 * Publishes a passage to an HTML fragment. This takes a id argument because
 * passages are numbered sequentially in published stories, not with a UUID.
 */
export function publishPassage(passage: Passage, localId: number) {
	return (
		`<tw-passagedata pid="${escape(localId.toString())}" ` +
		`name="${escape(passage.name)}" ` +
		`tags="${escape(passage.tags.join(' '))}" ` +
		`position="${passage.left},${passage.top}" ` +
		`size="${passage.width},${passage.height}">` +
		`${escape(passage.text)}</tw-passagedata>`
	);
}

function formatName(story: Story) {
	return story.storyFormat.trim().toLowerCase();
}

function uniquePassageName(story: Story, baseName: string) {
	const passageNames = new Set(story.passages.map(passage => passage.name));
	let result = baseName;
	let suffix = 2;

	while (passageNames.has(result)) {
		result = `${baseName} ${suffix++}`;
	}

	return result;
}

function quotedString(value: string) {
	return JSON.stringify(value);
}

function testStartPassageText(story: Story, target: Passage) {
	const targetName = quotedString(target.name);
	const format = formatName(story);

	if (format.includes('sugarcube')) {
		return `<<goto ${targetName}>>`;
	}

	if (format.includes('harlowe')) {
		return `(go-to: ${targetName})`;
	}

	if (format.includes('chapbook')) {
		return `[JavaScript]\nwindow.setTimeout(function() {\n\twindow.go(${targetName});\n}, 0);`;
	}

	if (format.includes('snowman')) {
		return `<% window.setTimeout(function() {\n\twindow.story.show(${targetName});\n}, 0); %>`;
	}
}

function testStartPassage(story: Story, target: Passage): Passage | undefined {
	const text = testStartPassageText(story, target);

	if (!text) {
		return;
	}

	return {
		...target,
		height: 100,
		id: '__twine_rs_test_start__',
		left: target.left,
		name: uniquePassageName(story, 'twine.rs Test Start'),
		selected: false,
		tags: [],
		text,
		top: target.top,
		width: 100
	};
}

/**
 * Does a "naked" publish of a story -- creating an HTML representation of it,
 * but without any story format binding.
 */
export function publishStory(
	story: Story,
	appInfo: AppInfo,
	{
		assetInventory,
		formatOptions,
		includeStoryGraph,
		startId,
		startMode = 'direct',
		startOptional
	}: PublishOptions = {}
) {
	assertAssetInventoryPublishable(assetInventory);

	const manualStartId = startId;

	startId = startId ?? story.startPassage;

	// Verify that the start passage exists.

	if (!startOptional) {
		if (!startId) {
			throw new Error(
				'There is no starting point set for this story and none was set manually.'
			);
		}

		if (!story.passages.find(p => p.id === startId)) {
			throw new Error(
				'The passage set as starting point for this story does not exist.'
			);
		}
	}

	// The id of the start passage as it is published (*not* a UUID).

	let startLocalId;
	let passageData = '';
	const startPassage =
		startId && story.passages.find(passage => passage.id === startId);
	const publishTestStartPassage =
		startMode === 'afterStartup' && manualStartId && startPassage
			? testStartPassage(story, startPassage)
			: undefined;

	story.passages.forEach((p, index) => {
		passageData += publishPassage(p, index + 1);

		if (!publishTestStartPassage && p.id === startId) {
			startLocalId = index + 1;
		}
	});

	if (publishTestStartPassage) {
		startLocalId = story.passages.length + 1;
		passageData += publishPassage(publishTestStartPassage, startLocalId);
	}

	const tagData = Object.keys(story.tagColors).reduce(
		(result, tag) =>
			result +
			`<tw-tag name="${escape(tag)}" color="${escape(
				story.tagColors[tag]
			)}"></tw-tag>`,
		''
	);

	return (
		`<tw-storydata name="${escape(story.name)}" ` +
		`startnode="${startLocalId || ''}" ` +
		`creator="${escape(appInfo.name)}" ` +
		`creator-version="${escape(appInfo.version)}" ` +
		`format="${escape(story.storyFormat)}" ` +
		`format-version="${escape(story.storyFormatVersion)}" ` +
		`ifid="${escape(story.ifid)}" ` +
		`options="${escape(formatOptions)}" ` +
		`tags="${escape(story.tags.join(' '))}" ` +
		`zoom="${escape(story.zoom.toString())}"` +
		(includeStoryGraph
			? ` ${TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE}="${escape(
					JSON.stringify(storyGraphMetadata(story))
				)}"`
			: '') +
		` hidden>` +
		`<style role="stylesheet" id="twine-user-stylesheet" ` +
		`type="text/twine-css">` +
		story.stylesheet +
		`</style>` +
		`<script role="script" id="twine-user-script" ` +
		`type="text/twine-javascript">` +
		story.script +
		`</script>` +
		tagData +
		passageData +
		`</tw-storydata>`
	);
}

/**
 * Publishes a story and binds it to the source of a story format.
 */
export function publishStoryWithFormat(
	story: Story,
	formatSource: string,
	appInfo: AppInfo,
	options: PublishOptions = {}
) {
	if (!formatSource) {
		throw new Error('Story format source cannot be empty.');
	}

	let output = formatSource;

	// We use function replacements to protect the data from accidental
	// interactions with the special string replacement patterns.

	output = output.replace(/{{STORY_NAME}}/g, () => escape(story.name));
	output = output.replace(/{{STORY_DATA}}/g, () =>
		publishStory(story, appInfo, options)
	);

	return output;
}
