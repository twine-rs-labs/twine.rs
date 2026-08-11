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
import {
	getProjectMetadataRevision,
	loadProjectMetadata,
	saveProjectMetadata,
	subscribeProjectMetadata
} from './project-metadata';
import {NativeProjectDeltaQueue} from './native-project-delta-queue';
import {Story, StoryWithDocuments, useStoriesContext} from './stories';
import {
	markPerformance,
	recordPerformanceHarnessEvent
} from '../util/performance';
import {pluralizedNoun} from '../util/pluralized-noun';
import './project-session-sync.css';

interface PendingProjectReview {
	conflicts: CoreExternalConflict[];
	delta: NativeProjectSessionDelta;
	order: number;
	rootPath: string;
}

interface ReviewOrder {
	order: number;
	rootPath: string;
}

function reviveSessionStory(story: StoryWithDocuments): StoryWithDocuments {
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

interface ProjectRootLifecycleProps {
	activeSessionInstances: React.MutableRefObject<Map<string, string>>;
	bufferedSessionDeltas: React.MutableRefObject<
		Map<string, NativeProjectSessionDelta[]>
	>;
	deltaQueueRef: React.MutableRefObject<NativeProjectDeltaQueue<NativeProjectSessionDelta> | null>;
	fingerprint: string;
	rootPath: string;
	sessionCleanupRef: React.MutableRefObject<Map<string, Promise<void>>>;
	clearReviewsForRoot: (rootPath: string) => void;
	setError: React.Dispatch<React.SetStateAction<string | undefined>>;
	startingSessionRoots: React.MutableRefObject<Set<string>>;
	synchronizeStartAssets: (start: NativeProjectSessionStart) => Promise<void>;
	twineElectron: TwineElectronWindow['twineElectron'];
}

const ProjectRootLifecycle: React.FC<ProjectRootLifecycleProps> = ({
	activeSessionInstances,
	bufferedSessionDeltas,
	deltaQueueRef,
	fingerprint,
	rootPath,
	sessionCleanupRef,
	clearReviewsForRoot,
	setError,
	startingSessionRoots,
	synchronizeStartAssets,
	twineElectron
}) => {
	React.useEffect(() => {
		if (!twineElectron?.startProjectSession) {
			return;
		}

		const [, stories] = JSON.parse(fingerprint) as [string, [string, string][]];
		const storyIds = stories.map(([storyId]) => storyId);
		let canceled = false;
		const previousCleanup = sessionCleanupRef.current.get(rootPath);

		startingSessionRoots.current.add(rootPath);
		const startTask = (async () => {
			if (previousCleanup) {
				await previousCleanup;
			}
			if (canceled) {
				return false;
			}
			const start = await twineElectron.startProjectSession(rootPath, storyIds);
			if (canceled) {
				return true;
			}
			activeSessionInstances.current.set(rootPath, start.sessionInstanceId);
			startingSessionRoots.current.delete(rootPath);
			const buffered = bufferedSessionDeltas.current.get(rootPath) ?? [];

			bufferedSessionDeltas.current.delete(rootPath);
			for (const delta of buffered) {
				if (delta.sessionInstanceId === start.sessionInstanceId) {
					deltaQueueRef.current?.enqueue(delta);
				}
			}

			recordPerformanceHarnessEvent('native-session-baseline-ready', {
				...start.performanceTimings,
				rootPath: start.rootPath
			});
			await synchronizeStartAssets(start);
			// The native baseline is ready before the initial asset inventory has
			// necessarily crossed the serialized core-session queue. Keep a
			// separate readiness mark so performance scenarios do not inject an
			// external edit into that initialization work.
			markPerformance('session-initialization-complete');
			return false;
		})().catch((startError: Error) => {
			if (!canceled) {
				startingSessionRoots.current.delete(rootPath);
				bufferedSessionDeltas.current.delete(rootPath);
				setError(startError.message);
			}
			return false;
		});

		return () => {
			canceled = true;
			clearReviewsForRoot(rootPath);
			activeSessionInstances.current.delete(rootPath);
			startingSessionRoots.current.delete(rootPath);
			bufferedSessionDeltas.current.delete(rootPath);
			const drain = deltaQueueRef.current?.clearRoot(rootPath);
			const initialStop = drain
				? drain.then(() => twineElectron.stopProjectSession?.(rootPath))
				: Promise.resolve(twineElectron.stopProjectSession?.(rootPath));
			const cleanup = Promise.all([startTask, initialStop])
				.then(([startedAfterCancellation]) =>
					startedAfterCancellation
						? twineElectron.stopProjectSession?.(rootPath)
						: undefined
				)
				.then(() => undefined);

			sessionCleanupRef.current.set(rootPath, cleanup);
			void cleanup.finally(() => {
				if (sessionCleanupRef.current.get(rootPath) === cleanup) {
					sessionCleanupRef.current.delete(rootPath);
				}
			});
		};
	}, [
		activeSessionInstances,
		bufferedSessionDeltas,
		deltaQueueRef,
		fingerprint,
		rootPath,
		sessionCleanupRef,
		clearReviewsForRoot,
		setError,
		startingSessionRoots,
		synchronizeStartAssets,
		twineElectron
	]);

	return null;
};

export const ProjectSessionSync: React.FC = () => {
	const {stories} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const [metadataRevision, setMetadataRevision] = React.useState(
		getProjectMetadataRevision
	);

	React.useEffect(
		() =>
			subscribeProjectMetadata(() =>
				setMetadataRevision(getProjectMetadataRevision())
			),
		[]
	);
	const twineElectron = (window as TwineElectronWindow).twineElectron;
	const dismissedDeltas = React.useRef(new Set<string>());
	const nextReviewOrder = React.useRef(0);
	const reviewOrderByDelta = React.useRef(new Map<string, ReviewOrder>());
	const [pendingReviews, setPendingReviews] = React.useState<
		PendingProjectReview[]
	>([]);
	const [unclassifiedReviewOrders, setUnclassifiedReviewOrders] =
		React.useState<number[]>([]);
	const firstPendingReview = pendingReviews[0];
	const pendingReview =
		firstPendingReview &&
		!unclassifiedReviewOrders.some(order => order < firstPendingReview.order)
			? firstPendingReview
			: undefined;
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<string>();
	const roots = React.useMemo(
		() => projectRootsForStories(stories),
		[metadataRevision, stories]
	);
	const rootMembershipSignature = React.useMemo(
		() =>
			JSON.stringify(
				Array.from(roots, ([rootPath, rootStories]) => [
					rootPath,
					rootStories
						.map(story => [
							story.id,
							loadProjectMetadata(story.id)?.updatedAt ?? ''
						])
						.sort(([left], [right]) =>
							left < right ? -1 : left > right ? 1 : 0
						)
				]).sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			),
		[roots]
	);
	const sessionRoots = React.useMemo(
		() => JSON.parse(rootMembershipSignature) as [string, [string, string][]][],
		[rootMembershipSignature]
	);
	const rootStoryIds = React.useRef(new Map<string, string[]>());
	const rootStoriesRef = React.useRef(new Map<string, Story[]>());
	const activeSessionInstances = React.useRef(new Map<string, string>());
	const bufferedSessionDeltas = React.useRef(
		new Map<string, NativeProjectSessionDelta[]>()
	);
	const startingSessionRoots = React.useRef(new Set<string>());

	const rememberReviewOrder = React.useCallback(
		(delta: NativeProjectSessionDelta) => {
			let reviewOrder = reviewOrderByDelta.current.get(delta.id);

			if (reviewOrder === undefined) {
				reviewOrder = {
					order: nextReviewOrder.current++,
					rootPath: delta.rootPath
				};
				reviewOrderByDelta.current.set(delta.id, reviewOrder);
			}
			return reviewOrder.order;
		},
		[]
	);
	const queueReview = React.useCallback(
		(review: Omit<PendingProjectReview, 'order'>) => {
			const order = rememberReviewOrder(review.delta);

			setPendingReviews(current => {
				if (current.some(item => item.delta.id === review.delta.id)) {
					return current;
				}
				return [...current, {...review, order}].sort(
					(left, right) => left.order - right.order
				);
			});
		},
		[rememberReviewOrder]
	);
	const beginReviewClassification = React.useCallback(
		(delta: NativeProjectSessionDelta) => {
			const order = rememberReviewOrder(delta);

			setUnclassifiedReviewOrders(current =>
				current.includes(order) ? current : [...current, order]
			);
		},
		[rememberReviewOrder]
	);
	const completeReviewClassification = React.useCallback(
		(delta: NativeProjectSessionDelta) => {
			const reviewOrder = reviewOrderByDelta.current.get(delta.id);

			if (reviewOrder !== undefined) {
				setUnclassifiedReviewOrders(current =>
					current.filter(candidate => candidate !== reviewOrder.order)
				);
			}
		},
		[]
	);
	const clearReviewsForRoot = React.useCallback((rootPath: string) => {
		const orders = new Set<number>();

		for (const [deltaId, reviewOrder] of reviewOrderByDelta.current) {
			if (reviewOrder.rootPath === rootPath) {
				orders.add(reviewOrder.order);
				reviewOrderByDelta.current.delete(deltaId);
			}
		}
		setPendingReviews(current =>
			current.filter(review => review.rootPath !== rootPath)
		);
		setUnclassifiedReviewOrders(current =>
			current.filter(order => !orders.has(order))
		);
	}, []);

	React.useEffect(() => {
		rootStoriesRef.current = roots;
		rootStoryIds.current = new Map(
			sessionRoots.map(([rootPath, stories]) => [
				rootPath,
				stories.map(([storyId]) => storyId)
			])
		);
	}, [roots, sessionRoots]);

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
		async (delta: NativeProjectSessionDelta, signal: AbortSignal) => {
			beginReviewClassification(delta);
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
				completeReviewClassification(delta);
				throw new Error(
					`No active project session exists for "${delta.rootPath}".`
				);
			}
			const targetMetadata = loadProjectMetadata(targetStoryId);

			if (
				targetMetadata?.storageKind !== 'electron-project-folder' ||
				targetMetadata.status !== 'file-backed' ||
				targetMetadata.rootPath !== delta.rootPath
			) {
				completeReviewClassification(delta);
				recordPerformanceHarnessEvent('watcher-delta-stale-root', {
					deltaId: delta.id,
					rootPath: delta.rootPath,
					storyId: targetStoryId
				});
				return 'continue' as const;
			}
			if (delta.recovery) {
				if (signal.aborted) {
					completeReviewClassification(delta);
					return 'continue' as const;
				}
				recordPerformanceHarnessEvent('watcher-review-required', {
					deltaId: delta.id,
					recovery: true
				});
				queueReview({conflicts: [], delta, rootPath: delta.rootPath});
				completeReviewClassification(delta);
				return 'pause' as const;
			}

			const result = await coreProjectHost
				.ingestExternalDelta(targetStoryId, delta.delta)
				.catch(error => {
					completeReviewClassification(delta);
					throw error;
				});
			if (signal.aborted) {
				completeReviewClassification(delta);
				return 'continue' as const;
			}

			if (result.outcome === 'conflict') {
				recordPerformanceHarnessEvent('watcher-review-required', {
					conflicts: result.conflicts.length,
					deltaId: delta.id,
					recovery: false
				});
				queueReview({
					conflicts: result.conflicts,
					delta,
					rootPath: delta.rootPath
				});
				completeReviewClassification(delta);
				return 'pause' as const;
			}

			completeReviewClassification(delta);
			await acknowledgeDelta(delta);
			recordPerformanceHarnessEvent('watcher-ingest-applied', {
				deltaId: delta.id,
				outcome: result.outcome
			});
			dismissedDeltas.current.delete(delta.id);
			reviewOrderByDelta.current.delete(delta.id);
			setPendingReviews(currentReviews =>
				currentReviews.filter(review => review.delta.id !== delta.id)
			);
			return 'continue' as const;
		},
		[
			acknowledgeDelta,
			beginReviewClassification,
			completeReviewClassification,
			coreProjectHost,
			queueReview
		]
	);

	const processDeltaRef = React.useRef(processDelta);
	const deltaQueueRef =
		React.useRef<NativeProjectDeltaQueue<NativeProjectSessionDelta> | null>(
			null
		);
	const sessionCleanupRef = React.useRef(new Map<string, Promise<void>>());

	processDeltaRef.current = processDelta;
	if (!deltaQueueRef.current) {
		deltaQueueRef.current = new NativeProjectDeltaQueue(
			(delta, signal) => processDeltaRef.current(delta, signal),
			changeError => setError(changeError.message)
		);
	}

	const synchronizeStartAssets = React.useCallback(
		async (start: NativeProjectSessionStart) => {
			rememberSessionStart(start);
			const targetStoryId = rootStoriesRef.current.get(start.rootPath)?.[0]?.id;

			if (targetStoryId) {
				await coreProjectHost.ensureSessionReady(targetStoryId);
			}
		},
		[coreProjectHost]
	);

	React.useLayoutEffect(() => {
		if (twineElectron?.onProjectSessionChanged) {
			return twineElectron.onProjectSessionChanged(delta => {
				if (dismissedDeltas.current.has(delta.id)) {
					return;
				}

				const activeInstance = activeSessionInstances.current.get(
					delta.rootPath
				);

				if (!activeInstance) {
					if (startingSessionRoots.current.has(delta.rootPath)) {
						bufferedSessionDeltas.current.set(delta.rootPath, [
							...(bufferedSessionDeltas.current.get(delta.rootPath) ?? []),
							delta
						]);
					}
					return;
				}
				if (activeInstance !== delta.sessionInstanceId) {
					return;
				}

				recordPerformanceHarnessEvent('watcher-delta-observed', {
					changedPaths: delta.changedPaths.length,
					deltaId: delta.id,
					entityChanges: delta.delta.changes.length,
					nativeTrace: delta.performanceTrace,
					recovery: !!delta.recovery
				});
				deltaQueueRef.current?.enqueue(delta);
			});
		}
	}, [twineElectron]);

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
			reviewOrderByDelta.current.delete(pendingReview.delta.id);
			deltaQueueRef.current?.resume(pendingReview.rootPath);
			setPendingReviews(current =>
				current.filter(review => review.delta.id !== pendingReview.delta.id)
			);
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
			reviewOrderByDelta.current.delete(pendingReview.delta.id);
			deltaQueueRef.current?.resume(pendingReview.rootPath);
			setPendingReviews(current =>
				current.filter(review => review.delta.id !== pendingReview.delta.id)
			);
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
			reviewOrderByDelta.current.delete(pendingReview.delta.id);
			deltaQueueRef.current?.resume(pendingReview.rootPath);
			setPendingReviews(current =>
				current.filter(review => review.delta.id !== pendingReview.delta.id)
			);
		} catch (dismissError) {
			setError((dismissError as Error).message);
		} finally {
			setBusy(false);
		}
	}

	const conflictCount = pendingReview
		? Math.max(
				pendingReview.conflicts.length,
				pendingReview.delta.fileChanges.length
			)
		: 0;
	const pathPreview = pendingReview?.delta.changedPaths.slice(0, 3).join(', ');
	const resolutionHint = pendingReview?.delta.recovery
		? 'Reloading from disk replaces the app version and resets undo history. Keeping the app version overwrites the changed project files on disk.'
		: 'Using the disk version replaces conflicting app values. Keeping the app version overwrites the changed project files on disk.';

	return (
		<>
			{sessionRoots.map(([rootPath, stories]) => {
				const fingerprint = JSON.stringify([rootPath, stories]);

				return (
					<ProjectRootLifecycle
						activeSessionInstances={activeSessionInstances}
						bufferedSessionDeltas={bufferedSessionDeltas}
						deltaQueueRef={deltaQueueRef}
						fingerprint={fingerprint}
						key={rootPath}
						rootPath={rootPath}
						sessionCleanupRef={sessionCleanupRef}
						clearReviewsForRoot={clearReviewsForRoot}
						setError={setError}
						startingSessionRoots={startingSessionRoots}
						synchronizeStartAssets={synchronizeStartAssets}
						twineElectron={twineElectron}
					/>
				);
			})}
			{pendingReview || error ? (
				<div className="project-session-sync" role="status">
					<div className="project-session-sync__title">
						Project folder changed
					</div>
					{pendingReview ? (
						<>
							<p>
								{conflictCount > 0
									? `${conflictCount} ${pluralizedNoun(
											conflictCount,
											'disk change'
										)} ${conflictCount === 1 ? 'requires' : 'require'} review${
											pathPreview ? `: ${pathPreview}` : ''
										}.`
									: (pendingReview.delta.recovery?.message ??
										'The disk copy differs from the app copy.')}
							</p>
							<p className="project-session-sync__resolution-hint">
								{resolutionHint}
							</p>
						</>
					) : null}
					{pendingReviews.length > 1 ? (
						<p>
							{pendingReviews.length - 1} more{' '}
							{pluralizedNoun(pendingReviews.length - 1, 'project change')}{' '}
							queued.
						</p>
					) : null}
					{error ? (
						<p className="project-session-sync__error">{error}</p>
					) : null}
					{pendingReview ? (
						<div className="project-session-sync__actions">
							<button disabled={busy} onClick={acceptDisk} type="button">
								{pendingReview.delta.recovery
									? 'Reload From Disk'
									: 'Use Disk Version'}
							</button>
							<button disabled={busy} onClick={keepApp} type="button">
								Keep App Version
							</button>
							<button disabled={busy} onClick={reviewLater} type="button">
								Later
							</button>
						</div>
					) : null}
				</div>
			) : null}
		</>
	);
};
