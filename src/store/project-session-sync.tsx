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
import {NativeProjectDeltaQueue} from './native-project-delta-queue';
import {Story, useStoriesContext} from './stories';
import {
	markPerformance,
	recordPerformanceHarnessEvent
} from '../util/performance';
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

function deterministicResolutionError(error: Error) {
	return (
		error.message.includes(' is stale.') ||
		error.message.includes(' was already resolved as ')
	);
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
				recordPerformanceHarnessEvent('watcher-acknowledgement-start', {
					attempt: attempt + 1,
					deltaId: delta.id
				});
				try {
					const start = await twineElectron.resolveProjectSessionConflicts(
						delta.rootPath,
						'acceptDisk',
						undefined,
						delta.id
					);

					rememberSessionStart(start);
					recordPerformanceHarnessEvent('watcher-acknowledgement-complete', {
						attempt: attempt + 1,
						deltaId: delta.id,
						generation: start.generation
					});
					return;
				} catch (acknowledgementError) {
					lastError = acknowledgementError as Error;
					recordPerformanceHarnessEvent('watcher-acknowledgement-failed', {
						attempt: attempt + 1,
						deltaId: delta.id,
						error: lastError.message
					});
					if (deterministicResolutionError(lastError)) {
						break;
					}
				}
			}

			throw lastError;
		},
		[twineElectron]
	);

	const processDelta = React.useCallback(
		async (delta: NativeProjectSessionDelta) => {
			recordPerformanceHarnessEvent('watcher-ingest-start', {
				changedPaths: delta.changedPaths.length,
				deltaId: delta.id,
				entityChanges: delta.delta.changes.length,
				nativeTrace: delta.performanceTrace,
				recovery: !!delta.recovery
			});
			const current = rootStoriesRef.current.get(delta.rootPath) ?? [];
			const targetStoryId = current[0]?.id;

			if (!targetStoryId) {
				throw new Error(
					`No active project session exists for "${delta.rootPath}".`
				);
			}
			if (delta.recovery) {
				recordPerformanceHarnessEvent('watcher-review-required', {
					deltaId: delta.id,
					recovery: true
				});
				setPendingReview({conflicts: [], delta, rootPath: delta.rootPath});
				return 'pause' as const;
			}

			const result = await coreProjectHost.ingestExternalDelta(
				targetStoryId,
				delta.delta
			);

			if (result.outcome === 'conflict') {
				recordPerformanceHarnessEvent('watcher-review-required', {
					conflicts: result.conflicts.length,
					deltaId: delta.id,
					recovery: false
				});
				setPendingReview({
					conflicts: result.conflicts,
					delta,
					rootPath: delta.rootPath
				});
				return 'pause' as const;
			}

			await acknowledgeDelta(delta);
			recordPerformanceHarnessEvent('watcher-ingest-applied', {
				deltaId: delta.id,
				outcome: result.outcome
			});
			dismissedDeltas.current.delete(delta.id);
			setPendingReview(currentReview =>
				currentReview?.rootPath === delta.rootPath ? undefined : currentReview
			);
			return 'continue' as const;
		},
		[acknowledgeDelta, coreProjectHost]
	);

	const processDeltaRef = React.useRef(processDelta);
	const deltaQueueRef =
		React.useRef<NativeProjectDeltaQueue<NativeProjectSessionDelta> | null>(
			null
		);

	processDeltaRef.current = processDelta;
	if (!deltaQueueRef.current) {
		deltaQueueRef.current = new NativeProjectDeltaQueue(
			delta => processDeltaRef.current(delta),
			changeError => setError(changeError.message)
		);
	}

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
				recordPerformanceHarnessEvent('watcher-delta-observed', {
					changedPaths: delta.changedPaths.length,
					deltaId: delta.id,
					entityChanges: delta.delta.changes.length,
					nativeTrace: delta.performanceTrace,
					recovery: !!delta.recovery
				});
				deltaQueueRef.current?.enqueue(delta);
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
				.startProjectSession(rootPath, rootStoryIds.current.get(rootPath) ?? [])
				.then(async start => {
					if (canceled) {
						return;
					}

					await synchronizeStartAssets(start);
					// The native baseline is ready before the initial asset inventory has
					// necessarily crossed the serialized core-session queue. Keep a
					// separate readiness mark so performance scenarios do not inject an
					// external edit into that initialization work.
					markPerformance('session-initialization-complete');
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
				deltaQueueRef.current?.clearRoot(rootPath);
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
			deltaQueueRef.current?.resume(pendingReview.rootPath);
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
			deltaQueueRef.current?.resume(pendingReview.rootPath);
			setPendingReview(undefined);
		} catch (keepError) {
			setError((keepError as Error).message);
		} finally {
			setBusy(false);
		}
	}

	async function reviewLater() {
		if (!pendingReview || !twineElectron?.resolveProjectSessionConflicts) {
			return;
		}

		setBusy(true);
		setError(undefined);
		try {
			await twineElectron.resolveProjectSessionConflicts(
				pendingReview.rootPath,
				'dismiss',
				undefined,
				pendingReview.delta.id
			);
			dismissedDeltas.current.add(pendingReview.delta.id);
			deltaQueueRef.current?.resume(pendingReview.rootPath);
			setPendingReview(undefined);
		} catch (dismissError) {
			setError((dismissError as Error).message);
		} finally {
			setBusy(false);
		}
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
