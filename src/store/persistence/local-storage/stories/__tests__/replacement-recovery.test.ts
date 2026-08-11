import {fakeStory} from '../../../../../test-util';
import type {StoryWithDocuments} from '../../../../stories';
import {load} from '../load';
import {
	discardInvalidLocalReplacementRecovery,
	hasLocalReplacementRecovery,
	inspectLocalReplacementRecovery,
	localReplacementRecoveryStatus,
	prepareLocalReplacementRecovery,
	recoverLocalReplacementJournal,
	resolveLocalReplacementRecovery,
	sealLocalReplacementRecovery
} from '../replacement-recovery';
import {doUpdateTransaction, savePassage, saveStory} from '../save';
import {storageManifestKey} from '../storage';

const recoveryKey = 'twine-rs-local-project-replacement-recovery';

function persist(...stories: StoryWithDocuments[]) {
	doUpdateTransaction(transaction => {
		for (const story of stories) {
			saveStory(transaction, story);
			for (const passage of story.passages) {
				savePassage(transaction, passage);
			}
		}
	});
}

function replacement(story: StoryWithDocuments, text: string) {
	return {
		...story,
		name: `${story.name} replacement`,
		passages: story.passages.map((passage, index) => ({
			...passage,
			text: index === 0 ? text : passage.text
		}))
	};
}

function loadedStory(
	stories: Awaited<ReturnType<typeof load>>,
	storyId: string
) {
	return stories.find(story => story.id === storyId)! as StoryWithDocuments;
}

async function recoverAndLoad() {
	recoverLocalReplacementJournal();
	return load();
}

describe('local project replacement recovery', () => {
	beforeEach(() => window.localStorage.clear());
	afterEach(() => {
		jest.restoreAllMocks();
		window.localStorage.clear();
	});

	it('keeps the local story loader read-only while recovery is pending', async () => {
		const original = fakeStory(1);

		persist(original);
		prepareLocalReplacementRecovery([original]);
		persist(replacement(original, 'provisional body'));
		sealLocalReplacementRecovery();

		const stories = await load();

		expect(loadedStory(stories, original.id).passages[0].text).toBe(
			'provisional body'
		);
		expect(hasLocalReplacementRecovery()).toBe(true);
	});

	it('restores an affected project when an unrelated project changes', async () => {
		const original = fakeStory(1);
		const unrelated = fakeStory(1);
		const imported = replacement(original, 'imported body');
		const unrelatedEdit = replacement(unrelated, 'unrelated edit');

		persist(original, unrelated);
		prepareLocalReplacementRecovery([original]);
		persist(imported);
		sealLocalReplacementRecovery();
		persist(unrelatedEdit);

		const stories = await recoverAndLoad();

		expect(loadedStory(stories, original.id).passages[0].text).toBe(
			original.passages[0].text
		);
		expect(loadedStory(stories, unrelated.id).passages[0].text).toBe(
			'unrelated edit'
		);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('recovers safe siblings independently while retaining one conflict', async () => {
		const first = fakeStory(1);
		const second = fakeStory(1);
		const firstImported = replacement(first, 'first imported');
		const secondImported = replacement(second, 'second imported');
		const firstEdited = replacement(firstImported, 'edited after failure');

		persist(first, second);
		prepareLocalReplacementRecovery([first, second]);
		persist(firstImported, secondImported);
		sealLocalReplacementRecovery();
		persist(firstEdited);

		const stories = await recoverAndLoad();
		const report = inspectLocalReplacementRecovery();

		expect(loadedStory(stories, first.id).passages[0].text).toBe(
			'edited after failure'
		);
		expect(loadedStory(stories, second.id).passages[0].text).toBe(
			second.passages[0].text
		);
		expect(report.issues).toEqual([
			expect.objectContaining({state: 'conflict', storyId: first.id})
		]);
	});

	it('keeps current contents for an explicit conflict decision', async () => {
		const original = fakeStory(1);
		const edited = replacement(original, 'keep this edit');

		persist(original);
		prepareLocalReplacementRecovery([original]);
		persist(replacement(original, 'imported'));
		sealLocalReplacementRecovery();
		persist(edited);
		await recoverAndLoad();

		expect(
			resolveLocalReplacementRecovery(original.id, 'keep-current').issues
		).toHaveLength(0);
		expect(
			loadedStory(await recoverAndLoad(), original.id).passages[0].text
		).toBe('keep this edit');
		expect(hasLocalReplacementRecovery()).toBe(false);
		expect(() => prepareLocalReplacementRecovery([edited])).not.toThrow();
	});

	it('restores the original for an explicit conflict decision', async () => {
		const original = fakeStory(1);
		const edited = replacement(original, 'discard this edit');

		persist(original);
		prepareLocalReplacementRecovery([original]);
		persist(replacement(original, 'imported'));
		sealLocalReplacementRecovery();
		persist(edited);
		await recoverAndLoad();

		expect(
			resolveLocalReplacementRecovery(original.id, 'restore-original').issues
		).toHaveLength(0);
		expect(
			loadedStory(await recoverAndLoad(), original.id).passages[0].text
		).toBe(original.passages[0].text);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('cleans a prepared journal when only an unrelated project changed', async () => {
		const original = fakeStory(1);
		const unrelated = fakeStory(1);
		const unrelatedEdit = replacement(unrelated, 'unrelated prepared edit');

		persist(original, unrelated);
		prepareLocalReplacementRecovery([original]);
		persist(unrelatedEdit);

		const stories = await recoverAndLoad();

		expect(loadedStory(stories, original.id).passages[0].text).toBe(
			original.passages[0].text
		);
		expect(loadedStory(stories, unrelated.id).passages[0].text).toBe(
			'unrelated prepared edit'
		);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('offers a terminal decision for an unsealed divergent journal', async () => {
		const original = fakeStory(1);
		const imported = replacement(original, 'unsealed import');

		persist(original);
		prepareLocalReplacementRecovery([original]);
		persist(imported);
		await recoverAndLoad();

		expect(inspectLocalReplacementRecovery().issues).toEqual([
			expect.objectContaining({state: 'prepared', storyId: original.id})
		]);
		resolveLocalReplacementRecovery(original.id, 'keep-current');
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it.each([1, 2] as const)(
		'migrates a version %s journal into an explicit resolution',
		async version => {
			const original = fakeStory(1);
			const current = replacement(original, 'legacy current');

			persist(original);
			window.localStorage.setItem(
				recoveryKey,
				JSON.stringify(
					version === 1
						? {stories: [original], version}
						: {
								preparedManifestRevision: 'old-global-revision',
								sealedManifestRevision: 'old-sealed-revision',
								stories: [original],
								version
							}
				)
			);
			persist(current);
			await recoverAndLoad();

			expect(localReplacementRecoveryStatus()).toBe('legacy');
			expect(inspectLocalReplacementRecovery().issues[0]).toEqual(
				expect.objectContaining({state: 'legacy', storyId: original.id})
			);
			resolveLocalReplacementRecovery(original.id, 'restore-original');
			expect(
				loadedStory(await recoverAndLoad(), original.id).passages[0].text
			).toBe(original.passages[0].text);
			expect(hasLocalReplacementRecovery()).toBe(false);
		}
	);

	it('retains a seal failure as a resolvable prepared conflict', async () => {
		const original = fakeStory(1);
		const imported = replacement(original, 'import before seal failure');

		persist(original);
		prepareLocalReplacementRecovery([original]);
		persist(imported);
		const setItem = jest
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementationOnce(() => {
				throw new Error('seal failed');
			});

		expect(() => sealLocalReplacementRecovery()).toThrow('seal failed');
		setItem.mockRestore();
		await recoverAndLoad();
		expect(inspectLocalReplacementRecovery().issues[0]).toEqual(
			expect.objectContaining({state: 'prepared', storyId: original.id})
		);
		resolveLocalReplacementRecovery(original.id, 'restore-original');
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('retries after a recovery transaction fails', () => {
		const original = fakeStory(1);

		persist(original);
		prepareLocalReplacementRecovery([original]);
		persist(replacement(original, 'imported'));
		sealLocalReplacementRecovery();
		const originalSetItem = Storage.prototype.setItem;
		const setItem = jest
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(function (this: Storage, key: string, value: string) {
				if (key === storageManifestKey) {
					throw new Error('manifest commit failed');
				}
				return originalSetItem.call(this, key, value);
			});

		const failed = recoverLocalReplacementJournal();

		expect(failed.error).toContain('manifest commit failed');
		expect(failed.issues[0]).toEqual(
			expect.objectContaining({state: 'retry', storyId: original.id})
		);
		setItem.mockRestore();
		expect(recoverLocalReplacementJournal().issues).toHaveLength(0);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('recognizes a durable restore after journal clearing fails', () => {
		const original = fakeStory(1);

		persist(original);
		prepareLocalReplacementRecovery([original]);
		persist(replacement(original, 'imported'));
		sealLocalReplacementRecovery();
		const originalRemoveItem = Storage.prototype.removeItem;
		let clearFailed = false;
		const removeItem = jest
			.spyOn(Storage.prototype, 'removeItem')
			.mockImplementation(function (this: Storage, key: string) {
				if (key === recoveryKey && !clearFailed) {
					clearFailed = true;
					throw new Error('journal clear failed');
				}
				return originalRemoveItem.call(this, key);
			});

		const failed = recoverLocalReplacementJournal();

		expect(failed.error).toContain('journal clear failed');
		expect(failed.issues[0]).toEqual(
			expect.objectContaining({state: 'cleanup', storyId: original.id})
		);
		removeItem.mockRestore();
		expect(recoverLocalReplacementJournal().issues).toHaveLength(0);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('resumes after only some entries were durably recovered', async () => {
		const first = fakeStory(1);
		const second = fakeStory(1);

		persist(first, second);
		prepareLocalReplacementRecovery([first, second]);
		persist(
			replacement(first, 'first imported'),
			replacement(second, 'second imported')
		);
		sealLocalReplacementRecovery();
		const originalSetItem = Storage.prototype.setItem;
		let manifestCommits = 0;
		const setItem = jest
			.spyOn(Storage.prototype, 'setItem')
			.mockImplementation(function (this: Storage, key: string, value: string) {
				if (key === storageManifestKey && ++manifestCommits === 2) {
					throw new Error('second recovery interrupted');
				}
				return originalSetItem.call(this, key, value);
			});

		const partial = recoverLocalReplacementJournal();

		expect(partial.error).toContain('second recovery interrupted');
		expect(partial.issues).toEqual([
			expect.objectContaining({state: 'retry', storyId: second.id})
		]);
		setItem.mockRestore();
		const stories = await recoverAndLoad();

		expect(loadedStory(stories, first.id).passages[0].text).toBe(
			first.passages[0].text
		);
		expect(loadedStory(stories, second.id).passages[0].text).toBe(
			second.passages[0].text
		);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it('allows an invalid journal to be explicitly discarded', () => {
		window.localStorage.setItem(recoveryKey, '{invalid');

		expect(inspectLocalReplacementRecovery().issues[0]).toEqual(
			expect.objectContaining({state: 'invalid'})
		);
		expect(discardInvalidLocalReplacementRecovery().issues).toHaveLength(0);
		expect(hasLocalReplacementRecovery()).toBe(false);
	});

	it.each([
		{stories: [], version: 1},
		{preparedManifestRevision: 'old', stories: [], version: 2},
		{
			entries: [],
			operationId: 'empty-operation',
			phase: 'prepared',
			version: 3
		}
	])('makes an empty $version journal explicitly discardable', journal => {
		window.localStorage.setItem(recoveryKey, JSON.stringify(journal));

		expect(recoverLocalReplacementJournal().issues[0]).toEqual(
			expect.objectContaining({state: 'invalid'})
		);
		discardInvalidLocalReplacementRecovery();
		expect(hasLocalReplacementRecovery()).toBe(false);
		expect(() => prepareLocalReplacementRecovery([fakeStory(1)])).not.toThrow();
	});

	it('refuses to overwrite an unresolved recovery record', () => {
		const original = fakeStory(1);

		prepareLocalReplacementRecovery([original]);
		expect(() => prepareLocalReplacementRecovery([fakeStory(1)])).toThrow(
			'needs recovery'
		);
		expect(hasLocalReplacementRecovery()).toBe(true);
	});
});
