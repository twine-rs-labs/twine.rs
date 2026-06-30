import * as React from 'react';
import {
	NativeProjectSessionDelta,
	NativeProjectSessionStart,
	TwineElectronWindow
} from '../electron/shared';
import {
	coreSessionIdForStory,
	replaceKnownAssetInventoryForStory,
	useCoreProjectHost
} from '../core';
import type {CoreExternalConflict} from '../core/bindings/CoreExternalConflict';
import {markProjectStoryHydration} from './project-hydration';
import {loadProjectMetadata, saveProjectMetadata} from './project-metadata';
import {Story, useStoriesContext} from './stories';
import {markPerformance} from '../util/performance';
import './project-session-sync.css';

interface PendingProjectReview {
	conflicts: CoreExternalConflict[];
	delta: NativeProjectSessionDelta;
	rootPath: string;
}

function reviveSessionStory(story: Story): Story {
	return {
		...story,
		lastUpdate: new Date(story.lastUpdate)
	};
}

function rememberSessionStart(start: NativeProjectSessionStart) {
	markPerformance('session-baseline-ready');
	markPerformance('asset-inventory-ready');

	for (const storyId of start.storyIds) {
		replaceKnownAssetInventoryForStory(storyId, start.assets);
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
	const dismissedDeltas = React.useRef(new Set<string>());
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

	const acknowledgeDelta = React.useCallback(
		async (delta: NativeProjectSessionDelta) => {
			if (!twineElectron?.resolveProjectSessionConflicts) {
				throw new Error('Native project acknowledgement is unavailable.');
			}

			let lastError: Error | undefined;

			for (let attempt = 0; attempt < 3; attempt++) {
				try {
					const start = await twineElectron.resolveProjectSessionConflicts(
						delta.rootPath,
						'acceptDisk',
						undefined,
						delta.id
					);

					rememberSessionStart(start);
					return;
				} catch (acknowledgementError) {
					lastError = acknowledgementError as Error;
				}
			}

			throw lastError;
		},
		[twineElectron]
	);

	const processDelta = React.useCallback(
		async (delta: NativeProjectSessionDelta) => {
			const current = rootStoriesRef.current.get(delta.rootPath) ?? [];
			const targetStoryId = current[0]?.id;

			if (!targetStoryId) {
				throw new Error(
					`No active project session exists for "${delta.rootPath}".`
				);
			}
			if (delta.recovery) {
				setPendingReview({conflicts: [], delta, rootPath: delta.rootPath});
				return;
			}

			const result = await coreProjectHost.ingestExternalDelta(
				targetStoryId,
				delta.delta
			);

			if (result.outcome === 'conflict') {
				setPendingReview({
					conflicts: result.conflicts,
					delta,
					rootPath: delta.rootPath
				});
				return;
			}

			await acknowledgeDelta(delta);
			dismissedDeltas.current.delete(delta.id);
			setPendingReview(currentReview =>
				currentReview?.rootPath === delta.rootPath ? undefined : currentReview
			);
		},
		[acknowledgeDelta, coreProjectHost]
	);

	const synchronizeStartAssets = React.useCallback(
		async (start: NativeProjectSessionStart) => {
			rememberSessionStart(start);
			const targetStoryId = rootStoriesRef.current.get(start.rootPath)?.[0]?.id;

			if (!targetStoryId || start.assets.length === 0) {
				return;
			}
			await coreProjectHost.ingestExternalDelta(
				targetStoryId,
				{
					changes: start.assets.map(asset => ({
						asset,
						type: 'upsertAsset' as const
					})),
					id: `baseline:${start.rootPath}:${start.generation}`
				},
				{force: true}
			);
		},
		[coreProjectHost]
	);

	React.useEffect(() => {
		if (!twineElectron?.onProjectSessionChanged) {
			return;
		}

		return twineElectron.onProjectSessionChanged(delta => {
			if (!dismissedDeltas.current.has(delta.id)) {
				void processDelta(delta).catch(changeError => {
					setError(changeError.message);
				});
			}
		});
	}, [processDelta, twineElectron]);

	React.useEffect(() => {
		if (!twineElectron?.startProjectSession) {
			return;
		}

		let canceled = false;
		for (const rootPath of rootPaths) {
			void twineElectron
				.startProjectSession(rootPath, rootStoryIds.current.get(rootPath) ?? [])
				.then(async start => {
					if (canceled) {
						return;
					}

					await synchronizeStartAssets(start);
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
	}, [rootPaths, synchronizeStartAssets, twineElectron]);

	async function acceptDisk() {
		if (!pendingReview || !twineElectron?.resolveProjectSessionConflicts) {
			return;
		}

		setBusy(true);
		setError(undefined);

		try {
			const rootStories =
				rootStoriesRef.current.get(pendingReview.rootPath) ?? [];
			const targetStoryId = rootStories[0]?.id;

			if (!targetStoryId) {
				throw new Error('No active project session exists for this change.');
			}

			if (pendingReview.delta.recovery) {
				if (
					!window.confirm(
						`${pendingReview.delta.recovery.message}\n\nReloading from disk will reset undo history.`
					)
				) {
					return;
				}
				const folder = await twineElectron.hydrateProjectFolder(
					pendingReview.rootPath,
					rootStoryIds.current.get(pendingReview.rootPath)
				);
				const assets = await twineElectron.listProjectAssets(
					pendingReview.rootPath
				);
				const incoming = folder.stories.map(reviveSessionStory);

				await coreProjectHost.recoverFromSnapshot(
					targetStoryId,
					incoming,
					assets
				);
				for (const story of incoming) {
					saveProjectMetadata(story.id, {
						rootPath: pendingReview.rootPath,
						status: 'file-backed',
						storageKind: 'electron-project-folder'
					});
					markProjectStoryHydration(story.id, {
						passageTextLoaded: true,
						rootPath: pendingReview.rootPath
					});
				}
			} else {
				await coreProjectHost.ingestExternalDelta(
					targetStoryId,
					pendingReview.delta.delta,
					{force: true}
				);
			}

			await acknowledgeDelta(pendingReview.delta);
			dismissedDeltas.current.delete(pendingReview.delta.id);
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
			const start = await twineElectron.resolveProjectSessionConflicts(
				pendingReview.rootPath,
				'keepApp',
				rootStories,
				pendingReview.delta.id
			);

			rememberSessionStart(start);
			if (rootStories[0]) {
				const status = coreProjectHost.sessionStatus(rootStories[0].id);

				await coreProjectHost.acknowledgeSaved(
					coreSessionIdForStory(rootStories[0]),
					status.revision
				);
			}
			dismissedDeltas.current.delete(pendingReview.delta.id);
			setPendingReview(undefined);
		} catch (keepError) {
			setError((keepError as Error).message);
		} finally {
			setBusy(false);
		}
	}

	function reviewLater() {
		if (pendingReview) {
			dismissedDeltas.current.add(pendingReview.delta.id);
		}

		setPendingReview(undefined);
	}

	if (!pendingReview && !error) {
		return null;
	}

	const conflictCount = pendingReview
		? Math.max(
				pendingReview.conflicts.length,
				pendingReview.delta.fileChanges.length
			)
		: 0;
	const pathPreview = pendingReview?.delta.changedPaths.slice(0, 3).join(', ');

	return (
		<div className="project-session-sync" role="status">
			<div className="project-session-sync__title">Project folder changed</div>
			{pendingReview ? (
				<p>
					{conflictCount > 0
						? `${conflictCount} disk change${
								conflictCount === 1 ? '' : 's'
							} need review${pathPreview ? `: ${pathPreview}` : ''}.`
						: (pendingReview.delta.recovery?.message ??
							'The disk copy differs from the app copy.')}
				</p>
			) : null}
			{error ? <p className="project-session-sync__error">{error}</p> : null}
			{pendingReview ? (
				<div className="project-session-sync__actions">
					<button disabled={busy} onClick={acceptDisk} type="button">
						{pendingReview.delta.recovery ? 'Reload From Disk' : 'Accept Disk'}
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
