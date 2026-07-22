// Handles importing HTML source code into story objects ready to be saved to
// the store. This works on both published story files and archives.
//
// It's important that this code be as efficient as possible, as it directly
// affects startup time in the Twine desktop app. This module moves data from
// the filesystem into local storage, and the app can't begin until it's done.

import {v4 as uuid} from '@lukeed/uuid';
import defaults from 'lodash/defaults';
import {
	passageDefaults,
	storyDefaults,
	PassageWithText as Passage,
	StoryWithDocuments as Story
} from '../store/stories';
import {
	applyStoryGraphMetadataToStory,
	parseStoryGraphHtmlAttribute,
	TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE
} from './story-graph-metadata';
import {
	assertHtmlImportWithinBudget,
	assertImportTextSize,
	maxImportStoryGraphMetadataBytes,
	maxImportTagColors,
	maxImportTagsPerPassage,
	maxImportTotalTags,
	maxImportTweeHeaderBytes
} from './import-limits';

/**
 * An imported story, which may contain incomplete or malformed data.
 */
export interface ImportedStory extends Omit<Partial<Story>, 'passages'> {
	passages: Partial<Passage>[];
}

export interface ImportStoriesAsyncOptions {
	/**
	 * How many passage elements to convert before yielding back to the browser.
	 * Smaller values are useful in tests; the default keeps import throughput high
	 * while preventing one huge story from monopolizing the main thread.
	 */
	passageBatchSize?: number;
}

interface HtmlParseBudget {
	tagCount: number;
}

/**
 * HTML selectors used to find data in HTML format.
 */
const selectors = {
	passage: 'tw-passage',
	story: 'tw-story',
	script: '[role=script]',
	stylesheet: '[role=stylesheet]',
	storyData: 'tw-storydata',
	tagColors: 'tw-tag',
	passageData: 'tw-passagedata'
};
const sugarCubeMacroSignalRegex =
	/<<(?:set|if|elseif|else|switch|case|default|for|capture|widget|button|link(?:append|prepend|replace)?|goto|include|display|print|run|script|style|audio|nobr|notify|timed|repeat|silently|remember|forget|done)\b|<<\/(?:if|for|widget|button|link(?:append|prepend|replace)?|nobr|silently|script|style|notify|timed|repeat)>>/i;
const sugarCubeSignalTags = new Set([
	'init',
	'nobr',
	'script',
	'stylesheet',
	'widget'
]);

/**
 * Convenience function to convert a string value to an float.
 */
function float(stringValue: string) {
	return parseFloat(stringValue);
}

/**
 * Convenience function to query an element by a selector.
 */
function query(el: Element, selector: string) {
	return Array.from(el.querySelectorAll(selector));
}

function yieldToBrowser() {
	if (typeof window === 'undefined') {
		return Promise.resolve();
	}

	const requestIdleCallback = (
		window as Window & {
			requestIdleCallback?: (callback: () => void) => number;
		}
	).requestIdleCallback;

	return new Promise<void>(resolve => {
		if (requestIdleCallback) {
			requestIdleCallback(resolve);
		} else {
			window.setTimeout(resolve, 0);
		}
	});
}

/**
 * Convenience function to parse a string like "100,50".
 */
function parseDimensions(raw: any): [string, string] | undefined {
	if (typeof raw !== 'string') {
		return undefined;
	}

	const separator = raw.indexOf(',');

	if (separator !== -1 && raw.indexOf(',', separator + 1) === -1) {
		return [raw.slice(0, separator), raw.slice(separator + 1)];
	}

	return undefined;
}

function parseTagAttribute(raw: string | null, budget: HtmlParseBudget) {
	if (!raw) {
		return [];
	}

	assertImportTextSize(raw, maxImportTweeHeaderBytes);
	const tags: string[] = [];
	let index = 0;

	while (index < raw.length) {
		while (index < raw.length && /\s/.test(raw[index])) {
			index++;
		}
		const start = index;

		while (index < raw.length && !/\s/.test(raw[index])) {
			index++;
		}
		if (index === start) {
			break;
		}
		if (tags.length >= maxImportTagsPerPassage) {
			throw new Error(
				`Import passage contains more than ${maxImportTagsPerPassage} tags.`
			);
		}
		budget.tagCount++;
		if (budget.tagCount > maxImportTotalTags) {
			throw new Error(
				`Import contains more than ${maxImportTotalTags.toLocaleString(
					'en-US'
				)} tags.`
			);
		}
		tags.push(raw.slice(start, index));
	}

	return tags;
}

function storyGraphMetadataFromElement(storyEl: Element) {
	const raw = storyEl.getAttribute(TWINE_RS_STORY_GRAPH_HTML_ATTRIBUTE);

	if (raw) {
		assertImportTextSize(raw, maxImportStoryGraphMetadataBytes);
	}

	return parseStoryGraphHtmlAttribute(raw);
}

function tagColorsFromElement(storyEl: Element) {
	const colors: Record<string, string> = {};
	const colorElements = query(storyEl, selectors.tagColors);

	if (colorElements.length > maxImportTagColors) {
		throw new Error(
			`Import contains more than ${maxImportTagColors.toLocaleString(
				'en-US'
			)} tag colors.`
		);
	}

	for (const element of colorElements) {
		const tagName = element.getAttribute('name');
		const color = element.getAttribute('color');

		if (tagName !== null && color !== null) {
			Object.defineProperty(colors, tagName, {
				configurable: true,
				enumerable: true,
				value: color,
				writable: true
			});
		}
	}

	return colors;
}

/**
 * Converts a DOM <tw-storydata> element to a story object matching the format
 * in the store. This *may* be missing data, or data it returns may be
 * malformed. This function does its best to reflect the contents of the
 * element.
 */
function storyShellFromDom(storyEl: Element, budget: HtmlParseBudget) {
	const startPassagePid = storyEl.getAttribute('startnode');
	const story: ImportedStory = {
		ifid: storyEl.getAttribute('ifid') ?? uuid().toUpperCase(),
		id: uuid(),
		lastUpdate: undefined,
		name: storyEl.getAttribute('name') ?? undefined,
		storyFormat: storyEl.getAttribute('format') ?? undefined,
		storyFormatVersion: storyEl.getAttribute('format-version') ?? undefined,
		script: query(storyEl, selectors.script)
			.map(el => el.textContent)
			.join('\n'),
		stylesheet: query(storyEl, selectors.stylesheet)
			.map(el => el.textContent)
			.join('\n'),
		tags: parseTagAttribute(storyEl.getAttribute('tags'), budget),
		zoom: parseFloat(storyEl.getAttribute('zoom') ?? '1'),
		tagColors: tagColorsFromElement(storyEl),
		passages: []
	};

	return {
		passageEls: query(storyEl, selectors.passageData),
		startPassagePid,
		story
	};
}

function passageFromDom(passageEl: Element, budget: HtmlParseBudget) {
	const position = parseDimensions(passageEl.getAttribute('position'));
	const size = parseDimensions(passageEl.getAttribute('size'));

	return {
		id: uuid(),
		left: position ? float(position[0]) : undefined,
		top: position ? float(position[1]) : undefined,
		width: size ? float(size[0]) : undefined,
		height: size ? float(size[1]) : undefined,
		tags: parseTagAttribute(passageEl.getAttribute('tags'), budget),
		name: passageEl.getAttribute('name') ?? undefined,
		text: passageEl.textContent ?? undefined
	};
}

function storyLooksLikeSugarCube(story: ImportedStory) {
	const sources = [
		story.script,
		story.stylesheet,
		...story.passages.map(passage => passage.text)
	].filter((source): source is string => typeof source === 'string');
	const hasSugarCubeTag = story.passages.some(
		passage =>
			Array.isArray(passage.tags) &&
			passage.tags.some(tag => sugarCubeSignalTags.has(tag.toLowerCase()))
	);

	return (
		hasSugarCubeTag ||
		sources.some(source => sugarCubeMacroSignalRegex.test(source))
	);
}

function inferMissingStoryFormat(story: ImportedStory): ImportedStory {
	if (
		typeof story.storyFormat === 'string' &&
		story.storyFormat.trim() !== ''
	) {
		return story;
	}

	if (storyLooksLikeSugarCube(story)) {
		return {
			...story,
			storyFormat: 'SugarCube'
		};
	}

	return story;
}

/**
 * Converts a DOM <tw-storydata> element to a story object matching the format
 * in the store. This *may* be missing data, or data it returns may be
 * malformed. This function does its best to reflect the contents of the
 * element.
 */
function domToObject(storyEl: Element, budget: HtmlParseBudget): ImportedStory {
	const {passageEls, startPassagePid, story} = storyShellFromDom(
		storyEl,
		budget
	);
	let startPassageId: string | undefined = undefined;

	story.passages = passageEls.map(passageEl => {
		const passage = passageFromDom(passageEl, budget);

		if (passageEl.getAttribute('pid') === startPassagePid) {
			startPassageId = passage.id;
		}

		return passage;
	});

	story.startPassage = startPassageId;
	return story;
}

async function domToObjectAsync(
	storyEl: Element,
	budget: HtmlParseBudget,
	options: ImportStoriesAsyncOptions = {}
): Promise<ImportedStory> {
	const {passageEls, startPassagePid, story} = storyShellFromDom(
		storyEl,
		budget
	);
	const passageBatchSize = Math.max(1, options.passageBatchSize ?? 250);
	let startPassageId: string | undefined = undefined;

	for (let index = 0; index < passageEls.length; index += passageBatchSize) {
		const batch = passageEls.slice(index, index + passageBatchSize);

		story.passages.push(
			...batch.map(passageEl => {
				const passage = passageFromDom(passageEl, budget);

				if (passageEl.getAttribute('pid') === startPassagePid) {
					startPassageId = passage.id;
				}

				return passage;
			})
		);

		if (index + passageBatchSize < passageEls.length) {
			await yieldToBrowser();
		}
	}

	story.startPassage = startPassageId;
	return story;
}

function finalizeImportedStory(
	importedStory: ImportedStory,
	storyGraphMetadata: ReturnType<typeof parseStoryGraphHtmlAttribute>,
	lastUpdateOverride?: Date
) {
	// Merge in defaults. We can't use object spreads here because undefined
	// values would override defaults.

	const story = defaults(
		inferMissingStoryFormat(importedStory),
		{id: uuid()},
		storyDefaults()
	) as unknown as Story;

	// Override the last update as requested.

	if (lastUpdateOverride) {
		story.lastUpdate = lastUpdateOverride;
	}

	// Merge in passage defaults. We don't need to set ID here--domToObject did
	// this for us.

	story.passages = story.passages.map(passage =>
		defaults(passage, passageDefaults(), {story: story.id})
	);
	applyStoryGraphMetadataToStory(story, storyGraphMetadata);

	return story;
}

function topLevelStoryElements(root: Element) {
	return query(root, selectors.storyData).filter(
		storyEl => !storyEl.parentElement?.closest(selectors.storyData)
	);
}

/**
 * Imports stories from HTML. If there are any missing attributes in the HTML,
 * defaults will be applied.
 */
export function importStories(
	html: string,
	lastUpdateOverride?: Date
): Story[] {
	assertHtmlImportWithinBudget(html);
	const nodes = document.createElement('div');
	const budget: HtmlParseBudget = {tagCount: 0};

	nodes.innerHTML = html;

	return topLevelStoryElements(nodes).map(storyEl => {
		const importedStory = domToObject(storyEl, budget);
		const storyGraphMetadata = storyGraphMetadataFromElement(storyEl);

		return finalizeImportedStory(
			importedStory,
			storyGraphMetadata,
			lastUpdateOverride
		);
	});
}

/**
 * Imports stories from HTML in chunks so large Twine archives yield back to the
 * browser between passage batches. This keeps app load/import flows responsive
 * until the Rust worker bridge owns HTML import end to end.
 */
export async function importStoriesAsync(
	html: string,
	lastUpdateOverride?: Date,
	options: ImportStoriesAsyncOptions = {}
): Promise<Story[]> {
	assertHtmlImportWithinBudget(html);
	await yieldToBrowser();

	const nodes = document.createElement('div');
	const budget: HtmlParseBudget = {tagCount: 0};

	nodes.innerHTML = html;

	const stories: Story[] = [];

	for (const storyEl of topLevelStoryElements(nodes)) {
		const storyGraphMetadata = storyGraphMetadataFromElement(storyEl);
		const importedStory = await domToObjectAsync(storyEl, budget, options);

		stories.push(
			finalizeImportedStory(
				importedStory,
				storyGraphMetadata,
				lastUpdateOverride
			)
		);
		await yieldToBrowser();
	}

	return stories;
}
