import {v4 as uuid} from '@lukeed/uuid';
import {rcompare, satisfies, valid} from 'semver';
import {Story} from '../../stories.types';
import {storyDefaults} from '../../defaults';
import {StoryFormat} from '../../../story-formats';
import {repairPassage} from './repair-passage';

function logRepair(
	story: Story,
	propName: keyof Story,
	repairedValue: any,
	detail?: string
) {
	let message =
		`Repairing story (name: "${story.name}", id: ${story.id}) by ` +
		`setting ${propName} to ${repairedValue}, was ${story[propName]}`;

	if (detail) {
		message += ` (${detail})`;
	}

	console.info(message);
}

function sameFormatName(left: string, right: string) {
	return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function sortFormatsByVersion(left: StoryFormat, right: StoryFormat) {
	const leftValid = valid(left.version);
	const rightValid = valid(right.version);

	if (leftValid && rightValid) {
		return rcompare(left.version, right.version);
	}

	return right.version.localeCompare(left.version);
}

function formatsWithName(name: string, allFormats: StoryFormat[]) {
	return allFormats
		.filter(format => sameFormatName(format.name, name))
		.sort(sortFormatsByVersion);
}

const sugarCubeMacroSignalRegex =
	/<<(?:set|if|elseif|else|switch|case|default|for|capture|widget|button|link(?:append|prepend|replace)?|goto|include|display|print|run|script|style|audio|nobr|notify|timed|repeat|silently|remember|forget|done)\b|<<\/(?:if|for|widget|button|link(?:append|prepend|replace)?|nobr|silently|script|style|notify|timed|repeat)>>/i;
const sugarCubeSignalTags = new Set([
	'init',
	'nobr',
	'script',
	'stylesheet',
	'widget'
]);
const bundledStoryFormatNames = new Map([
	['chapbook', 'Chapbook'],
	['harlowe', 'Harlowe'],
	['paperthin', 'Paperthin'],
	['snowman', 'Snowman'],
	['sugarcube', 'SugarCube']
]);

function storyFormatCanBeSugarCubeRepaired(format: string) {
	const normalized = format.trim().toLowerCase();

	return normalized === '' || normalized === 'harlowe';
}

function bundledStoryFormatName(format: string) {
	return bundledStoryFormatNames.get(format.trim().toLowerCase());
}

function sourceLooksLikeSugarCube(source: string) {
	return sugarCubeMacroSignalRegex.test(source);
}

function storyLooksLikeSugarCube(story: Story) {
	return (
		sourceLooksLikeSugarCube(story.script) ||
		sourceLooksLikeSugarCube(story.stylesheet) ||
		story.passages.some(
			passage =>
				sourceLooksLikeSugarCube(passage.text) ||
				passage.tags.some(tag => sugarCubeSignalTags.has(tag.toLowerCase()))
		)
	);
}

export function repairStory(
	story: Story,
	allStories: Story[],
	allFormats: StoryFormat[],
	defaultFormat: StoryFormat
): Story {
	const storyDefs = storyDefaults();
	const repairs: Partial<Story> = {};

	// Give the story an ID if it has none.

	if (typeof story.id !== 'string' || story.id === '') {
		const newId = uuid();

		logRepair(story, 'id', newId, 'was bad type or empty string');
		repairs.id = newId;
	}

	// Give the story an IFID if it has none.

	if (typeof story.ifid !== 'string' || story.id === '') {
		const newIfid = uuid();

		logRepair(story, 'ifid', newIfid, 'was bad type or empty string');
		repairs.ifid = newIfid;
	}

	// Apply default properties to the story.

	for (const key in storyDefs) {
		const defKey = key as keyof typeof storyDefs;
		const value = storyDefs[defKey];

		if (
			(typeof value === 'number' && !Number.isFinite(story[defKey])) ||
			typeof value !== typeof story[defKey]
		) {
			logRepair(story, defKey, storyDefs[defKey]);
			(repairs[defKey] as Story[typeof defKey]) = storyDefs[defKey];
		}
	}

	const storyFormatName =
		typeof story.storyFormat === 'string' ? story.storyFormat.trim() : '';
	const storyFormatVersion =
		typeof story.storyFormatVersion === 'string'
			? story.storyFormatVersion.trim()
			: '';
	const namedFormats = storyFormatName
		? formatsWithName(storyFormatName, allFormats)
		: [];
	const sugarCubeFormat = formatsWithName('SugarCube', allFormats)[0];

	if (
		sugarCubeFormat &&
		storyFormatCanBeSugarCubeRepaired(storyFormatName) &&
		storyLooksLikeSugarCube(story)
	) {
		logRepair(
			story,
			'storyFormat',
			sugarCubeFormat.name,
			'content contains SugarCube syntax'
		);
		logRepair(
			story,
			'storyFormatVersion',
			sugarCubeFormat.version,
			'content contains SugarCube syntax'
		);
		repairs.storyFormat = sugarCubeFormat.name;
		repairs.storyFormatVersion = sugarCubeFormat.version;
	} else if (!storyFormatName) {
		// Assign the story the default story format if it has none.

		logRepair(
			story,
			'storyFormat',
			defaultFormat.name,
			'was bad type or unset'
		);
		logRepair(
			story,
			'storyFormatVersion',
			defaultFormat.version,
			'was bad type or unset'
		);
		repairs.storyFormat = defaultFormat.name;
		repairs.storyFormatVersion = defaultFormat.version;
	} else if (!storyFormatVersion && namedFormats.length > 0) {
		const repairFormat = namedFormats[0];

		logRepair(
			story,
			'storyFormat',
			repairFormat.name,
			'version was unset but format name matched an installed format'
		);
		logRepair(
			story,
			'storyFormatVersion',
			repairFormat.version,
			'version was unset but format name matched an installed format'
		);
		repairs.storyFormat = repairFormat.name;
		repairs.storyFormatVersion = repairFormat.version;
	} else if (!storyFormatVersion) {
		const bundledName = bundledStoryFormatName(storyFormatName);

		if (bundledName) {
			if (
				story.storyFormat !== bundledName ||
				story.storyFormatVersion !== ''
			) {
				logRepair(
					story,
					'storyFormat',
					bundledName,
					'version was unset but format name is a bundled Twine format'
				);
				logRepair(
					story,
					'storyFormatVersion',
					'',
					'version was unset but format name is a bundled Twine format'
				);
				repairs.storyFormat = bundledName;
				repairs.storyFormatVersion = '';
			}
		} else {
			logRepair(
				story,
				'storyFormat',
				defaultFormat.name,
				'version was unset and no installed format name matched'
			);
			logRepair(
				story,
				'storyFormatVersion',
				defaultFormat.version,
				'version was unset and no installed format name matched'
			);
			repairs.storyFormat = defaultFormat.name;
			repairs.storyFormatVersion = defaultFormat.version;
		}
	} else {
		const exactFormat = allFormats.find(
			format =>
				sameFormatName(format.name, storyFormatName) &&
				format.version === storyFormatVersion
		);

		if (exactFormat) {
			if (
				story.storyFormat !== exactFormat.name ||
				story.storyFormatVersion !== exactFormat.version
			) {
				logRepair(
					story,
					'storyFormat',
					exactFormat.name,
					'canonicalized to installed format name'
				);
				logRepair(
					story,
					'storyFormatVersion',
					exactFormat.version,
					'canonicalized to installed format version'
				);
				repairs.storyFormat = exactFormat.name;
				repairs.storyFormatVersion = exactFormat.version;
			}
		} else {
			// If the story has a nonexistent story format, try to match it to one that
			// does, using semver as a guide.

			const repairFormat = namedFormats.find(format =>
				satisfies(format.version, '^' + storyFormatVersion)
			);
			const namedFallbackFormat = namedFormats[0];

			if (repairFormat) {
				logRepair(
					story,
					'storyFormat',
					repairFormat.name,
					'no match in existing formats but found one that satisfies semver'
				);
				logRepair(
					story,
					'storyFormatVersion',
					repairFormat.version,
					'no match in existing formats but found one that satisfies semver'
				);
				repairs.storyFormat = repairFormat.name;
				repairs.storyFormatVersion = repairFormat.version;
			} else if (namedFallbackFormat) {
				logRepair(
					story,
					'storyFormat',
					namedFallbackFormat.name,
					'no version match but format name matched an installed format'
				);
				logRepair(
					story,
					'storyFormatVersion',
					namedFallbackFormat.version,
					'no version match but format name matched an installed format'
				);
				repairs.storyFormat = namedFallbackFormat.name;
				repairs.storyFormatVersion = namedFallbackFormat.version;
			} else {
				const bundledName = bundledStoryFormatName(storyFormatName);

				if (bundledName) {
					if (
						story.storyFormat !== bundledName ||
						story.storyFormatVersion !== storyFormatVersion
					) {
						logRepair(
							story,
							'storyFormat',
							bundledName,
							'format name is a bundled Twine format'
						);
						logRepair(
							story,
							'storyFormatVersion',
							storyFormatVersion,
							'format name is a bundled Twine format'
						);
						repairs.storyFormat = bundledName;
						repairs.storyFormatVersion = storyFormatVersion;
					}
				} else {
					logRepair(
						story,
						'storyFormat',
						defaultFormat.name,
						'no match in existing formats and could not find one that satisfies semver'
					);
					logRepair(
						story,
						'storyFormatVersion',
						defaultFormat.version,
						'no match in existing formats and could not find one that satisfies semver'
					);
					repairs.storyFormat = defaultFormat.name;
					repairs.storyFormatVersion = defaultFormat.version;
				}
			}
		}
	}

	// Repair ID conflicts with other stories.

	if (
		allStories.some(otherStory => {
			if (otherStory === story) {
				return false;
			}

			return otherStory.id === story.id;
		})
	) {
		const newId = uuid();

		logRepair(story, 'id', newId, "conflicted with another story's ID");
		repairs.id = newId;
	}

	// Repair all passages. All story ID changes must be before this to prevent
	// mismatches. We merge in repairs temporarily here so that passages see the
	// most correct ID.

	let anyPassageRepaired = false;
	const repairedPassages = story.passages.map(passage => {
		const repairedPassage = repairPassage(passage, {...story, ...repairs});

		if (repairedPassage !== passage) {
			anyPassageRepaired = true;
			return repairedPassage;
		}

		return passage;
	});

	if (anyPassageRepaired) {
		repairs.passages = repairedPassages;
	}

	if (Object.keys(repairs).length > 0) {
		return {...story, ...repairs};
	}

	return story;
}
