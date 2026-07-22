import {StoryWithDocuments} from '../../../../stories/stories.types';
import {fakeStory} from '../../../../../test-util';
import {load} from '../load';
import {
	deletePassage,
	deletePassageById,
	deleteStory,
	doUpdateTransaction,
	savePassage,
	saveStory
} from '../save';
import {readStorageManifest, storageManifestKey} from '../storage';

function saveCompleteStory(story: StoryWithDocuments) {
	doUpdateTransaction(transaction => {
		saveStory(transaction, story);
		story.passages.forEach(passage => savePassage(transaction, passage));
	});
}

function storageSnapshot() {
	return Object.fromEntries(
		Object.keys(window.localStorage)
			.sort()
			.map(key => [key, window.localStorage.getItem(key)])
	);
}

describe('stories local storage save', () => {
	let story: StoryWithDocuments;

	beforeEach(() => {
		window.localStorage.clear();
		story = fakeStory(1);
	});
	afterAll(() => window.localStorage.clear());

	it('commits a complete readable snapshot through one manifest', async () => {
		saveCompleteStory(story);

		const manifest = readStorageManifest();

		expect(
			JSON.parse(window.localStorage.getItem(storageManifestKey)!)
		).toEqual(manifest);
		expect(manifest.stories).toHaveLength(1);
		expect(manifest.passages).toHaveLength(1);
		expect(await load()).toEqual([story]);
		expect(window.localStorage.getItem('twine-stories')).toBeNull();
		expect(window.localStorage.getItem('twine-passages')).toBeNull();
	});

	it('keeps equal passage IDs in different stories independent', async () => {
		const other = fakeStory(1);

		other.passages[0].id = story.passages[0].id;
		other.passages[0].story = other.id;
		other.passages[0].text = 'other story body';
		other.startPassage = other.passages[0].id;

		doUpdateTransaction(transaction => {
			for (const candidate of [story, other]) {
				saveStory(transaction, candidate);
				savePassage(transaction, candidate.passages[0]);
			}
		});

		expect(readStorageManifest().passages).toEqual(
			expect.arrayContaining([
				expect.objectContaining({id: story.passages[0].id, storyId: story.id}),
				expect.objectContaining({id: story.passages[0].id, storyId: other.id})
			])
		);
		expect(await load()).toEqual(expect.arrayContaining([story, other]));
	});

	it('deletes a passage by story and passage ID without touching a collision', async () => {
		const other = fakeStory(1);

		other.passages[0].id = story.passages[0].id;
		other.passages[0].story = other.id;
		saveCompleteStory(story);
		saveCompleteStory(other);

		doUpdateTransaction(transaction =>
			deletePassageById(transaction, story.id, story.passages[0].id)
		);

		const loaded = await load();

		expect(
			loaded.find(candidate => candidate.id === story.id)?.passages
		).toEqual([]);
		expect(
			loaded.find(candidate => candidate.id === other.id)?.passages
		).toHaveLength(1);
	});

	it('leaves the prior revision intact when quota fails at every write boundary', async () => {
		story = fakeStory(2);
		saveCompleteStory(story);
		const before = storageSnapshot();
		const updated: StoryWithDocuments = {
			...story,
			name: 'Updated story',
			passages: story.passages.map((passage, index) => ({
				...passage,
				text: `Updated passage ${index + 1}`
			}))
		};

		for (const failureBoundary of [1, 2, 3, 4]) {
			const originalSetItem = window.localStorage.setItem.bind(
				window.localStorage
			);
			let writes = 0;
			const quotaError = new DOMException(
				'Storage quota exceeded',
				'QuotaExceededError'
			);
			const setItemSpy = jest
				.spyOn(Storage.prototype, 'setItem')
				.mockImplementation((key, value) => {
					writes += 1;
					if (writes === failureBoundary) {
						throw quotaError;
					}
					originalSetItem(key, value);
				});

			try {
				expect(() => saveCompleteStory(updated)).toThrow(quotaError);
			} finally {
				setItemSpy.mockRestore();
			}

			expect(writes).toBe(failureBoundary);
			expect(storageSnapshot()).toEqual(before);
			expect(await load()).toEqual([story]);
		}
	});

	it('preserves story and passage order when records are replaced', async () => {
		const other = fakeStory(1);

		story = fakeStory(2);
		doUpdateTransaction(transaction => {
			for (const candidate of [story, other]) {
				saveStory(transaction, candidate);
				candidate.passages.forEach(passage =>
					savePassage(transaction, passage)
				);
			}
		});

		const firstPassage = {...story.passages[0], text: 'updated in place'};

		doUpdateTransaction(transaction => {
			saveStory(transaction, {...story, name: 'updated in place'});
			savePassage(transaction, firstPassage);
		});

		expect(readStorageManifest().stories.map(({id}) => id)).toEqual([
			story.id,
			other.id
		]);
		expect(
			readStorageManifest().passages.map(({id, storyId}) => [storyId, id])
		).toEqual([
			[story.id, story.passages[0].id],
			[story.id, story.passages[1].id],
			[other.id, other.passages[0].id]
		]);
	});

	it('migrates legacy keys without losing unchanged passage records', async () => {
		const passage = story.passages[0];
		const updated = {...story, name: 'Migrated story'};

		window.localStorage.setItem('twine-stories', story.id);
		window.localStorage.setItem(
			`twine-stories-${story.id}`,
			JSON.stringify({...story, passages: undefined})
		);
		window.localStorage.setItem('twine-passages', passage.id);
		window.localStorage.setItem(
			`twine-passages-${passage.id}`,
			JSON.stringify(passage)
		);

		doUpdateTransaction(transaction => saveStory(transaction, updated));

		expect(await load()).toEqual([updated]);
		expect(window.localStorage.getItem(`twine-stories-${story.id}`)).toBeNull();
		expect(
			window.localStorage.getItem(`twine-passages-${passage.id}`)
		).not.toBeNull();
	});

	it('stages deletes until the transaction commits', async () => {
		saveCompleteStory(story);

		doUpdateTransaction(transaction => {
			deletePassage(transaction, story.passages[0]);
			deleteStory(transaction, story);
		});

		expect(await load()).toEqual([]);
		expect(readStorageManifest().stories).toEqual([]);
		expect(readStorageManifest().passages).toEqual([]);
	});

	it('does not write when the updater throws', () => {
		const error = new Error('invalid update');

		expect(() =>
			doUpdateTransaction(() => {
				throw error;
			})
		).toThrow(error);
		expect(storageSnapshot()).toEqual({});
	});

	it('rejects records without required identity', () => {
		expect(() =>
			doUpdateTransaction(transaction =>
				saveStory(transaction, {...story, id: ''})
			)
		).toThrow('Story has no ID');
		expect(() =>
			doUpdateTransaction(transaction =>
				savePassage(transaction, {...story.passages[0], id: ''})
			)
		).toThrow('Passage has no ID');
		expect(() =>
			doUpdateTransaction(transaction =>
				savePassage(transaction, {...story.passages[0], story: ''})
			)
		).toThrow('Passage has no parent story ID');
	});
});
