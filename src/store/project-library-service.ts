import {v4 as uuid} from '@lukeed/uuid';
import * as React from 'react';
import type {
	NativeProjectFolderResult,
	NativeProjectDeletionTransaction,
	NativeProjectImportSource,
	NativeProjectReplacementTransaction,
	NativeProjectSessionSnapshot,
	ProjectSourceLayout,
	ProjectStoryReplacement,
	TwineElectronWindow
} from '../electron/shared';
import type {CoreAssetInventoryEntry} from '../core';
import {
	coreSessionIdForStory,
	knownAssetInventoryForStory,
	knownAssetInventoryScanCompleteForStory,
	materializeRegisteredStory,
	registerStoryDocuments,
	replaceKnownAssetInventoryForStory,
	releaseBootstrapStory,
	replaceStoryCommand,
	storyToSnapshot,
	useCoreProjectHost
} from '../core';
import {unusedName} from '../util/unused-name';
import {
	defaultProjectFolderRoot,
	deleteProjectMetadata,
	loadProjectMetadata,
	saveProjectMetadata
} from './project-metadata';
import {
	clearProjectStoryHydration,
	markProjectStoryHydration,
	projectStoryHydration
} from './project-hydration';
import {
	mergeProjectStories,
	projectStoryIdsForCurrentStories
} from './merge-project-stories';
import type {StoriesActionOrThunk, Story, StoryWithDocuments} from './stories';
import {useStoriesContext} from './stories';
import {
	clearLocalReplacementRecovery,
	prepareLocalReplacementRecovery,
	sealLocalReplacementRecovery
} from './persistence/local-storage/stories/replacement-recovery';
import {workbenchBufferCoordinator} from '../util/workbench-buffer-coordinator';

function bridge() {
	return (window as TwineElectronWindow).twineElectron;
}

function projectCreationErrorMessage(error: unknown, storyName: string) {
	const message = error instanceof Error ? error.message : String(error);

	if (
		message.includes(
			'A new project cannot replace an existing filesystem entry.'
		)
	) {
		return `A project named "${storyName}" already exists in this folder. Choose a different name.`;
	}
	if (
		/\b(?:EACCES|EPERM)\b|permission denied|operation not permitted|access is denied/i.test(
			message
		)
	) {
		return 'Twine could not access the project folder. Check its permissions or choose a different project folder.';
	}

	return message.replace(
		/^Error invoking remote method 'create-project-folder': Error:\s*/,
		''
	);
}

function duplicatedStory(
	story: StoryWithDocuments,
	reservedStories: Story[]
): StoryWithDocuments {
	const id = uuid();
	const passages = story.passages.map(passage => ({
		...passage,
		id: uuid(),
		story: id
	}));
	const startIndex = story.passages.findIndex(
		passage => passage.id === story.startPassage
	);

	return {
		...story,
		id,
		ifid: uuid(),
		name: unusedName(
			story.name,
			reservedStories.map(candidate => candidate.name)
		),
		passages,
		startPassage: startIndex >= 0 ? (passages[startIndex]?.id ?? '') : ''
	};
}

export class ProjectLibraryService {
	constructor(
		private readonly coreProjectHost: ReturnType<typeof useCoreProjectHost>,
		private readonly dispatch: ReturnType<typeof useStoriesContext>['dispatch'],
		private readonly getStories: () => Story[]
	) {}

	isDesktop() {
		return !!bridge();
	}

	canDeleteProjectFolder(rootPath: string | undefined) {
		return !!rootPath && !!bridge()?.beginProjectFolderDeletion;
	}

	canConsumeCommandLineOpenRequests() {
		return !!bridge()?.consumeCommandLineOpenRequests;
	}

	willDeleteLegacyStoryFile() {
		return !!bridge()?.deleteStory;
	}

	filePathForFile(file: File) {
		try {
			const path = bridge()?.filePathForFile?.(file);

			if (path?.trim()) {
				return path;
			}
		} catch {
			// Fall back to Electron versions that exposed File.path directly.
		}

		const legacyPath = (file as File & {path?: string}).path;

		return legacyPath?.trim() ? legacyPath : undefined;
	}

	getStoryLibraryFolder() {
		return bridge()?.getStoryLibraryFolder?.();
	}

	openProjectFolder(options: {loadPassageText?: boolean} = {}) {
		return bridge()?.openProjectFolder?.(options);
	}

	consumeCommandLineOpenRequests() {
		const operation = bridge()?.consumeCommandLineOpenRequests?.();

		return (
			operation ??
			Promise.reject(
				new Error('The desktop command-line project bridge is unavailable.')
			)
		);
	}

	onCommandLineOpenRequest(callback: () => void) {
		return bridge()?.onCommandLineOpenRequest?.(callback);
	}

	hydrateProjectFolder(rootPath: string, storyIds?: string[]) {
		const operation = bridge()?.hydrateProjectFolder?.(rootPath, storyIds);

		return (
			operation ??
			Promise.reject(
				new Error('The desktop project-folder hydration bridge is unavailable.')
			)
		);
	}

	async admitOpenedProject(result: NativeProjectFolderResult) {
		const admitted = this.admitOpenedProjects([result]);

		return admitted.stories;
	}

	admitOpenedProjects(results: NativeProjectFolderResult[]) {
		const stories = this.getStories();
		const storyIds: string[] = [];
		let shellStories = stories;

		for (const result of results) {
			const storeStoryIds = projectStoryIdsForCurrentStories(
				shellStories,
				result.stories,
				{preserveExistingIdentity: false}
			);

			for (const [index, story] of result.stories.entries()) {
				const storyId = storeStoryIds[index] ?? story.id;

				this.commitProjectFolder(storyId, result);
				storyIds.push(storyId);
			}
			shellStories = mergeProjectStories(shellStories, result.stories, {
				preserveExistingIdentity: false
			});
		}

		if (storyIds.length > 0) {
			this.dispatch({state: shellStories, type: 'init'});
		}
		return {stories: shellStories, storyIds};
	}

	prepareProjectImport(sourcePath: string) {
		return bridge()?.prepareProjectImport?.(sourcePath);
	}

	discardProjectImport(importId: string) {
		return bridge()?.discardProjectImport?.(importId) ?? Promise.resolve();
	}

	copyProjectImportAssets(importId: string, rootPath: string) {
		return bridge()?.copyProjectImportAssets?.(importId, rootPath);
	}

	beginProjectReplacement(
		rootPath: string,
		stories: StoryWithDocuments[],
		importId?: string
	): Promise<NativeProjectReplacementTransaction> {
		const operation = bridge()?.beginProjectReplacement?.(
			rootPath,
			stories,
			importId
		);

		return (
			operation ??
			Promise.reject(
				new Error('The native project replacement bridge is unavailable.')
			)
		);
	}

	commitProjectReplacements(transactionIds: string[]) {
		return (
			bridge()?.commitProjectReplacements?.(transactionIds) ??
			Promise.reject(
				new Error('The native project replacement bridge is unavailable.')
			)
		);
	}

	rollbackProjectReplacement(transactionId: string) {
		return (
			bridge()?.rollbackProjectReplacement?.(transactionId) ??
			Promise.reject(
				new Error('The native project replacement bridge is unavailable.')
			)
		);
	}

	beginProjectFolderDeletion(
		rootPath: string
	): Promise<NativeProjectDeletionTransaction> {
		return (
			bridge()?.beginProjectFolderDeletion?.(rootPath) ??
			Promise.reject(
				new Error('The native project deletion bridge is unavailable.')
			)
		);
	}

	commitProjectFolderDeletion(transactionId: string) {
		return (
			bridge()?.commitProjectFolderDeletion?.(transactionId) ??
			Promise.reject(
				new Error('The native project deletion bridge is unavailable.')
			)
		);
	}

	rollbackProjectFolderDeletion(transactionId: string) {
		return (
			bridge()?.rollbackProjectFolderDeletion?.(transactionId) ??
			Promise.reject(
				new Error('The native project deletion bridge is unavailable.')
			)
		);
	}

	listProjectAssets(rootPath: string): Promise<CoreAssetInventoryEntry[]> {
		const operation = bridge()?.listProjectAssets?.(rootPath);

		return (
			operation ??
			Promise.reject(
				new Error('The desktop project-folder asset bridge is unavailable.')
			)
		);
	}

	async createProjectFolder(
		story: StoryWithDocuments,
		preferredParent?: string,
		sourceLayout?: ProjectSourceLayout,
		options: {commitProjectState?: boolean} = {}
	) {
		const nativeBridge = bridge();

		if (!nativeBridge?.createProjectFolder) {
			if (options.commitProjectState ?? true) {
				saveProjectMetadata(story.id, {
					status: 'local-only',
					storageKind: 'web-local'
				});
			}
			return undefined;
		}

		let result: NativeProjectFolderResult;

		try {
			result = sourceLayout
				? await nativeBridge.createProjectFolder(
						story,
						preferredParent,
						sourceLayout
					)
				: await nativeBridge.createProjectFolder(story, preferredParent);
		} catch (error) {
			throw new Error(projectCreationErrorMessage(error, story.name));
		}

		if (options.commitProjectState ?? true) {
			this.commitProjectFolder(story.id, result);
		}
		return result;
	}

	commitProjectFolder(storyId: string, result: NativeProjectFolderResult) {
		saveProjectMetadata(storyId, {
			rootPath: result.rootPath,
			status: 'file-backed',
			storageKind: 'electron-project-folder'
		});
		markProjectStoryHydration(storyId, {
			passageTextLoaded: result.passageTextLoaded !== false,
			rootPath: result.rootPath
		});
	}

	commitLocalProject(storyId: string) {
		saveProjectMetadata(storyId, {
			status: 'local-only',
			storageKind: 'web-local'
		});
	}

	prepareLocalReplacementRecovery(stories: StoryWithDocuments[]) {
		prepareLocalReplacementRecovery(stories);
	}

	clearLocalReplacementRecovery() {
		clearLocalReplacementRecovery();
	}

	sealLocalReplacementRecovery() {
		sealLocalReplacementRecovery();
	}

	async createProject(
		story: StoryWithDocuments,
		preferredParent?: string,
		sourceLayout?: ProjectSourceLayout
	) {
		const result = await this.createProjectFolder(
			story,
			preferredParent,
			sourceLayout
		);
		if (result) {
			// A freshly created project cannot contain assets yet. Publish that
			// completed empty scan before Core readiness or save acknowledgement can
			// wait on the native inventory barrier.
			replaceKnownAssetInventoryForStory(story.id, []);
		}

		try {
			await this.coreProjectHost.admitProjectStories([story], {
				history: 'skip',
				persistence: result ? 'skip' : 'save',
				persistenceBarrier: !result
			});
		} catch (error) {
			await this.cleanupFailedProject(story.id, result?.rootPath, error);
			throw error;
		}
		if (result) {
			await this.acknowledgeStoriesSaved([story]);
		}
		return result;
	}

	async admitProjectStories(stories: StoryWithDocuments[]) {
		const nativeStories: StoryWithDocuments[] = [];
		const localStories: StoryWithDocuments[] = [];
		const admittedStories: StoryWithDocuments[] = [];

		for (const story of stories) {
			const fileBacked =
				loadProjectMetadata(story.id)?.storageKind ===
				'electron-project-folder';

			(fileBacked ? nativeStories : localStories).push(story);
		}
		await this.ensureNativeAssetInventories(nativeStories);

		try {
			if (localStories.length > 0) {
				await this.coreProjectHost.admitProjectStories(localStories, {
					history: 'skip',
					persistence: 'save',
					persistenceBarrier: true
				});
				admittedStories.push(...localStories);
			}
			if (nativeStories.length > 0) {
				await this.coreProjectHost.admitProjectStories(nativeStories, {
					history: 'skip',
					persistence: 'skip'
				});
				admittedStories.push(...nativeStories);
				await this.acknowledgeStoriesSaved(nativeStories);
			}
		} catch (error) {
			try {
				await this.rollbackProjectAdmissions(admittedStories);
				for (const story of stories) {
					this.forgetProject(story.id);
				}
			} catch (rollbackError) {
				throw new AggregateError(
					[error, rollbackError],
					'Project admission failed and an admitted session could not be retired safely.',
					{cause: error}
				);
			}
			throw error;
		}
	}

	async duplicateProject(
		sourceStories: StoryWithDocuments[],
		reservedStories: Story[],
		rootPath?: string
	) {
		const reserved = [...reservedStories];
		const duplicates = sourceStories.map(story => {
			const duplicate = duplicatedStory(story, reserved);

			reserved.push(duplicate);
			return duplicate;
		});

		if (!rootPath) {
			for (const story of duplicates) {
				saveProjectMetadata(story.id, {
					status: 'local-only',
					storageKind: 'web-local'
				});
			}
			try {
				await this.coreProjectHost.admitProjectStories(duplicates, {
					history: 'skip',
					persistence: 'save',
					persistenceBarrier: true
				});
			} catch (error) {
				for (const story of duplicates) {
					this.forgetProject(story.id);
				}
				throw error;
			}
			return duplicates;
		}

		const nativeBridge = bridge();

		if (!nativeBridge?.duplicateProjectFolder) {
			throw new Error(
				'The desktop project-folder duplication bridge is unavailable.'
			);
		}
		const replacements: ProjectStoryReplacement[] = sourceStories.map(
			(sourceStory, index) => ({
				passageIds: sourceStory.passages.map((sourcePassage, passageIndex) => ({
					duplicatePassageId: duplicates[index].passages[passageIndex].id,
					sourcePassageId: sourcePassage.id
				})),
				sourceStoryId: sourceStory.id,
				story: duplicates[index]
			})
		);
		const result = await nativeBridge.duplicateProjectFolder(
			rootPath,
			replacements
		);

		try {
			for (const story of result.stories) {
				this.commitProjectFolder(story.id, result);
			}
			await this.ensureNativeAssetInventories(result.stories);
			await this.coreProjectHost.admitProjectStories(result.stories, {
				history: 'skip',
				persistence: 'skip'
			});
		} catch (error) {
			for (const story of result.stories) {
				this.forgetProject(story.id);
			}
			try {
				await nativeBridge.deleteProjectFolder(result.rootPath);
			} catch (cleanupError) {
				throw new Error(
					`${(error as Error).message}. The copied folder remains at ${
						result.rootPath
					}: ${(cleanupError as Error).message}`
				);
			}
			throw error;
		}
		await this.acknowledgeStoriesSaved(result.stories);
		return result.stories;
	}

	/**
	 * Discovers a legacy project folder only when the native snapshot proves it
	 * contains this exact story. The metadata change and core-session rebind are
	 * one lifecycle operation; failure restores the previous binding.
	 */
	async discoverAndBindProjectFolder(
		story: Story
	): Promise<NativeProjectSessionSnapshot | undefined> {
		if (loadProjectMetadata(story.id)?.rootPath) {
			return undefined;
		}
		const initialStatus = this.coreProjectHost.sessionStatus(story.id);

		if (initialStatus.dirty) {
			return undefined;
		}
		const nativeBridge = bridge();

		if (
			!nativeBridge?.getStoryLibraryFolder ||
			!nativeBridge.projectSessionSnapshot
		) {
			return undefined;
		}
		const storyLibraryFolder = await nativeBridge.getStoryLibraryFolder();
		const rootPath = defaultProjectFolderRoot(storyLibraryFolder, story.name);
		const currentStory = await materializeRegisteredStory(story);
		const snapshot = await nativeBridge.projectSessionSnapshot(rootPath);
		const snapshotStory = snapshot.stories.find(
			candidate => candidate.id === story.id && candidate.ifid === story.ifid
		);

		if (
			!snapshotStory ||
			JSON.stringify(storyToSnapshot(snapshotStory)) !==
				JSON.stringify(storyToSnapshot(currentStory))
		) {
			return undefined;
		}
		// A command may have been admitted while native discovery was awaiting I/O
		// without having reached the session status yet. Drain those commands before
		// the final revision check. The binding commit below is synchronous after the
		// check, so another renderer task cannot interleave an edit with publication.
		await this.coreProjectHost.drainMutations();
		const latestStatus = this.coreProjectHost.sessionStatus(story.id);

		if (
			latestStatus.dirty ||
			latestStatus.revision !== initialStatus.revision
		) {
			// Discovery crossed an edit or another session mutation. Do not publish
			// the older native snapshot as the new binding.
			return undefined;
		}
		const previousMetadata = loadProjectMetadata(story.id);
		const previousHydration = projectStoryHydration(story.id);
		const previousAssets = [...knownAssetInventoryForStory(story.id)];
		const previousAssetScanComplete = knownAssetInventoryScanCompleteForStory(
			story.id
		);

		registerStoryDocuments(snapshotStory);
		try {
			replaceKnownAssetInventoryForStory(story.id, snapshot.assets);
			this.commitProjectFolder(story.id, {
				passageTextLoaded: true,
				rootPath: snapshot.rootPath,
				stories: snapshot.stories,
				storyIds: snapshot.storyIds
			});
			await this.coreProjectHost.ensureSessionReady(story.id);
			return snapshot;
		} catch (error) {
			this.restoreProjectBinding(story.id, previousMetadata, previousHydration);
			replaceKnownAssetInventoryForStory(story.id, previousAssets, {
				assetScanComplete: previousAssetScanComplete
			});
			registerStoryDocuments(currentStory);
			try {
				await this.coreProjectHost.ensureSessionReady(story.id);
			} catch (restoreError) {
				throw new AggregateError(
					[error, restoreError],
					`Project folder binding failed and the previous session could not be restored for story "${story.name}".`,
					{cause: error}
				);
			}
			throw error;
		} finally {
			releaseBootstrapStory(story.id);
		}
	}

	async rollbackProjectAdmissions(stories: Story[]) {
		if (stories.length === 0) {
			return;
		}
		const localStoryIds = stories
			.filter(
				story =>
					loadProjectMetadata(story.id)?.storageKind !==
					'electron-project-folder'
			)
			.map(story => story.id);

		if (localStoryIds.length > 0) {
			await this.coreProjectHost.deleteProjectStories(localStoryIds, {
				history: 'skip',
				persistence: 'save',
				persistenceBarrier: true
			});
		}
		await this.coreProjectHost.retireProjectStories(
			stories.map(story => story.id)
		);
		for (const story of stories) {
			this.forgetProject(story.id);
		}
	}

	forgetProjectBindings(stories: Story[]) {
		for (const story of stories) {
			this.forgetProject(story.id);
		}
	}

	async rollbackProjectReplacements(
		replacements: Array<{
			assets: CoreAssetInventoryEntry[];
			assetScanComplete: boolean;
			hydration: ReturnType<typeof projectStoryHydration>;
			metadata: ReturnType<typeof loadProjectMetadata>;
			replacementStory?: StoryWithDocuments;
			story: StoryWithDocuments;
		}>
	) {
		const wasFileBacked = (replacement: (typeof replacements)[number]) =>
			replacement.metadata?.storageKind === 'electron-project-folder' &&
			replacement.metadata.status === 'file-backed';

		for (const replacement of replacements.filter(wasFileBacked)) {
			await this.coreProjectHost.applyStoryCommand(
				replaceStoryCommand(replacement.story.id, replacement.story),
				{history: 'skip', persistence: 'skip'}
			);
		}
		const appliedLocalReplacements = replacements.filter(
			replacement => !wasFileBacked(replacement) && replacement.replacementStory
		);

		// A desktop import can temporarily bind a previously local story to a new
		// native folder. Seed its restored local session with the imported value so
		// the compensating replace command emits and persists the original value.
		for (const replacement of appliedLocalReplacements) {
			registerStoryDocuments(replacement.replacementStory!);
		}

		try {
			// Publish every original binding before asking Core to rebind any one
			// story. Stories that shared a project session must be visible as a full
			// cohort when ProjectScopedCoreProjectHost rebuilds that session.
			for (const replacement of replacements) {
				this.restoreProjectBinding(
					replacement.story.id,
					replacement.metadata,
					replacement.hydration
				);
				replaceKnownAssetInventoryForStory(
					replacement.story.id,
					replacement.assets,
					{assetScanComplete: replacement.assetScanComplete}
				);
			}

			const readySessions = new Set<string>();

			for (const replacement of replacements) {
				const sessionId = coreSessionIdForStory(replacement.story);

				if (readySessions.has(sessionId)) {
					continue;
				}
				readySessions.add(sessionId);
				await this.coreProjectHost.ensureSessionReady(replacement.story.id);
			}

			for (const replacement of appliedLocalReplacements) {
				await this.coreProjectHost.applyStoryCommandPersisted(
					replaceStoryCommand(replacement.story.id, replacement.story),
					{history: 'skip', persistence: 'save'}
				);
			}
		} finally {
			for (const replacement of appliedLocalReplacements) {
				releaseBootstrapStory(replacement.story.id);
			}
		}
	}

	async deleteProjectFolder(rootPath: string, stories: Story[]) {
		for (const story of stories) {
			await workbenchBufferCoordinator.flushStory(story.id);
		}
		const lazySnapshot = stories.some(
			story => projectStoryHydration(story.id)?.passageTextLoaded === false
		)
			? await this.projectDeletionSnapshot(rootPath, stories)
			: undefined;
		const originals = lazySnapshot
			? stories.map(story => {
					const original = lazySnapshot.stories.find(
						candidate =>
							candidate.id === story.id && candidate.ifid === story.ifid
					);

					if (!original) {
						throw new Error(
							`The native project snapshot does not contain story "${story.id}".`
						);
					}
					return original;
				})
			: await Promise.all(
					stories.map(story => materializeRegisteredStory(story))
				);
		const bindings = stories.map(story => ({
			assets: lazySnapshot
				? [...lazySnapshot.assets]
				: [...knownAssetInventoryForStory(story.id)],
			assetScanComplete:
				!!lazySnapshot || knownAssetInventoryScanCompleteForStory(story.id),
			hydration: lazySnapshot
				? {
						...projectStoryHydration(story.id),
						passageTextLoaded: true,
						revision: projectStoryHydration(story.id)?.revision ?? 0,
						rootPath
					}
				: projectStoryHydration(story.id),
			metadata: loadProjectMetadata(story.id),
			storyId: story.id
		}));
		const transaction = await this.beginProjectFolderDeletion(rootPath);
		let retired = false;

		try {
			for (const story of stories) {
				this.forgetProject(story.id);
			}
			await this.coreProjectHost.retireProjectStories(
				stories.map(story => story.id)
			);
			retired = true;
			await this.commitProjectFolderDeletion(transaction.id);
		} catch (error) {
			const rollbackErrors: unknown[] = [];
			let nativeRollbackSucceeded = false;

			try {
				await this.rollbackProjectFolderDeletion(transaction.id);
				nativeRollbackSucceeded = true;
			} catch (rollbackError) {
				rollbackErrors.push(rollbackError);
			}
			if (!nativeRollbackSucceeded) {
				if (!retired) {
					try {
						await this.coreProjectHost.retireProjectStories(
							stories.map(story => story.id)
						);
					} catch (rollbackError) {
						rollbackErrors.push(rollbackError);
					}
				}
				throw new AggregateError(
					[error, ...rollbackErrors],
					'Project deletion failed and native recovery is required before the project can be reopened.',
					{cause: error}
				);
			}
			for (const binding of bindings) {
				this.restoreProjectBinding(
					binding.storyId,
					binding.metadata,
					binding.hydration
				);
				replaceKnownAssetInventoryForStory(binding.storyId, binding.assets, {
					assetScanComplete: binding.assetScanComplete
				});
			}
			if (retired) {
				try {
					await this.coreProjectHost.admitProjectStories(originals, {
						history: 'skip',
						persistence: 'skip'
					});
				} catch (rollbackError) {
					rollbackErrors.push(rollbackError);
				}
			}
			if (rollbackErrors.length > 0) {
				throw new AggregateError(
					[error, ...rollbackErrors],
					'Project deletion failed and its prior project state could not be fully restored.',
					{cause: error}
				);
			}
			throw error;
		}
	}

	async deleteStory(story: Story) {
		await this.coreProjectHost.deleteProjectStories([story.id], {
			history: 'skip',
			persistence: 'save',
			persistenceBarrier: true
		});
		this.forgetProject(story.id);
	}

	async removeProjectFolder(rootPath: string) {
		const operation = bridge()?.deleteProjectFolder?.(rootPath);

		if (!operation) {
			throw new Error(
				'The desktop project-folder deletion bridge is unavailable.'
			);
		}
		await operation;
	}

	private forgetProject(storyId: string) {
		deleteProjectMetadata(storyId);
		clearProjectStoryHydration(storyId);
		replaceKnownAssetInventoryForStory(storyId, [], {
			assetScanComplete: false
		});
	}

	private async acknowledgeStoriesSaved(stories: Story[]) {
		const acknowledgedSessions = new Set<string>();

		for (const story of stories) {
			const sessionId = coreSessionIdForStory(story);

			if (acknowledgedSessions.has(sessionId)) {
				continue;
			}
			acknowledgedSessions.add(sessionId);
			try {
				await this.coreProjectHost.acknowledgeSaved(
					sessionId,
					this.coreProjectHost.sessionStatus(story.id).revision
				);
			} catch (error) {
				// The native folder already contains the admitted project. Keep the
				// session dirty so a later save can retry acknowledgement; deleting a
				// valid folder here would leave the admitted renderer session dangling.
				console.error(
					`Could not acknowledge saved project session "${sessionId}": ${error}`
				);
			}
		}
	}

	private async ensureNativeAssetInventories(stories: Story[]) {
		const storiesByRoot = new Map<string, Story[]>();

		for (const story of stories) {
			if (knownAssetInventoryScanCompleteForStory(story.id)) {
				continue;
			}
			const rootPath = loadProjectMetadata(story.id)?.rootPath;

			if (!rootPath) {
				continue;
			}
			storiesByRoot.set(rootPath, [
				...(storiesByRoot.get(rootPath) ?? []),
				story
			]);
		}

		for (const [rootPath, projectStories] of storiesByRoot) {
			const inventory = await this.listProjectAssets(rootPath);

			for (const story of projectStories) {
				replaceKnownAssetInventoryForStory(story.id, inventory);
			}
		}
	}

	private async projectDeletionSnapshot(rootPath: string, stories: Story[]) {
		const nativeBridge = bridge();

		if (!nativeBridge?.projectSessionSnapshot) {
			throw new Error(
				'An unopened project cannot be deleted without a native project snapshot.'
			);
		}
		const snapshot = await nativeBridge.projectSessionSnapshot(rootPath);
		for (const story of stories) {
			const identityMatches = snapshot.stories.filter(
				candidate => candidate.id === story.id && candidate.ifid === story.ifid
			);

			if (identityMatches.length !== 1) {
				throw new Error(
					`The native project snapshot does not contain exactly one story matching "${story.id}" and its IFID.`
				);
			}
		}
		return snapshot;
	}

	private restoreProjectBinding(
		storyId: string,
		metadata: ReturnType<typeof loadProjectMetadata>,
		hydration: ReturnType<typeof projectStoryHydration>
	) {
		if (metadata) {
			saveProjectMetadata(storyId, {
				createdAt: metadata.createdAt,
				rootPath: metadata.rootPath,
				status: metadata.status,
				storageKind: metadata.storageKind
			});
		} else {
			deleteProjectMetadata(storyId);
		}
		if (hydration) {
			markProjectStoryHydration(storyId, {
				passageTextLoaded: hydration.passageTextLoaded,
				rootPath: hydration.rootPath
			});
		} else {
			clearProjectStoryHydration(storyId);
		}
	}

	private async cleanupFailedProject(
		storyId: string,
		rootPath: string | undefined,
		cause: unknown
	) {
		this.forgetProject(storyId);
		if (!rootPath) {
			return;
		}
		try {
			await this.removeProjectFolder(rootPath);
		} catch (cleanupError) {
			throw new AggregateError(
				[cause, cleanupError],
				`Project admission failed and the incomplete folder could not be removed: ${rootPath}`,
				{cause}
			);
		}
	}
}

export function useProjectLibraryService() {
	const coreProjectHost = useCoreProjectHost();
	const {dispatch, stories} = useStoriesContext();
	const dispatchRef = React.useRef(dispatch);
	const storiesRef = React.useRef(stories);

	dispatchRef.current = dispatch;
	storiesRef.current = stories;

	return React.useMemo(
		() =>
			new ProjectLibraryService(
				coreProjectHost,
				(action: StoriesActionOrThunk) => dispatchRef.current(action),
				() => storiesRef.current
			),
		[coreProjectHost]
	);
}

export type {NativeProjectFolderResult, NativeProjectImportSource};
