import {passageDefaults, storyDefaults} from '../../../stories/defaults';
import {Passage, Story} from '../../../stories/stories.types';
import {readStorageManifest} from './storage';

/**
 * Parses initial state from local storage.
 */
export async function load(): Promise<Story[]> {
	const stories: Record<string, Story> = {};
	const manifest = readStorageManifest();

	if (manifest.stories.length === 0) {
		return [];
	}

	// First, deserialize stories. We index them by ID so that we can quickly add
	// passages to them as they are deserialized.

	manifest.stories.forEach(({id, key}) => {
		const serializedStory = window.localStorage.getItem(key);

		if (!serializedStory) {
			console.warn(
				`Story manifest contained ID ${id}, but ${key} does not exist, skipping`
			);
			return;
		}

		try {
			const story: Story = JSON.parse(serializedStory);

			if (!story.id) {
				console.warn('Story in local storage had no ID, skipping', story);
				return;
			}

			stories[story.id] = {
				...storyDefaults(),
				...story,

				// Coerce lastUpdate to a date.
				lastUpdate: story.lastUpdate
					? new Date(Date.parse(story.lastUpdate as unknown as string))
					: new Date(),

				// Force the passages property to be an empty array -- we'll populate it
				// when we load passages below.
				passages: []
			};
		} catch (e) {
			console.warn(
				`Could not parse story as JSON, skipping: ${serializedStory}`
			);
		}
	});

	// Then create passages, adding them to their parent story.

	if (manifest.passages.length > 0) {
		manifest.passages.forEach(({id, key}) => {
			const serializedPassage = window.localStorage.getItem(key);

			if (!serializedPassage) {
				console.warn(
					`Passage manifest contained ID ${id}, but ${key} does not exist, skipping`
				);
				return;
			}

			try {
				const passage: Passage = JSON.parse(serializedPassage);

				if (!passage || !passage.story) {
					console.warn(
						`Passage ${id} did not have parent story ID, skipping`,
						passage
					);
					return;
				}

				if (!stories[passage.story]) {
					console.warn(
						`Passage ${id} is orphaned (looking for story ID ${passage.story}), skipping`
					);
					return;
				}

				stories[passage.story].passages.push({
					...passageDefaults,
					...passage,

					// Remove empty tags.
					tags: passage.tags ? passage.tags.filter(t => t.trim() !== '') : []
				});
			} catch (e) {
				console.warn(
					`Could not parse passage as JSON, skipping: ${serializedPassage}`
				);
			}
		});
	}

	// Flatten the stories object.
	return Object.values(stories);
}
