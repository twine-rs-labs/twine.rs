import * as React from 'react';
import {
	NativeProjectSessionSnapshot,
	TwineElectronWindow
} from '../electron/shared';
import {
	coreSessionIdForStory,
	passageToSnapshot,
	replaceKnownAssetInventoryForStory,
	storyToSnapshot,
	useCoreProjectHost
} from '../core';
import type {CoreExternalDelta} from '../core/bindings/CoreExternalDelta';
import {markProjectStoryHydration} from './project-hydration';
import {loadProjectMetadata, saveProjectMetadata} from './project-metadata';
import {Story, useStoriesContext} from './stories';
import {markPerformance} from '../util/performance';
import './project-session-sync.css';

interface PendingProjectReview {
	rootPath: string;
	snapshot: NativeProjectSessionSnapshot;
}

function reviveSessionStory(story: Story): Story {
	return {
		...story,
		lastUpdate: new Date(story.lastUpdate)
	};
}

function externalDelta(current: Story[], incoming: Story[]): CoreExternalDelta {
	const incomingIds = new Set(incoming.map(story => story.id));
	const currentById = new Map(current.map(story => [story.id, story]));
	const changes: CoreExternalDelta['changes'] = current
		.filter(story => !incomingIds.has(story.id))
		.map(story => ({
			story_id: story.id,
			type: 'deleteStory' as const
		}));

	for (const story of incoming) {
		const previous = currentById.get(story.id);

		if (!previous) {
			changes.push({story: storyToSnapshot(story), type: 'upsertStory'});
			continue;
		}

		const previousShell = {
			...storyToSnapshot(previous),
			passages: [],
			script: '',
			stylesheet: ''
		};
		const nextShell = {
			...storyToSnapshot(story),
			passages: [],
			script: '',
			stylesheet: ''
		};

		if (JSON.stringify(previousShell) !== JSON.stringify(nextShell)) {
			changes.push({story: storyToSnapshot(story), type: 'upsertStory'});
			continue;
		}

		if (previous.script !== story.script) {
			changes.push({
				script: story.script,
				story_id: story.id,
				type: 'updateStoryScript'
			});
		}
		if (previous.stylesheet !== story.stylesheet) {
			changes.push({
				story_id: story.id,
				stylesheet: story.stylesheet,
				type: 'updateStoryStylesheet'
			});
		}

		const nextPassageIds = new Set(story.passages.map(passage => passage.id));
		for (const passage of previous.passages) {
			if (!nextPassageIds.has(passage.id)) {
				changes.push({
					passage_id: passage.id,
					story_id: story.id,
					type: 'deletePassage'
				});
			}
		}
		const previousPassages = new Map(
			previous.passages.map(passage => [passage.id, passage])
		);
		for (const passage of story.passages) {
			const previousPassage = previousPassages.get(passage.id);

			if (
				!previousPassage ||
				JSON.stringify(passageToSnapshot(previousPassage)) !==
					JSON.stringify(passageToSnapshot(passage))
			) {
				changes.push({
					passage: passageToSnapshot(passage),
					story_id: story.id,
					type: 'upsertPassage'
				});
			}
		}
	}

	return {changes};
}

function rememberSessionSnapshot(snapshot: NativeProjectSessionSnapshot) {
	markPerformance('session-baseline-ready');
	markPerformance('asset-inventory-ready');

	for (const storyId of snapshot.storyIds) {
		replaceKnownAssetInventoryForStory(storyId, snapshot.assets);
	}
}

function projectRootsForStories(stories: Story[]) {
	const roots = new Map<string, Story[]>();

	for (const story of stories) {
		const metadata = loadProjectMetadata(story.id);

		if (
			metadata?.storageKind !== 'electron-project-folder' ||
			metadata.status !== 'file-backed' ||
			!metadata.rootPath
		) {
			continue;
		}

		roots.set(metadata.rootPath, [
			...(roots.get(metadata.rootPath) ?? []),
			story
		]);
	}

	return roots;
}

export const ProjectSessionSync: React.FC = () => {
	const {stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const twineElectron = (window as TwineElectronWindow).twineElectron;
	const dismissedRoots = React.useRef(new Set<string>());
	const [pendingReview, setPendingReview] =
		React.useState<PendingProjectReview>();
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const roots = React.useMemo(() => projectRootsForStories(stories), [stories]);
	const rootSignature = React.useMemo(
		() => [...roots.keys()].sort().join('\n'),
		[roots]
	);
	const rootPaths = React.useMemo(
		() => (rootSignature ? rootSignature.split('\n') : []),
		[rootSignature]
	);
	const rootStoryIds = React.useRef(new Map<string, string[]>());
	const rootStoriesRef = React.useRef(new Map<string, Story[]>());

	React.useEffect(() => {
		rootStoriesRef.current = roots;
		rootStoryIds.current = new Map(
			Array.from(roots, ([rootPath, rootStories]) => [
				rootPath,
				rootStories.map(story => story.id)
			])
		);
	}, [roots]);

	const applyDiskSnapshot = React.useCallback(
		async (snapshot: NativeProjectSessionSnapshot) => {
			const current = rootStoriesRef.current.get(snapshot.rootPath) ?? [];
			const incoming = snapshot.stories.map(reviveSessionStory);
			const targetStoryId = current[0]?.id;

			if (!targetStoryId) {
				throw new Error(
					`No active project session exists for "${snapshot.rootPath}".`
				);
			}

			for (const story of incoming) {
				saveProjectMetadata(story.id, {
					rootPath: snapshot.rootPath,
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
				markProjectStoryHydration(story.id, {
					passageTextLoaded: true,
					rootPath: snapshot.rootPath
				});
			}

			await coreProjectHost.applyExternalDelta(
				targetStoryId,
				externalDelta(current, incoming)
			);
			rememberSessionSnapshot(snapshot);
		},
		[coreProjectHost]
	);

	React.useEffect(() => {
		if (!twineElectron?.onProjectSessionChanged) {
			return;
		}

		return twineElectron.onProjectSessionChanged(snapshot => {
			if (
				snapshot.conflicts.length > 0 &&
				!dismissedRoots.current.has(snapshot.rootPath)
			) {
				setPendingReview({
					rootPath: snapshot.rootPath,
					snapshot
				});
			} else if (snapshot.changedPaths.length > 0) {
				void applyDiskSnapshot(snapshot).catch(changeError => {
					setError(changeError.message);
				});
			} else {
				rememberSessionSnapshot(snapshot);
			}
		});
	}, [applyDiskSnapshot, twineElectron]);

	React.useEffect(() => {
		if (!twineElectron?.startProjectSession) {
			return;
		}

		let canceled = false;
		for (const rootPath of rootPaths) {
			void twineElectron
				.startProjectSession(rootPath, rootStoryIds.current.get(rootPath) ?? [])
				.then(snapshot => {
					if (canceled) {
						return;
					}

					rememberSessionSnapshot(snapshot);

					if (
						snapshot.conflicts.length > 0 &&
						!dismissedRoots.current.has(rootPath)
					) {
						setPendingReview({rootPath, snapshot});
					}
				})
				.catch((startError: Error) => {
					if (!canceled) {
						setError(startError.message);
					}
				});
		}

		return () => {
			canceled = true;

			for (const rootPath of rootPaths) {
				void twineElectron.stopProjectSession?.(rootPath);
			}
		};
	}, [rootPaths, twineElectron]);

	async function acceptDisk() {
		if (!pendingReview || !twineElectron?.resolveProjectSessionConflicts) {
			return;
		}

		setBusy(true);
		setError(undefined);

		try {
			const snapshot = await twineElectron.resolveProjectSessionConflicts(
				pendingReview.rootPath,
				'acceptDisk'
			);
			await applyDiskSnapshot(snapshot);
			dismissedRoots.current.delete(pendingReview.rootPath);
			setPendingReview(undefined);
		} catch (acceptError) {
			setError((acceptError as Error).message);
		} finally {
			setBusy(false);
		}
	}

	async function keepApp() {
		if (!pendingReview || !twineElectron?.resolveProjectSessionConflicts) {
			return;
		}

		const rootStories = roots.get(pendingReview.rootPath) ?? [];

		setBusy(true);
		setError(undefined);

		try {
			const snapshot = await twineElectron.resolveProjectSessionConflicts(
				pendingReview.rootPath,
				'keepApp',
				rootStories
			);

			rememberSessionSnapshot(snapshot);
			if (rootStories[0]) {
				const status = coreProjectHost.sessionStatus(rootStories[0].id);

				await coreProjectHost.acknowledgeSaved(
					coreSessionIdForStory(rootStories[0]),
					status.revision
				);
			}
			dismissedRoots.current.delete(pendingReview.rootPath);
			setPendingReview(undefined);
		} catch (keepError) {
			setError((keepError as Error).message);
		} finally {
			setBusy(false);
		}
	}

	function reviewLater() {
		if (pendingReview) {
			dismissedRoots.current.add(pendingReview.rootPath);
		}

		setPendingReview(undefined);
	}

	if (!pendingReview && !error) {
		return null;
	}

	const conflictCount = pendingReview?.snapshot.conflicts.length ?? 0;
	const pathPreview = pendingReview?.snapshot.changedPaths
		.slice(0, 3)
		.join(', ');

	return (
		<div className="project-session-sync" role="status">
			<div className="project-session-sync__title">Project folder changed</div>
			{pendingReview ? (
				<p>
					{conflictCount > 0
						? `${conflictCount} disk change${
								conflictCount === 1 ? '' : 's'
							} need review${pathPreview ? `: ${pathPreview}` : ''}.`
						: 'The disk copy differs from the app copy.'}
				</p>
			) : null}
			{error ? <p className="project-session-sync__error">{error}</p> : null}
			{pendingReview ? (
				<div className="project-session-sync__actions">
					<button disabled={busy} onClick={acceptDisk} type="button">
						Accept Disk
					</button>
					<button disabled={busy} onClick={keepApp} type="button">
						Keep App
					</button>
					<button disabled={busy} onClick={reviewLater} type="button">
						Later
					</button>
				</div>
			) : null}
		</div>
	);
};
