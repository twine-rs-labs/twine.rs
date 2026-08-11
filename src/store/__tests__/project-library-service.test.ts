import {
	bootstrapStory,
	type CoreAssetInventoryEntry,
	type CoreProjectHost,
	knownAssetInventoryForStory,
	knownAssetInventoryScanCompleteForStory,
	replaceKnownAssetInventoryForStory
} from '../../core';
import {fakeStory} from '../../test-util';
import {
	projectStoryHydration,
	markProjectStoryHydration
} from '../project-hydration';
import {ProjectLibraryService} from '../project-library-service';
import {
	defaultProjectFolderRoot,
	loadProjectMetadata,
	saveProjectMetadata
} from '../project-metadata';

function host(overrides: Partial<CoreProjectHost> = {}) {
	return {
		acknowledgeSaved: jest.fn(async () => undefined),
		admitProjectStories: jest.fn(async () => undefined),
		applyStoryCommand: jest.fn(async () => undefined),
		applyStoryCommandPersisted: jest.fn(async () => undefined),
		deleteProjectStories: jest.fn(async () => undefined),
		drainMutations: jest.fn(async () => undefined),
		ensureSessionReady: jest.fn(async () => undefined),
		retireProjectStories: jest.fn(async () => undefined),
		sessionStatus: jest.fn(() => ({dirty: false, revision: 2})),
		...overrides
	} as unknown as CoreProjectHost;
}

function service(coreHost: CoreProjectHost) {
	return new ProjectLibraryService(coreHost, jest.fn(), () => []);
}

describe('ProjectLibraryService', () => {
	beforeEach(() => {
		window.localStorage.clear();
		delete (window as any).twineElectron;
	});

	it('uses exact persistence barriers for local create, duplicate, and delete', async () => {
		const story = fakeStory();
		const admitProjectStories = jest.fn(async () => undefined);
		const deleteProjectStories = jest.fn(async () => undefined);
		const coreHost = host({admitProjectStories, deleteProjectStories});
		const projectLibrary = service(coreHost);

		await projectLibrary.createProject(story);
		expect(admitProjectStories).toHaveBeenLastCalledWith([story], {
			history: 'skip',
			persistence: 'save',
			persistenceBarrier: true
		});

		await projectLibrary.duplicateProject([story], [story]);
		expect(admitProjectStories).toHaveBeenLastCalledWith(
			[expect.objectContaining({id: expect.not.stringMatching(story.id)})],
			{
				history: 'skip',
				persistence: 'save',
				persistenceBarrier: true
			}
		);

		await projectLibrary.deleteStory(story);
		expect(deleteProjectStories).toHaveBeenCalledWith([story.id], {
			history: 'skip',
			persistence: 'save',
			persistenceBarrier: true
		});
	});

	it('does not delete an admitted project when saved acknowledgement fails', async () => {
		const story = fakeStory();
		const rootPath = '/native/admitted.twine.rs';
		const deleteProjectFolder = jest.fn(async () => undefined);
		const coreHost = host({
			acknowledgeSaved: jest.fn(async () => {
				throw new Error('ack failed');
			})
		});
		const error = jest
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);

		(window as any).twineElectron = {
			createProjectFolder: jest.fn(async () => ({
				rootPath,
				stories: [story],
				storyIds: [story.id]
			})),
			deleteProjectFolder
		};

		await expect(service(coreHost).createProject(story)).resolves.toEqual(
			expect.objectContaining({rootPath})
		);
		expect(deleteProjectFolder).not.toHaveBeenCalled();
		expect(loadProjectMetadata(story.id)?.rootPath).toBe(rootPath);
		expect(coreHost.retireProjectStories).not.toHaveBeenCalled();
		expect(error).toHaveBeenCalledWith(expect.stringContaining('ack failed'));
		error.mockRestore();
	});

	it('does not delete a duplicate when saved acknowledgement fails', async () => {
		const story = fakeStory();
		const rootPath = '/native/duplicate.twine.rs';
		const deleteProjectFolder = jest.fn(async () => undefined);
		const coreHost = host({
			acknowledgeSaved: jest.fn(async () => {
				throw new Error('ack failed');
			})
		});
		const error = jest
			.spyOn(console, 'error')
			.mockImplementation(() => undefined);

		(window as any).twineElectron = {
			deleteProjectFolder,
			duplicateProjectFolder: jest.fn(async (_source, replacements) => ({
				rootPath,
				stories: replacements.map((replacement: any) => replacement.story),
				storyIds: replacements.map((replacement: any) => replacement.story.id)
			})),
			listProjectAssets: jest.fn(async () => [])
		};

		await expect(
			service(coreHost).duplicateProject([story], [story], '/native/source')
		).resolves.toHaveLength(1);
		expect(deleteProjectFolder).not.toHaveBeenCalled();
		expect(coreHost.retireProjectStories).not.toHaveBeenCalled();
		error.mockRestore();
	});

	it('loads the native asset inventory before admitting imported project stories', async () => {
		const story = fakeStory();
		const rootPath = '/native/imported.twine.rs';
		const admitProjectStories = jest.fn(async () => undefined);
		const listProjectAssets = jest.fn(async () => []);
		const coreHost = host({admitProjectStories});

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {listProjectAssets};

		await service(coreHost).admitProjectStories([story]);

		expect(listProjectAssets).toHaveBeenCalledWith(rootPath);
		expect(knownAssetInventoryScanCompleteForStory(story.id)).toBe(true);
		expect(listProjectAssets.mock.invocationCallOrder[0]).toBeLessThan(
			admitProjectStories.mock.invocationCallOrder[0]
		);
	});

	it('re-lists native assets when an abandoned admission is retried', async () => {
		const story = fakeStory();
		const rootPath = '/native/retry-import.twine.rs';
		const firstAssets = [
			{normalizedPath: 'assets/old.png', path: 'assets/old.png'}
		] as CoreAssetInventoryEntry[];
		const secondAssets = [
			{normalizedPath: 'assets/new.png', path: 'assets/new.png'}
		] as CoreAssetInventoryEntry[];
		const admitProjectStories = jest
			.fn()
			.mockRejectedValueOnce(new Error('late admission failed'))
			.mockResolvedValueOnce(undefined);
		const listProjectAssets = jest
			.fn()
			.mockResolvedValueOnce(firstAssets)
			.mockResolvedValueOnce(secondAssets);
		const coreHost = host({admitProjectStories});
		const projectLibrary = service(coreHost);
		const bindProject = () =>
			saveProjectMetadata(story.id, {
				rootPath,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});

		(window as any).twineElectron = {listProjectAssets};
		bindProject();
		await expect(projectLibrary.admitProjectStories([story])).rejects.toThrow(
			'late admission failed'
		);
		expect(knownAssetInventoryScanCompleteForStory(story.id)).toBe(false);

		bindProject();
		await projectLibrary.admitProjectStories([story]);

		expect(listProjectAssets).toHaveBeenCalledTimes(2);
		expect(knownAssetInventoryForStory(story.id)).toEqual(secondAssets);
	});

	it('snapshots an unopened native project before staged deletion', async () => {
		const story = fakeStory();
		const rootPath = '/native/lazy-project.twine.rs';
		const retireProjectStories = jest.fn(async () => undefined);
		const coreHost = host({retireProjectStories});
		const beginProjectFolderDeletion = jest.fn(async () => ({
			id: 'delete-lazy',
			rootPath
		}));
		const commitProjectFolderDeletion = jest.fn(async () => undefined);
		const projectSessionSnapshot = jest.fn(async () => ({
			assets: [],
			changedPaths: [],
			conflicts: [],
			files: [],
			rootPath,
			scannedAt: new Date().toISOString(),
			stories: [story],
			storyIds: [story.id]
		}));

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath
		});
		(window as any).twineElectron = {
			beginProjectFolderDeletion,
			commitProjectFolderDeletion,
			projectSessionSnapshot,
			rollbackProjectFolderDeletion: jest.fn(async () => undefined)
		};

		await service(coreHost).deleteProjectFolder(rootPath, [story]);

		expect(projectSessionSnapshot).toHaveBeenCalledWith(rootPath);
		expect(retireProjectStories).toHaveBeenCalledWith([story.id]);
		expect(commitProjectFolderDeletion).toHaveBeenCalledWith('delete-lazy');
	});

	it('refuses to delete a lazy project whose native IFID does not match', async () => {
		const story = fakeStory();
		const mismatchedStory = {...story, ifid: 'DIFFERENT-IFID'};
		const rootPath = '/native/unrelated-project.twine.rs';
		const beginProjectFolderDeletion = jest.fn();

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: false,
			rootPath
		});
		(window as any).twineElectron = {
			beginProjectFolderDeletion,
			projectSessionSnapshot: jest.fn(async () => ({
				assets: [],
				changedPaths: [],
				conflicts: [],
				files: [],
				rootPath,
				scannedAt: new Date().toISOString(),
				stories: [mismatchedStory],
				storyIds: [story.id]
			}))
		};

		await expect(
			service(host()).deleteProjectFolder(rootPath, [story])
		).rejects.toThrow('does not contain exactly one story matching');
		expect(beginProjectFolderDeletion).not.toHaveBeenCalled();
	});

	it('does not bind a same-named folder without an exact native identity match', async () => {
		const story = fakeStory();
		const other = {...fakeStory(), name: story.name};
		const coreHost = host();

		(window as any).twineElectron = {
			getStoryLibraryFolder: jest.fn(async () => '/native/library'),
			projectSessionSnapshot: jest.fn(async rootPath => ({
				assets: [],
				changedPaths: [],
				conflicts: [],
				files: [],
				rootPath,
				scannedAt: new Date().toISOString(),
				stories: [other],
				storyIds: [other.id]
			}))
		};

		await expect(
			service(coreHost).discoverAndBindProjectFolder(story)
		).resolves.toBeUndefined();
		expect(loadProjectMetadata(story.id)).toBeUndefined();
		expect(coreHost.ensureSessionReady).not.toHaveBeenCalled();
	});

	it.each([
		{
			label: 'becomes dirty',
			latest: {dirty: true, revision: 2}
		},
		{
			label: 'advances revision',
			latest: {dirty: false, revision: 3}
		}
	])(
		'aborts folder discovery when the source session $label',
		async ({latest}) => {
			const story = fakeStory();
			const sessionStatus = jest
				.fn()
				.mockReturnValueOnce({dirty: false, revision: 2})
				.mockReturnValue(latest);
			const coreHost = host({sessionStatus});

			(window as any).twineElectron = {
				getStoryLibraryFolder: jest.fn(async () => '/native/library'),
				projectSessionSnapshot: jest.fn(async rootPath => ({
					assets: [],
					changedPaths: [],
					conflicts: [],
					files: [],
					rootPath,
					scannedAt: new Date().toISOString(),
					stories: [story],
					storyIds: [story.id]
				}))
			};

			await expect(
				service(coreHost).discoverAndBindProjectFolder(story)
			).resolves.toBeUndefined();
			expect(sessionStatus).toHaveBeenCalledTimes(2);
			expect(loadProjectMetadata(story.id)).toBeUndefined();
			expect(coreHost.ensureSessionReady).not.toHaveBeenCalled();
		}
	);

	it('waits for admitted mutations before committing a discovered folder', async () => {
		const story = fakeStory();
		let revision = 2;
		let releaseMutation!: () => void;
		let signalDrainStarted!: () => void;
		const mutationReleased = new Promise<void>(resolve => {
			releaseMutation = resolve;
		});
		const drainStarted = new Promise<void>(resolve => {
			signalDrainStarted = resolve;
		});
		const coreHost = host({
			drainMutations: jest.fn(async () => {
				signalDrainStarted();
				await mutationReleased;
			}),
			sessionStatus: jest.fn(() => ({
				canRedo: false,
				canUndo: false,
				dirty: false,
				redoKind: null,
				revision,
				undoKind: null
			}))
		});

		(window as any).twineElectron = {
			getStoryLibraryFolder: jest.fn(async () => '/native/library'),
			projectSessionSnapshot: jest.fn(async rootPath => ({
				assets: [],
				changedPaths: [],
				conflicts: [],
				files: [],
				rootPath,
				scannedAt: new Date().toISOString(),
				stories: [story],
				storyIds: [story.id]
			}))
		};

		const discovery = service(coreHost).discoverAndBindProjectFolder(story);

		await drainStarted;
		expect(loadProjectMetadata(story.id)).toBeUndefined();
		revision = 3;
		releaseMutation();
		await expect(discovery).resolves.toBeUndefined();
		expect(coreHost.ensureSessionReady).not.toHaveBeenCalled();
	});

	it('installs the verified native inventory before binding the session', async () => {
		const story = fakeStory();
		const rootPath = defaultProjectFolderRoot('/native/library', story.name);
		const assets = [
			{
				normalizedPath: 'assets/cover.png',
				path: 'assets/cover.png'
			}
		] as CoreAssetInventoryEntry[];
		const ensureSessionReady = jest.fn(async () => {
			expect(knownAssetInventoryForStory(story.id)).toEqual(assets);
		});
		const coreHost = host({ensureSessionReady});

		(window as any).twineElectron = {
			getStoryLibraryFolder: jest.fn(async () => '/native/library'),
			projectSessionSnapshot: jest.fn(async () => ({
				assets,
				changedPaths: [],
				conflicts: [],
				files: [],
				rootPath,
				scannedAt: new Date().toISOString(),
				stories: [story],
				storyIds: [story.id]
			}))
		};

		await expect(
			service(coreHost).discoverAndBindProjectFolder(story)
		).resolves.toEqual(expect.objectContaining({rootPath}));
		expect(loadProjectMetadata(story.id)?.rootPath).toBe(rootPath);
		expect(ensureSessionReady).toHaveBeenCalledWith(story.id);
		expect(
			(window as any).twineElectron.projectSessionSnapshot
		).toHaveBeenCalledWith(rootPath);
	});

	it('durably rolls back local admission before forgetting a failed mixed cohort', async () => {
		const nativeStory = fakeStory();
		const localStory = fakeStory();
		const admitProjectStories = jest
			.fn()
			.mockResolvedValueOnce(undefined)
			.mockRejectedValueOnce(new Error('native admission failed'));
		const deleteProjectStories = jest.fn(async () => undefined);
		const retireProjectStories = jest.fn(async () => undefined);
		const coreHost = host({
			admitProjectStories,
			deleteProjectStories,
			retireProjectStories
		});

		saveProjectMetadata(nativeStory.id, {
			rootPath: '/native/project.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		saveProjectMetadata(localStory.id, {
			status: 'local-only',
			storageKind: 'web-local'
		});
		(window as any).twineElectron = {
			listProjectAssets: jest.fn(async () => [])
		};

		await expect(
			service(coreHost).admitProjectStories([nativeStory, localStory])
		).rejects.toThrow('native admission failed');
		expect(admitProjectStories).toHaveBeenNthCalledWith(1, [localStory], {
			history: 'skip',
			persistence: 'save',
			persistenceBarrier: true
		});
		expect(admitProjectStories).toHaveBeenNthCalledWith(2, [nativeStory], {
			history: 'skip',
			persistence: 'skip'
		});
		expect(deleteProjectStories).toHaveBeenCalledWith([localStory.id], {
			history: 'skip',
			persistence: 'save',
			persistenceBarrier: true
		});
		expect(retireProjectStories).toHaveBeenCalledWith([localStory.id]);
		expect(loadProjectMetadata(nativeStory.id)).toBeUndefined();
		expect(loadProjectMetadata(localStory.id)).toBeUndefined();
	});

	it('restores the previous binding when native session admission fails', async () => {
		const story = fakeStory();
		const oldRoot = '/native/old.twine.rs';
		const newRoot = '/native/library/Projects/story.twine.rs';
		const ensureSessionReady = jest
			.fn()
			.mockRejectedValueOnce(new Error('admission failed'))
			.mockResolvedValueOnce(undefined);
		const coreHost = host({ensureSessionReady});

		saveProjectMetadata(story.id, {
			status: 'local-only',
			storageKind: 'web-local'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: true,
			rootPath: oldRoot
		});
		(window as any).twineElectron = {
			getStoryLibraryFolder: jest.fn(async () => '/native/library'),
			projectSessionSnapshot: jest.fn(async () => ({
				assets: [],
				changedPaths: [],
				conflicts: [],
				files: [],
				rootPath: newRoot,
				scannedAt: new Date().toISOString(),
				stories: [story],
				storyIds: [story.id]
			}))
		};

		await expect(
			service(coreHost).discoverAndBindProjectFolder(story)
		).rejects.toThrow('admission failed');
		expect(loadProjectMetadata(story.id)).toEqual(
			expect.objectContaining({status: 'local-only', storageKind: 'web-local'})
		);
		expect(projectStoryHydration(story.id)).toEqual(
			expect.objectContaining({passageTextLoaded: true, rootPath: oldRoot})
		);
		expect(ensureSessionReady).toHaveBeenCalledTimes(2);
	});

	it('restores a shared original session as one complete cohort', async () => {
		const first = {...fakeStory(), id: 'first-shared-story'};
		const second = {...fakeStory(), id: 'second-shared-story'};
		const originalRoot = '/native/original-shared.twine.rs';

		first.passages = first.passages.map(passage => ({
			...passage,
			story: first.id
		}));
		second.passages = second.passages.map(passage => ({
			...passage,
			story: second.id
		}));
		const replacements = [first, second].map((story, index) => {
			const assets = [
				{
					normalizedPath: `assets/original-${index}.png`,
					path: `assets/original-${index}.png`
				}
			] as CoreAssetInventoryEntry[];

			saveProjectMetadata(story.id, {
				rootPath: originalRoot,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
			markProjectStoryHydration(story.id, {
				passageTextLoaded: true,
				rootPath: originalRoot
			});
			replaceKnownAssetInventoryForStory(story.id, assets, {
				assetScanComplete: false
			});
			const previous = {
				assets,
				assetScanComplete: false,
				hydration: projectStoryHydration(story.id),
				metadata: loadProjectMetadata(story.id),
				story
			};

			saveProjectMetadata(story.id, {
				rootPath: `/native/replacement-${index}.twine.rs`,
				status: 'file-backed',
				storageKind: 'electron-project-folder'
			});
			replaceKnownAssetInventoryForStory(story.id, [], {
				assetScanComplete: true
			});
			return previous;
		});
		const ensureSessionReady = jest.fn(async () => {
			for (const replacement of replacements) {
				expect(loadProjectMetadata(replacement.story.id)?.rootPath).toBe(
					originalRoot
				);
				expect(knownAssetInventoryForStory(replacement.story.id)).toEqual(
					replacement.assets
				);
				expect(
					knownAssetInventoryScanCompleteForStory(replacement.story.id)
				).toBe(false);
			}
		});
		const coreHost = host({ensureSessionReady});

		await service(coreHost).rollbackProjectReplacements(replacements);
		expect(coreHost.applyStoryCommand).toHaveBeenCalledTimes(2);
		expect(ensureSessionReady).toHaveBeenCalledTimes(1);
		expect(ensureSessionReady).toHaveBeenCalledWith(first.id);
	});

	it('persists an original local story after undoing a temporary native replacement', async () => {
		const original = fakeStory();
		const imported = {
			...original,
			passages: original.passages.map(passage => ({
				...passage,
				text: 'imported replacement body'
			}))
		};

		saveProjectMetadata(original.id, {
			status: 'local-only',
			storageKind: 'web-local'
		});
		markProjectStoryHydration(original.id, {
			passageTextLoaded: true
		});
		const previousMetadata = loadProjectMetadata(original.id);
		const previousHydration = projectStoryHydration(original.id);

		saveProjectMetadata(original.id, {
			rootPath: '/native/temporary-replacement.twine.rs',
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		const ensureSessionReady = jest.fn(async () => {
			expect(loadProjectMetadata(original.id)).toEqual(
				expect.objectContaining({
					status: 'local-only',
					storageKind: 'web-local'
				})
			);
			expect(bootstrapStory(original.id)).toEqual(imported);
		});
		const applyStoryCommandPersisted = jest.fn(async () => undefined);
		const coreHost = host({applyStoryCommandPersisted, ensureSessionReady});

		await service(coreHost).rollbackProjectReplacements([
			{
				assets: [],
				assetScanComplete: false,
				hydration: previousHydration,
				metadata: previousMetadata,
				replacementStory: imported,
				story: original
			}
		]);
		expect(applyStoryCommandPersisted).toHaveBeenCalledWith(
			expect.objectContaining({story_id: original.id, type: 'replaceStory'}),
			{history: 'skip', persistence: 'save'}
		);
		expect(bootstrapStory(original.id)).toBeUndefined();
	});

	it('commits native folder deletion only after retiring its bound session', async () => {
		const story = fakeStory();
		const rootPath = '/native/delete-me.twine.rs';
		const order: string[] = [];
		const retireProjectStories = jest.fn(async () => {
			order.push('retire');
		});
		const coreHost = host({retireProjectStories});

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		(window as any).twineElectron = {
			beginProjectFolderDeletion: jest.fn(async () => {
				order.push('begin');
				return {id: 'delete-transaction', rootPath};
			}),
			commitProjectFolderDeletion: jest.fn(async () => {
				order.push('commit');
			}),
			rollbackProjectFolderDeletion: jest.fn(async () => undefined)
		};

		await service(coreHost).deleteProjectFolder(rootPath, [story]);

		expect(order).toEqual(['begin', 'retire', 'commit']);
		expect(loadProjectMetadata(story.id)).toBeUndefined();
	});

	it('restores the native folder and renderer session when deletion commit fails', async () => {
		const story = fakeStory();
		const rootPath = '/native/delete-retry.twine.rs';
		const rollbackProjectFolderDeletion = jest.fn(async () => undefined);
		const admitProjectStories = jest.fn(async () => undefined);
		const coreHost = host({admitProjectStories});

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: true,
			rootPath
		});
		(window as any).twineElectron = {
			beginProjectFolderDeletion: jest.fn(async () => ({
				id: 'delete-transaction',
				rootPath
			})),
			commitProjectFolderDeletion: jest.fn(async () => {
				throw new Error('journal commit failed');
			}),
			rollbackProjectFolderDeletion
		};

		await expect(
			service(coreHost).deleteProjectFolder(rootPath, [story])
		).rejects.toThrow('journal commit failed');
		expect(rollbackProjectFolderDeletion).toHaveBeenCalledWith(
			'delete-transaction'
		);
		expect(loadProjectMetadata(story.id)).toEqual(
			expect.objectContaining({rootPath, status: 'file-backed'})
		);
		expect(admitProjectStories).toHaveBeenCalledWith(
			[expect.objectContaining({id: story.id})],
			{history: 'skip', persistence: 'skip'}
		);
	});

	it('keeps a project retired when native deletion rollback fails', async () => {
		const story = fakeStory();
		const rootPath = '/native/delete-recovery-required.twine.rs';
		const admitProjectStories = jest.fn(async () => undefined);
		const retireProjectStories = jest.fn(async () => undefined);
		const coreHost = host({admitProjectStories, retireProjectStories});

		saveProjectMetadata(story.id, {
			rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(story.id, {
			passageTextLoaded: true,
			rootPath
		});
		(window as any).twineElectron = {
			beginProjectFolderDeletion: jest.fn(async () => ({
				id: 'delete-transaction',
				rootPath
			})),
			commitProjectFolderDeletion: jest.fn(async () => {
				throw new Error('journal commit failed');
			}),
			rollbackProjectFolderDeletion: jest.fn(async () => {
				throw new Error('native rollback failed');
			})
		};

		await expect(
			service(coreHost).deleteProjectFolder(rootPath, [story])
		).rejects.toThrow(
			'Project deletion failed and native recovery is required'
		);
		expect(loadProjectMetadata(story.id)).toBeUndefined();
		expect(projectStoryHydration(story.id)).toBeUndefined();
		expect(retireProjectStories).toHaveBeenCalledTimes(1);
		expect(admitProjectStories).not.toHaveBeenCalled();
	});
});
