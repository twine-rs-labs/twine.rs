import * as React from 'react';
import {
	NativeProjectSessionSnapshot,
	TwineElectronWindow
} from '../electron/shared';
import {replaceKnownAssetInventoryForStory} from '../core';
import {loadProjectMetadata, saveProjectMetadata} from './project-metadata';
import {Story, useStoriesContext} from './stories';
import './project-session-sync.css';

interface PendingProjectReview {
	rootPath: string;
	snapshot: NativeProjectSessionSnapshot;
}

function storyFingerprint(story: Story) {
	return JSON.stringify({
		ifid: story.ifid,
		id: story.id,
		name: story.name,
		passages: story.passages.map(passage => ({
			height: passage.height,
			id: passage.id,
			left: passage.left,
			name: passage.name,
			tags: passage.tags,
			text: passage.text,
			top: passage.top,
			width: passage.width
		})),
		script: story.script,
		snapToGrid: story.snapToGrid,
		startPassage: story.startPassage,
		storyFormat: story.storyFormat,
		storyFormatVersion: story.storyFormatVersion,
		stylesheet: story.stylesheet,
		tags: story.tags,
		zoom: story.zoom
	});
}

function reviveSessionStory(story: Story): Story {
	return {
		...story,
		lastUpdate: new Date(story.lastUpdate)
	};
}

function mergeStories(current: Story[], incoming: Story[]) {
	const incomingById = new Map(incoming.map(story => [story.id, story]));
	const merged = current.map(story => incomingById.get(story.id) ?? story);
	const currentIds = new Set(current.map(story => story.id));

	for (const story of incoming) {
		if (!currentIds.has(story.id)) {
			merged.push(story);
		}
	}

	return merged;
}

function sessionStoryDiffers(snapshot: NativeProjectSessionSnapshot, stories: Story[]) {
	const storiesById = new Map(stories.map(story => [story.id, story]));

	return snapshot.stories.some(snapshotStory => {
		const currentStory = storiesById.get(snapshotStory.id);

		return (
			currentStory &&
			storyFingerprint(reviveSessionStory(snapshotStory)) !==
				storyFingerprint(currentStory)
		);
	});
}

function rememberSessionSnapshot(snapshot: NativeProjectSessionSnapshot) {
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

		roots.set(metadata.rootPath, [...(roots.get(metadata.rootPath) ?? []), story]);
	}

	return roots;
}

export const ProjectSessionSync: React.FC = () => {
	const {dispatch, stories} = useStoriesContext();
	const twineElectron = (window as TwineElectronWindow).twineElectron;
	const dismissedRoots = React.useRef(new Set<string>());
	const storiesRef = React.useRef(stories);
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

	React.useEffect(() => {
		storiesRef.current = stories;
	}, [stories]);

	React.useEffect(() => {
		if (!twineElectron?.onProjectSessionChanged) {
			return;
		}

		return twineElectron.onProjectSessionChanged(snapshot => {
			rememberSessionSnapshot(snapshot);

			if (
				snapshot.conflicts.length > 0 &&
				!dismissedRoots.current.has(snapshot.rootPath)
			) {
				setPendingReview({
					rootPath: snapshot.rootPath,
					snapshot
				});
			}
		});
	}, [twineElectron]);

	React.useEffect(() => {
		if (!twineElectron?.startProjectSession) {
			return;
		}

		let canceled = false;
		for (const rootPath of rootPaths) {
			void twineElectron
				.startProjectSession(rootPath)
				.then(snapshot => {
					if (canceled) {
						return;
					}

					rememberSessionSnapshot(snapshot);

					if (
						(snapshot.conflicts.length > 0 ||
							sessionStoryDiffers(snapshot, storiesRef.current)) &&
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
			const incomingStories = snapshot.stories.map(reviveSessionStory);

			for (const story of incomingStories) {
				saveProjectMetadata(story.id, {
					rootPath: snapshot.rootPath,
					status: 'file-backed',
					storageKind: 'electron-project-folder'
				});
			}

			rememberSessionSnapshot(snapshot);
			dispatch({state: mergeStories(stories, incomingStories), type: 'init'});
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
	const pathPreview = pendingReview?.snapshot.changedPaths.slice(0, 3).join(', ');

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
