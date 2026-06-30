import {createRegExp, escapeRegExpReplace} from '../../../util/regexp';
import type {PassagePatch, StoryCommand} from '../../../core';
import {Passage, Story, StorySearchFlags} from '../stories.types';

/**
 * Core logic for replacing text using flags.
 */
function replaceText(
	source: string,
	searchFor: string,
	replaceWith: string,
	flags: StorySearchFlags
) {
	const {matchCase, useRegexes} = flags;
	const matcher = createRegExp(searchFor, {matchCase, useRegexes});
	const replacer = useRegexes ? replaceWith : escapeRegExpReplace(replaceWith);

	return source.replace(matcher, replacer);
}

export type PassageReplaceError =
	| {error: 'invalidRegex'}
	| {error: 'emptyName' | 'nameConflict'; passage: Passage};

/**
 * Checks whether a find & replace can be done in a story, e.g. will not result
 * in duplicate passage names or empty passage names. This stops at the first
 * problem found.
 */
export function passageReplaceError(
	passages: Passage[],
	find: string,
	replace: string,
	flags: StorySearchFlags
): PassageReplaceError | undefined {
	// If we're replacing a regex, test that it's valid.

	if (flags.useRegexes) {
		try {
			new RegExp(find);
		} catch {
			return {error: 'invalidRegex'};
		}
	}

	// If we're not changing passage names, it's always safe if we've reached this
	// point. Skip passage name checks because they're relatively expensive.

	if (!flags.includePassageNames) {
		return;
	}

	const newNames = new Set<string>();

	for (const passage of passages) {
		const newName = replaceText(passage.name, find, replace, flags);

		if (newName.trim() === '') {
			return {passage, error: 'emptyName'};
		}

		if (newNames.has(newName)) {
			return {passage, error: 'nameConflict'};
		}

		newNames.add(newName);
	}
}

/**
 * Builds the Rust-owned equivalent of replaceInStory(). The entire replacement
 * is committed as one session transaction.
 */
export function replaceInStoryCommand(
	story: Story,
	searchFor: string,
	replaceWith: string,
	flags: StorySearchFlags
): StoryCommand {
	if (searchFor === '') {
		throw new Error("Can't replace an empty string");
	}

	const commands: StoryCommand[] = [];

	for (const passage of story.passages) {
		const changes: PassagePatch = {
			layout: null,
			name: null,
			tags: null,
			text: null
		};
		const text = replaceText(passage.text, searchFor, replaceWith, flags);

		if (text !== passage.text) {
			changes.text = text;
		}

		if (flags.includePassageNames) {
			const name = replaceText(passage.name, searchFor, replaceWith, flags);

			if (name !== passage.name) {
				changes.name = name;
			}
		}

		if (changes.name !== null || changes.text !== null) {
			commands.push({
				type: 'updatePassage',
				changes,
				passage_id: passage.id,
				story_id: story.id,
				update_references: true
			});
		}
	}

	const script = replaceText(story.script, searchFor, replaceWith, flags);
	const stylesheet = replaceText(
		story.stylesheet,
		searchFor,
		replaceWith,
		flags
	);

	if (script !== story.script) {
		commands.push({
			type: 'updateStoryScript',
			script,
			story_id: story.id
		});
	}

	if (stylesheet !== story.stylesheet) {
		commands.push({
			type: 'updateStoryStylesheet',
			story_id: story.id,
			stylesheet
		});
	}

	return {type: 'batch', commands};
}
