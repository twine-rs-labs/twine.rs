import {v4 as uuid} from '@lukeed/uuid';
import sortBy from 'lodash/sortBy';
import {
	PassageWithText as Passage,
	passageDefaults,
	StoryWithDocuments as Story,
	storyDefaults
} from '../store/stories';
import {unusedName} from './unused-name';
import {
	addStoryGraphToStoryData,
	applyStoryGraphMetadataToStory,
	storyGraphFromStoryData
} from './story-graph-metadata';
import {
	assertImportTextSize,
	assertTweePassageCount,
	maxImportPassageBytes,
	maxImportTagColors,
	maxImportTagsPerPassage,
	maxImportTotalTags,
	maxImportTweeHeaderBytes
} from './import-limits';

function characterIsEscaped(value: string, index: number) {
	let slashCount = 0;

	for (let slashIndex = index - 1; slashIndex >= 0; slashIndex--) {
		if (value[slashIndex] !== '\\') {
			break;
		}
		slashCount++;
	}

	return slashCount % 2 === 1;
}

function trailingBlockStart(
	value: string,
	endIndex: number,
	opening: string,
	closing: string,
	honorJsonStrings: boolean
) {
	let depth = 0;
	let inString = false;

	for (let index = endIndex; index >= 0; index--) {
		const character = value[index];

		if (
			(character === opening ||
				character === closing ||
				(honorJsonStrings && character === '"')) &&
			characterIsEscaped(value, index)
		) {
			continue;
		}
		if (honorJsonStrings && character === '"') {
			inString = !inString;
			continue;
		}
		if (inString) {
			continue;
		}
		if (character === closing) {
			depth++;
		} else if (character === opening) {
			depth--;
			if (depth === 0) {
				return index;
			}
		}
	}

	return undefined;
}

interface TweeParseBudget {
	tagCount: number;
}

function parseTweeTags(rawTags: string, budget: TweeParseBudget) {
	const tags: string[] = [];
	let index = 1;

	while (index < rawTags.length - 1) {
		while (index < rawTags.length - 1 && /\s/.test(rawTags[index])) {
			index++;
		}
		const start = index;

		while (index < rawTags.length - 1 && !/\s/.test(rawTags[index])) {
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
		tags.push(unescapeForTweeHeader(rawTags.slice(start, index)));
	}

	return tags;
}

function trimHeaderName(value: string) {
	let start = 0;
	let end = value.length;

	while (start < end && /\s/.test(value[start])) {
		start++;
	}
	while (
		end > start &&
		/\s/.test(value[end - 1]) &&
		!characterIsEscaped(value, end - 1)
	) {
		end--;
	}

	return value.slice(start, end);
}

function parseTweeHeader(headerLine: string) {
	if (!headerLine.startsWith('::')) {
		return undefined;
	}

	const header = headerLine.slice(2);
	let hasSuffixBlock = false;
	let suffixEnd = header.length - 1;
	let rawMetadata: string | undefined;
	let rawTags: string | undefined;

	while (suffixEnd >= 0 && /\s/.test(header[suffixEnd])) {
		suffixEnd--;
	}
	if (header[suffixEnd] === '}' && !characterIsEscaped(header, suffixEnd)) {
		const metadataStart = trailingBlockStart(header, suffixEnd, '{', '}', true);

		if (metadataStart !== undefined) {
			hasSuffixBlock = true;
			rawMetadata = header.slice(metadataStart, suffixEnd + 1);
			suffixEnd = metadataStart - 1;
			while (suffixEnd >= 0 && /\s/.test(header[suffixEnd])) {
				suffixEnd--;
			}
		}
	}
	if (header[suffixEnd] === ']' && !characterIsEscaped(header, suffixEnd)) {
		const tagsStart = trailingBlockStart(header, suffixEnd, '[', ']', false);

		if (tagsStart !== undefined) {
			hasSuffixBlock = true;
			rawTags = header.slice(tagsStart, suffixEnd + 1);
			suffixEnd = tagsStart - 1;
		}
	}

	return {
		rawMetadata,
		rawName: trimHeaderName(
			header.slice(0, hasSuffixBlock ? suffixEnd + 1 : header.length)
		),
		rawTags
	};
}

/**
 * Escapes characters with special meanings in a Twee passage header (brackets,
 * curly quotes, and backslashes).
 */
export function escapeForTweeHeader(value: string) {
	return value.replace(/\\/g, '\\\\').replace(/([[\]{}])/g, '\\$1');
}

/**
 * Escapes characters that would disrupt parsing of passage text, i.e. `::` at
 * the start of a line.
 */
export function escapeForTweeText(value: string) {
	return value.replace(/^::/gm, '\\::');
}

/**
 * Converts a single passage to Twee.
 */
export function passageToTwee(passage: Passage) {
	const escapedName = escapeForTweeHeader(passage.name)
		.replace(/^\s+/g, match => '\\ '.repeat(match.length))
		.replace(/\s+$/g, match => '\\ '.repeat(match.length));
	const tags =
		passage.tags.length > 0
			? `[${passage.tags.map(escapeForTweeHeader).join(' ')}]`
			: undefined;
	const metadata = JSON.stringify({
		position: `${passage.left},${passage.top}`,
		size: `${passage.width},${passage.height}`
	}).replace(/\s+/g, '');
	const escapedText = escapeForTweeText(passage.text);

	return `:: ${escapedName}${
		tags ? ' ' + tags : ''
	} ${metadata}\n${escapedText}\n`;
}

/**
 * Converts Twee source to a passage. If it can't be parsed, then an error is
 * thrown. If it can partially parse the passage, it will do so.
 */
export function passageFromTwee(
	source: string,
	budget: TweeParseBudget = {tagCount: 0}
): Omit<Passage, 'story'> {
	assertImportTextSize(source, maxImportPassageBytes);
	const firstLinebreak = source.indexOf('\n');
	const headerLine = (
		firstLinebreak === -1 ? source : source.slice(0, firstLinebreak)
	).replace(/\r$/, '');
	const passageText =
		firstLinebreak === -1 ? '' : source.slice(firstLinebreak + 1);

	assertImportTextSize(headerLine, maxImportTweeHeaderBytes);

	const headerBits = parseTweeHeader(headerLine);

	if (!headerBits) {
		throw new Error(`Header line couldn't be parsed: ${headerLine}`);
	}

	const {rawMetadata, rawName, rawTags} = headerBits;

	if (rawName.trim() === '') {
		throw new Error(
			`Passage name couldn't be found in header line: ${headerLine}`
		);
	}

	const passage: Omit<Passage, 'story'> = {
		...passageDefaults(),
		id: uuid(),
		name: unescapeForTweeHeader(
			rawName
				.replace(/^(\\\s)+/g, match => ' '.repeat(match.length / 2))
				.replace(/(\\\s)+$/g, match => ' '.repeat(match.length / 2))
		),
		tags: [],
		text: unescapeForTweeText(passageText.replace(/\r\n/g, '\n')).trim()
	};

	if (rawTags) {
		passage.tags = parseTweeTags(rawTags, budget);
	}

	if (rawMetadata) {
		// Try to parse it as JSON.

		try {
			const metadata = JSON.parse(rawMetadata);

			if (typeof metadata.position === 'string') {
				const [left, top] = metadata.position.split(',').map(parseFloat);

				if (typeof left === 'number' && typeof top === 'number') {
					passage.left = left;
					passage.top = top;
				} else {
					console.warn(
						`Couldn't parse passage position metadata ${metadata.position}`
					);
				}
			}

			if (typeof metadata.size === 'string') {
				const [width, height] = metadata.size.split(',').map(parseFloat);

				if (typeof width === 'number' && typeof height === 'number') {
					passage.width = width;
					passage.height = height;
				} else {
					console.warn(`Couldn't parse passage size metadata ${metadata.size}`);
				}
			}
		} catch (error) {
			console.warn(`Couldn't parse passage metadata ${rawMetadata}`);
		}
	}

	return passage;
}

/**
 * Converts a story from Twee source.
 */
export function storyFromTwee(source: string) {
	assertImportTextSize(source);
	assertTweePassageCount(source);
	const id = uuid();
	const budget: TweeParseBudget = {tagCount: 0};
	let legacyStoryGraphMetadata: unknown;
	let storyDataGraphMetadata: unknown;

	const story: Story = {
		...storyDefaults(),
		id,
		ifid: uuid().toUpperCase(),
		lastUpdate: new Date(),
		passages: source
			.split(/^::/m)
			.filter(s => s.trim() !== '')
			.map(s => ':: ' + s)
			.map(passage => passageFromTwee(passage, budget))
			.map(passage => ({...passage, story: id})),
		script: ''
	};

	// Remove all passages with a script or stylesheet tags and put them in the
	// story's properties instead.
	const scriptPassages: string[] = [];
	const stylesheetPassages: string[] = [];

	story.passages = story.passages.filter(passage => {
		const isScript = passage.tags.includes('script');
		const isStylesheet = passage.tags.includes('stylesheet');

		// If the passage has neither *or* both tags, treat it as normal. Behavior
		// when a passage is tagged with both is not currently spec'd, but let's
		// assume the user is confused.

		if ((!isScript && !isStylesheet) || (isScript && isStylesheet)) {
			return true;
		}

		if (isScript) {
			scriptPassages.push(passage.text);
		} else if (isStylesheet) {
			stylesheetPassages.push(passage.text);
		}

		return false;
	});

	// Trim any extra whitespace in the script and stylesheet we created above.

	story.script = scriptPassages.join('\n').trim();
	story.stylesheet = stylesheetPassages.join('\n').trim();

	// If there is a StoryTitle passage, remove it and set the story name.

	const titlePassageIndex = story.passages.findIndex(
		passage => passage.name === 'StoryTitle'
	);

	if (titlePassageIndex !== -1) {
		story.name = story.passages[titlePassageIndex].text.trim();
		story.passages.splice(titlePassageIndex, 1);
	}

	// If there is a StoryData passage, remove it and apply properties contained
	// there.

	const dataPassageIndex = story.passages.findIndex(
		passage => passage.name === 'StoryData'
	);

	if (dataPassageIndex !== -1) {
		const dataPassage = story.passages[dataPassageIndex];
		let storyData: Record<string, unknown> | undefined;

		story.passages.splice(dataPassageIndex, 1);

		try {
			const parsedStoryData: unknown = JSON.parse(dataPassage.text);

			if (
				typeof parsedStoryData === 'object' &&
				parsedStoryData !== null &&
				!Array.isArray(parsedStoryData)
			) {
				storyData = parsedStoryData as Record<string, unknown>;
			} else {
				console.warn(`Couldn't parse story data: ${dataPassage.text}`);
			}
		} catch (error) {
			console.warn(`Couldn't parse story data: ${dataPassage.text}`);
		}

		if (storyData) {
			const {
				ifid,
				format,
				'format-version': formatVersion,
				start,
				'tag-colors': tagColors,
				zoom
			} = storyData;

			storyDataGraphMetadata = storyGraphFromStoryData(storyData);

			if (typeof ifid === 'string') {
				story.ifid = ifid;
			}

			if (typeof format === 'string') {
				story.storyFormat = format;
			}

			if (typeof formatVersion === 'string') {
				story.storyFormatVersion = formatVersion;
			}

			if (typeof start === 'string') {
				const startPassage = story.passages.find(
					passage => passage.name === start
				);

				if (startPassage) {
					story.startPassage = startPassage.id;
				} else {
					console.warn(`Couldn't find start passage with name "${start}"`);
				}
			}

			if (
				typeof tagColors === 'object' &&
				tagColors !== null &&
				!Array.isArray(tagColors)
			) {
				const tagNames = Object.keys(tagColors);

				if (tagNames.length > maxImportTagColors) {
					throw new Error(
						`Import contains more than ${maxImportTagColors.toLocaleString(
							'en-US'
						)} tag colors.`
					);
				}

				for (const tagName of tagNames) {
					const color = (tagColors as Record<string, unknown>)[tagName];

					if (typeof color === 'string') {
						Object.defineProperty(story.tagColors, tagName, {
							configurable: true,
							enumerable: true,
							value: color,
							writable: true
						});
					} else {
						console.warn(`Tag "${tagName}" has non-string color`);
					}
				}
			}

			if (typeof zoom === 'number') {
				story.zoom = zoom;
			}
		}
	} else {
		console.warn('No StoryData passage is present in Twee');
	}

	const storyGraphPassageIndex = story.passages.findIndex(
		passage =>
			passage.name === 'StoryGraph' && passage.tags.includes('metadata')
	);

	if (storyGraphPassageIndex !== -1) {
		const storyGraphPassage = story.passages[storyGraphPassageIndex];

		story.passages.splice(storyGraphPassageIndex, 1);

		try {
			legacyStoryGraphMetadata = JSON.parse(storyGraphPassage.text);
		} catch (error) {
			console.warn(
				`Couldn't parse StoryGraph metadata: ${storyGraphPassage.text}`
			);
		}
	}

	applyStoryGraphMetadataToStory(
		story,
		storyDataGraphMetadata ?? legacyStoryGraphMetadata
	);

	// Detect old Twee format, which would have no passage metadata, and put
	// passages in a grid.

	if (story.passages.every(({left, top}) => left === 0 && top === 0)) {
		story.passages = story.passages.map((passage, index) => ({
			...passage,
			left: 25 + 125 * (index % 10),
			top: 25 + 125 * Math.floor(index / 10)
		}));
	}

	return story;
}

export interface StoryToTweeOptions {
	/**
	 * Adds twine.rs graph metadata to StoryData for project-fidelity round trips.
	 * Standard passage position/size metadata is still emitted for compatibility.
	 */
	includeStoryGraph?: boolean;
}

/**
 * Converts a story to Twee.
 */
export function storyToTwee(story: Story, options: StoryToTweeOptions = {}) {
	const storyTitle = `:: StoryTitle\n${escapeForTweeText(story.name)}`;
	const startPassage = story.passages.find(p => p.id === story.startPassage);
	const storyDataPayload: Record<string, unknown> = {
		ifid: story.ifid,
		format: story.storyFormat,
		'format-version': story.storyFormatVersion,
		start: startPassage?.name,
		'tag-colors':
			Object.keys(story.tagColors).length > 0 ? story.tagColors : undefined,
		zoom: story.zoom
	};
	const storyData = `:: StoryData\n${JSON.stringify(
		options.includeStoryGraph
			? addStoryGraphToStoryData(storyDataPayload, story)
			: storyDataPayload,
		null,
		2
	)}`;

	let result = `${storyTitle}\n\n\n${storyData}\n\n\n${sortBy(story.passages, [
		'name'
	])
		.map(passageToTwee)
		.join('\n\n')}`;

	// If the story has script or stylesheet, they need to be converted to tagged
	// passages. These passage names are not part of the Twee spec.

	const passageNames = story.passages.map(({name}) => name);

	if (story.script.trim() !== '') {
		const scriptPassageName = unusedName('StoryScript', passageNames);

		result += `\n\n:: ${scriptPassageName} [script]\n${escapeForTweeText(
			story.script
		)}`;
	}

	if (story.stylesheet.trim() !== '') {
		const stylesheetPassageName = unusedName('StoryStylesheet', passageNames);

		result += `\n\n:: ${stylesheetPassageName} [stylesheet]\n${escapeForTweeText(
			story.stylesheet
		)}`;
	}

	return result;
}

/**
 * Unescapes characters with special meanings in a Twee passage header (brackets,
 * curly quotes, and backslashes).
 */
export function unescapeForTweeHeader(value: string) {
	return value.replace(/\\([[\]{}])/g, '$1').replace(/\\\\/g, '\\');
}

/**
 * Unescapes characters that would disrupt parsing of passage text, i.e. `::` at
 * the start of a line.
 */
export function unescapeForTweeText(value: string) {
	return value.replace(/^\\:/gm, ':');
}
