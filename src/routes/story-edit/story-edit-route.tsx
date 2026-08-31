import * as React from 'react';
import {flushSync} from 'react-dom';
import {
	Navigate,
	UNSAFE_DataRouterContext,
	useBeforeUnload,
	useBlocker,
	useLocation,
	useParams
} from 'react-router';
import {MainContent} from '../../components/container/main-content';
import {DocumentTitle} from '../../components/document-title/document-title';
import {StoryEditActions} from '../../route-actions';
import {
	Passage,
	selectPassage,
	selectPassagesById,
	Story,
	useStoriesContext
} from '../../store/stories';
import {useTestFromHereAction} from '../../store/use-test-from-here-action';
import {
	EditorWindowSpec,
	editorWindowId,
	editorWindowsEqual
} from './editor-window-spec';
import {PassageFuzzyFinder} from './passage-fuzzy-finder';
import {StoryGraphPanel} from './story-graph-panel';
import {useInitialPassageCreation} from './use-initial-passage-creation';
import {usePassageChangeHandlers} from './use-passage-change-handlers';
import {useViewCenter} from './use-view-center';
import {StoryWorkspaceShell} from './story-workspace-shell';
import {
	type FindReplaceWorkbenchRequest,
	FindReplaceWorkbenchPanel,
	PassageTagsWorkbenchPanel,
	StoryDetailsWorkbenchPanel
} from './story-workbench-panels';
import type {StoryWorkbenchBottomDrawerPanel} from './workbench-extensions';
import {useCoreProjectHost} from '../../core';
import {workbenchBufferCoordinator} from '../../util/workbench-buffer-coordinator';
import {
	type StoryEditMode,
	type StoryGraphWorkspaceView,
	type StoryEditWorkspacePersistenceLease,
	invalidateStoryEditWorkspacePersistence,
	isStoryEditWorkspaceRevisionSnapshotCurrent,
	type StoryEditWorkspaceRevisionSnapshot,
	type StoryEditWorkspaceRevisionField,
	useStoryEditScrollMemory,
	useStoryEditWorkspace
} from './workspace-state';
import {
	resolveSourceNavigationTarget,
	sourceNavigationTargetFromQuery,
	type SourceNavigationTarget
} from './source-navigation';
import {
	hasStoryEditReveal,
	isStoryEditRevealApplied,
	armStoryEditRevealRollback,
	registerStoryEditRevealRollback,
	rejectStoryEditReveal,
	settleStoryEditReveal
} from '../story-edit-reveal';
import './story-edit-route.css';

function parsedInteger(value: string | null, minimum: number) {
	if (value === null || !/^\d+$/.test(value)) {
		return undefined;
	}

	return Math.max(minimum, Number(value));
}

function uniqueStoryPassage(story: Story, passageId: string) {
	const matches = story.passages.filter(passage => passage.id === passageId);
	return matches.length === 1 ? matches[0] : undefined;
}

function samePassageIds(left: string[], right: string[]) {
	return (
		left.length === right.length &&
		left.every((id, index) => id === right[index])
	);
}

function sameEditorWindowList(
	left: EditorWindowSpec[] | undefined,
	right: EditorWindowSpec[] | undefined
) {
	if (!left || !right) return left === right;
	return (
		left.length === right.length &&
		left.every((window_, index) => editorWindowsEqual(window_, right[index]))
	);
}

function restoreOwnedProjectWorkspaceFields(
	storyId: string,
	baseline: Record<string, unknown>,
	applied: Record<string, unknown>,
	revisions: StoryEditWorkspaceRevisionSnapshot
) {
	const key = `twine-story-edit-workspace-${storyId}`;
	try {
		const current = JSON.parse(
			window.localStorage.getItem(key) ?? '{}'
		) as Record<string, unknown>;
		for (const field of [
			'mode',
			'selectedPassageId',
			'activeWindowId',
			'editorWindows'
		] as const) {
			if (
				isStoryEditWorkspaceRevisionSnapshotCurrent(storyId, revisions, [
					field,
					'interaction'
				]) &&
				JSON.stringify(current[field]) === JSON.stringify(applied[field])
			) {
				current[field] = baseline[field];
			}
		}
		window.localStorage.setItem(key, JSON.stringify(current));
	} catch {
		// Local-storage recovery is best effort; the live same-story CAS remains
		// the source of truth when the originating route is still mounted.
	}
}

function restoreOwnedProjectGraphView(
	storyId: string,
	baseline: StoryGraphWorkspaceView,
	applied: StoryGraphWorkspaceView,
	revisions: StoryEditWorkspaceRevisionSnapshot
) {
	if (
		!isStoryEditWorkspaceRevisionSnapshotCurrent(storyId, revisions, [
			'graphView',
			'interaction'
		])
	)
		return;
	const key = `twine-story-edit-workspace-${storyId}`;
	try {
		const current = JSON.parse(
			window.localStorage.getItem(key) ?? '{}'
		) as Record<string, unknown>;
		if (JSON.stringify(current.graphView) !== JSON.stringify(applied)) return;
		current.graphView = baseline;
		window.localStorage.setItem(key, JSON.stringify(current));
	} catch {
		// Leave corrupt or independently changed persistence untouched.
	}
}

function sourceTextForTarget(story: Story, target: SourceNavigationTarget) {
	if (target.kind === 'script') {
		return story.script;
	}

	if (target.kind === 'stylesheet') {
		return story.stylesheet;
	}

	return undefined;
}

function sourcePositionForQuery(
	story: Story,
	target: SourceNavigationTarget,
	offsetValue: string | null,
	lineValue: string | null
) {
	const sourceText = sourceTextForTarget(story, target);

	if (sourceText === undefined) {
		return undefined;
	}

	return sourcePositionForText(sourceText, offsetValue, lineValue);
}

function sourcePositionForText(
	sourceText: string,
	offsetValue: string | null,
	lineValue: string | null
) {
	const offset = parsedInteger(offsetValue, 0);

	if (offset !== undefined) {
		return Math.min(offset, sourceText.length);
	}

	const line = parsedInteger(lineValue, 1);

	if (line === undefined) {
		return undefined;
	}

	let lineStart = 0;

	for (let currentLine = 1; currentLine < line; currentLine++) {
		const nextLineStart = sourceText.indexOf('\n', lineStart);

		if (nextLineStart === -1) {
			return sourceText.length;
		}

		lineStart = nextLineStart + 1;
	}

	return lineStart;
}

const DataRouterWorkbenchNavigationGuard: React.FC<{storyId: string}> = ({
	storyId
}) => {
	const shouldBlock = React.useCallback(
		({
			currentLocation,
			nextLocation
		}: {
			currentLocation: {pathname: string};
			nextLocation: {pathname: string};
		}) =>
			currentLocation.pathname !== nextLocation.pathname &&
			workbenchBufferCoordinator.hasPendingChanges(storyId),
		[storyId]
	);
	const blocker = useBlocker(shouldBlock);

	useBeforeUnload(
		React.useCallback(
			event => {
				if (!workbenchBufferCoordinator.hasPendingChanges(storyId)) {
					return;
				}

				event.preventDefault();
				event.returnValue = '';
			},
			[storyId]
		)
	);

	React.useLayoutEffect(() => {
		if (blocker.state !== 'blocked') {
			return;
		}

		let active = true;

		void workbenchBufferCoordinator.flushStory(storyId).then(
			() => {
				if (active) {
					blocker.proceed();
				}
			},
			() => {
				if (active) {
					blocker.reset();
				}
			}
		);

		return () => {
			active = false;
		};
	}, [blocker, storyId]);

	return null;
};

const WorkbenchNavigationGuard: React.FC<{storyId: string}> = ({storyId}) => {
	const dataRouter = React.useContext(UNSAFE_DataRouterContext);

	return dataRouter ? (
		<DataRouterWorkbenchNavigationGuard storyId={storyId} />
	) : null;
};

const StoryEditRouteForStory: React.FC<{story: Story}> = ({story}) => {
	const location = useLocation();
	const {dispatch} = useStoriesContext();
	const coreProjectHost = useCoreProjectHost();
	const {
		pending: testPassagePending,
		pendingPassageId: testPassagePendingId,
		run: runTestFromHere
	} = useTestFromHereAction(story);
	const [fuzzyFinderOpen, setFuzzyFinderOpen] = React.useState(false);
	const [graphRevealRequest, setGraphRevealRequest] = React.useState({
		key: 0,
		passageId: '',
		requestId: undefined as string | undefined
	});
	const [revealRequests, setRevealRequests] = React.useState(
		() => new Map<string, {end?: number; key: number; position?: number}>()
	);
	const [searchRequests, setSearchRequests] = React.useState(
		() => new Map<string, {key: number; query?: string}>()
	);
	const [findReplaceRequest, setFindReplaceRequest] =
		React.useState<FindReplaceWorkbenchRequest>();
	const [pendingReveal, setPendingReveal] = React.useState<
		| {
				graphApplied?: boolean;
				graphRequestKey?: number;
				mode: 'graph' | 'text';
				passageId: string;
				requestId: string;
		  }
		| undefined
	>();
	const activeRevealRequest = React.useRef<string | undefined>(undefined);
	const revealTransaction = React.useRef<
		| {
				graphPersistenceRollback?: () => void;
				graphRollback?: () => void;
				graphWorkspaceRevisions?: StoryEditWorkspaceRevisionSnapshot;
				originPersistenceLease: StoryEditWorkspacePersistenceLease;
				originStoryId: string;
				revisions?: StoryEditWorkspaceRevisionSnapshot;
				revealedBuffer?: {
					bufferId: string;
					snapshot: ReturnType<
						typeof workbenchBufferCoordinator.captureSnapshot
					>;
				};
				requestId: string;
		  }
		| undefined
	>(undefined);
	const routeMounted = React.useRef(true);
	const storyRef = React.useRef(story);
	storyRef.current = story;
	const pendingRevealRef = React.useRef(pendingReveal);
	pendingRevealRef.current = pendingReveal;
	const revealNavigationEpoch = React.useRef(0);
	const handledRevealLocation = React.useRef<string | undefined>(undefined);
	const mainContent = React.useRef<HTMLDivElement>(null);
	const workspace = useStoryEditWorkspace(story);
	const {getCenter, setCenter} = useViewCenter(story, mainContent);
	const {
		handleCreatePassage,
		handleDeselectPassage,
		handleSelectPassage,
		handleSelectPassageIds
	} = usePassageChangeHandlers(
		story,
		workspace.markPassageSelectionInteraction
	);

	React.useEffect(() => {
		if (!pendingReveal) {
			return;
		}
		const applied =
			workspace.selectedPassageId === pendingReveal.passageId &&
			workspace.mode === pendingReveal.mode &&
			(pendingReveal.mode === 'graph'
				? pendingReveal.graphApplied
				: workspace.activeWindowId ===
					editorWindowId({
						kind: 'passage',
						passageId: pendingReveal.passageId
					}));
		if (
			applied &&
			(!hasStoryEditReveal(pendingReveal.requestId) ||
				!uniqueStoryPassage(storyRef.current, pendingReveal.passageId))
		) {
			rejectStoryEditReveal(
				pendingReveal.requestId,
				new Error(
					'The requested passage no longer exists uniquely in the story.'
				)
			);
			if (activeRevealRequest.current === pendingReveal.requestId) {
				activeRevealRequest.current = undefined;
			}
			setPendingReveal(undefined);
			return;
		}
		if (applied) {
			const transaction = revealTransaction.current;
			if (
				transaction?.requestId === pendingReveal.requestId &&
				pendingReveal.mode === 'text'
			) {
				const bufferId = pendingReveal.passageId;
				transaction.revealedBuffer = {
					bufferId,
					snapshot: workbenchBufferCoordinator.captureSnapshot(
						story.id,
						bufferId
					)
				};
			}
			settleStoryEditReveal(pendingReveal.requestId);
			if (activeRevealRequest.current === pendingReveal.requestId) {
				activeRevealRequest.current = undefined;
			}
			setPendingReveal(undefined);
		}
	}, [
		pendingReveal,
		story,
		workspace.activeWindowId,
		workspace.mode,
		workspace.selectedPassageId
	]);

	const handleGraphRevealApplied = React.useCallback(
		(passageId: string, requestKey: number) => {
			const current = pendingRevealRef.current;

			if (
				!current ||
				current.mode !== 'graph' ||
				current.passageId !== passageId ||
				current.graphRequestKey !== requestKey
			) {
				return;
			}
			if (
				!hasStoryEditReveal(current.requestId) ||
				!uniqueStoryPassage(storyRef.current, passageId)
			) {
				pendingRevealRef.current = undefined;
				rejectStoryEditReveal(
					current.requestId,
					new Error(
						'The requested passage no longer exists uniquely in the story.'
					)
				);
				if (activeRevealRequest.current === current.requestId) {
					activeRevealRequest.current = undefined;
				}
				setPendingReveal(undefined);
				return;
			}

			const acknowledged = {...current, graphApplied: true};
			pendingRevealRef.current = acknowledged;
			setPendingReveal(candidate =>
				candidate?.requestId === current.requestId ? acknowledged : candidate
			);
		},
		[]
	);

	React.useEffect(() => {
		routeMounted.current = true;
		return () => {
			routeMounted.current = false;
			const requestId = activeRevealRequest.current;

			if (requestId) {
				rejectStoryEditReveal(
					requestId,
					new Error('The editor closed before applying the reveal request.')
				);
			}
		};
	}, []);

	useInitialPassageCreation(story, getCenter);
	useStoryEditScrollMemory(story.id, workspace.mode, mainContent);

	const editorWindowsRef = React.useRef(workspace.editorWindows);
	editorWindowsRef.current = workspace.editorWindows;

	const handleChoosePassage = React.useCallback(
		(passage: Passage) => {
			workspace.setSelectedPassageId(passage.id);
			workspace.markPassageSelectionInteraction();
			dispatch(selectPassage(story, passage, true));
		},
		[dispatch, story, workspace]
	);

	// The dock list with the implicit "follow selection" view materialized, so
	// open/close/reorder always operate on a concrete list.
	const materializedWindows = React.useCallback(
		(selectedId = workspace.selectedPassageId): EditorWindowSpec[] => {
			if (editorWindowsRef.current) {
				return editorWindowsRef.current;
			}

			return selectedId ? [{kind: 'passage', passageId: selectedId}] : [];
		},
		[workspace.selectedPassageId]
	);

	const openEditorWindow = React.useCallback(
		(spec: EditorWindowSpec, options: {preserveMode?: boolean} = {}) => {
			workspace.setEditorWindows(current => {
				const list = current ?? materializedWindows();

				return list.some(window_ => editorWindowsEqual(window_, spec))
					? list
					: [...list, spec];
			});
			workspace.setActiveWindowId(editorWindowId(spec));

			if (spec.kind === 'passage') {
				workspace.setSelectedPassageId(spec.passageId);
			}

			if (workspace.mode === 'graph' && !options.preserveMode) {
				workspace.setMode('split');
			}
		},
		[materializedWindows, workspace]
	);

	const handleEditPassage = React.useCallback(
		(passage: Passage) => {
			openEditorWindow({kind: 'passage', passageId: passage.id});
		},
		[openEditorWindow]
	);
	const handleEditPassages = React.useCallback(
		(passages: Passage[]) => {
			if (passages.length === 0) {
				return;
			}

			const specs = passages.map((passage): EditorWindowSpec => ({
				kind: 'passage',
				passageId: passage.id
			}));

			workspace.setEditorWindows(current => {
				const next = [...(current ?? materializedWindows())];

				for (const spec of specs) {
					if (!next.some(window_ => editorWindowsEqual(window_, spec))) {
						next.push(spec);
					}
				}

				return next;
			});
			workspace.setSelectedPassageId(passages[0].id);
			workspace.setActiveWindowId(editorWindowId(specs[0]));

			if (workspace.mode === 'graph') {
				workspace.setMode('split');
			}
		},
		[materializedWindows, workspace]
	);
	const handleCloseEditorWindow = React.useCallback(
		(spec: EditorWindowSpec) => {
			const id = editorWindowId(spec);
			const next = materializedWindows().filter(
				window_ => !editorWindowsEqual(window_, spec)
			);

			workspace.setEditorWindows(next);
			workspace.setActiveWindowId(current =>
				current === id
					? next.length
						? editorWindowId(next[next.length - 1])
						: undefined
					: current
			);

			if (next.length === 0 && workspace.mode === 'split') {
				workspace.setMode('graph');
			}
		},
		[materializedWindows, workspace]
	);
	const handleFocusEditorWindow = React.useCallback(
		(id: string) => {
			workspace.setActiveWindowId(id);

			if (id.startsWith('passage:')) {
				workspace.setSelectedPassageId(id.slice('passage:'.length));
			}
		},
		[workspace]
	);
	const handleReorderEditorWindows = React.useCallback(
		(from: number, to: number) => {
			const list = [...materializedWindows()];
			const [moved] = list.splice(from, 1);

			if (!moved) {
				return;
			}

			list.splice(to, 0, moved);
			workspace.setEditorWindows(list);
		},
		[materializedWindows, workspace]
	);
	const handleRevealPassageInGraph = React.useCallback(
		(passage: Passage) => {
			handleChoosePassage(passage);
			setGraphRevealRequest(current => ({
				key: current.key + 1,
				passageId: passage.id,
				requestId: undefined
			}));

			if (workspace.mode === 'text') {
				workspace.setMode('split');
			}
		},
		[handleChoosePassage, workspace]
	);
	const handleSelectPassageInMap = React.useCallback(
		(passage: Passage, exclusive: boolean) => {
			workspace.setSelectedPassageId(passage.id);
			handleSelectPassage(passage, exclusive);
		},
		[handleSelectPassage, workspace]
	);
	const handleTestPassage = React.useCallback(
		(passage: Passage) => {
			runTestFromHere(passage.id);
		},
		[runTestFromHere]
	);
	const openWorkbenchPanel = React.useCallback(
		(
			id: 'find-replace' | 'story-details' | 'passage-tags',
			request?: Omit<FindReplaceWorkbenchRequest, 'key'>
		) => {
			if (id === 'find-replace') {
				setFindReplaceRequest(current => ({
					...request,
					key: (current?.key ?? 0) + 1
				}));
			}
			workspace.setBottomDrawerPanelId(id);
			workspace.setBottomDrawerOpen(true);
		},
		[workspace]
	);
	const bottomDrawerPanels = React.useMemo<StoryWorkbenchBottomDrawerPanel[]>(
		() => [
			{
				icon: 'search',
				id: 'find-replace',
				render: context => (
					<FindReplaceWorkbenchPanel
						context={context}
						onOpenDetails={() => openWorkbenchPanel('story-details')}
						request={findReplaceRequest}
					/>
				),
				title: 'Find / Replace'
			},
			{
				icon: 'info-circle',
				id: 'story-details',
				render: context => <StoryDetailsWorkbenchPanel context={context} />,
				title: 'Details'
			},
			{
				icon: 'tags',
				id: 'passage-tags',
				render: context => <PassageTagsWorkbenchPanel context={context} />,
				title: 'Passage Tags'
			}
		],
		[findReplaceRequest, openWorkbenchPanel]
	);
	const handleChangeMode = React.useCallback(
		async (mode: StoryEditMode) => {
			if (mode === workspace.mode) {
				return;
			}
			try {
				await workbenchBufferCoordinator.flushStory(story.id);
				workspace.setMode(mode);
			} catch (error) {
				window.alert(
					`Could not save the open editor before changing views (${(error as Error).message}).`
				);
			}
		},
		[story.id, workspace]
	);
	const currentRevealActions = React.useRef({
		handleChoosePassage,
		openEditorWindow,
		workspace
	});
	currentRevealActions.current = {
		handleChoosePassage,
		openEditorWindow,
		workspace
	};

	React.useEffect(() => {
		const locationIdentity = `${location.key}\u0000${location.pathname}\u0000${location.search}`;
		if (handledRevealLocation.current === locationIdentity) {
			return;
		}
		handledRevealLocation.current = locationIdentity;
		const epoch = ++revealNavigationEpoch.current;
		const isCurrentLocation = () => revealNavigationEpoch.current === epoch;
		const previousRequest = activeRevealRequest.current;

		if (previousRequest) {
			rejectStoryEditReveal(
				previousRequest,
				new Error('The reveal request was superseded by navigation.')
			);
			activeRevealRequest.current = undefined;
			setPendingReveal(current =>
				current?.requestId === previousRequest ? undefined : current
			);
		}
		if (!location.search) {
			return;
		}

		const search = new URLSearchParams(location.search);
		const mode = search.get('mode');
		const passageId = search.get('passage');
		const suppliedRevealRequest = search.get('revealRequest');
		// A reveal URL is a capability, not a normal deep link with extra
		// decoration. Once its rendezvous has expired or been cancelled, it must
		// not be replayed as ordinary editor navigation.
		if (
			search.has('revealRequest') &&
			(!suppliedRevealRequest || !hasStoryEditReveal(suppliedRevealRequest))
		) {
			return;
		}
		// A settled capability can remain live while Electron awaits the exact
		// main-process terminal result. Revisiting its URL must not apply the same
		// transaction through a newer editor instance.
		if (
			suppliedRevealRequest &&
			isStoryEditRevealApplied(suppliedRevealRequest)
		) {
			return;
		}
		const revealRequest =
			suppliedRevealRequest && hasStoryEditReveal(suppliedRevealRequest)
				? suppliedRevealRequest
				: undefined;
		const query = search.get('q')?.trim();
		const target =
			sourceNavigationTargetFromQuery(search.get('source')) ??
			(passageId ? ({kind: 'passage', passageId} as const) : undefined);
		const {spec, target: resolvedTarget} = resolveSourceNavigationTarget(
			story,
			target
		);
		const passage =
			resolvedTarget?.kind === 'passage'
				? story.passages.find(
						passage => passage.id === resolvedTarget.passageId
					)
				: undefined;
		const offsetValue = search.get('offset');
		const endValue = search.get('end');
		const lineValue = search.get('line');
		const revealPosition = resolvedTarget
			? resolvedTarget.kind === 'passage'
				? parsedInteger(offsetValue, 0)
				: sourcePositionForQuery(story, resolvedTarget, offsetValue, lineValue)
			: undefined;
		const liveRevealPassage = () =>
			revealRequest && resolvedTarget?.kind === 'passage'
				? hasStoryEditReveal(revealRequest)
					? uniqueStoryPassage(storyRef.current, resolvedTarget.passageId)
					: undefined
				: undefined;
		const revealEnd =
			resolvedTarget?.kind === 'passage'
				? parsedInteger(endValue, 0)
				: undefined;

		const apply = async () => {
			try {
				if (revealRequest) {
					if (mode !== 'graph' && mode !== 'text') {
						throw new Error('The reveal request has an invalid editor mode.');
					}
					activeRevealRequest.current = revealRequest;
					await workbenchBufferCoordinator.flushStory(story.id);
					if (!isCurrentLocation() || !hasStoryEditReveal(revealRequest)) {
						return;
					}
					if (!liveRevealPassage()) {
						throw new Error(
							'The requested passage no longer exists uniquely in the story.'
						);
					}
				}
				if (!isCurrentLocation()) return;
				if (revealRequest && !liveRevealPassage()) {
					throw new Error(
						'The requested passage no longer exists in the story.'
					);
				}
				if (revealRequest) {
					// A correlated reveal has one commit boundary. Once its deadline has
					// elapsed, none of the editor's visible route state may be changed.
					if (mode !== 'graph' && mode !== 'text') {
						throw new Error('The reveal request has an invalid editor mode.');
					}
					const revealMode = mode;
					let committed = false;
					let graphModePrepared = false;
					let graphPreviousMode: StoryEditMode | undefined;
					if (revealMode === 'graph') {
						// The panel must be visible before its layout effect measures the
						// viewport. Keep this preparatory commit in the same task, with a
						// second liveness-fenced transaction below.
						flushSync(() => {
							if (
								!isCurrentLocation() ||
								!hasStoryEditReveal(revealRequest) ||
								!liveRevealPassage()
							)
								return;
							graphPreviousMode = currentRevealActions.current.workspace.mode;
							currentRevealActions.current.workspace.setMode('graph');
							graphModePrepared = true;
						});
						if (!graphModePrepared) return;
					}
					flushSync(() => {
						if (
							!isCurrentLocation() ||
							!hasStoryEditReveal(revealRequest) ||
							!liveRevealPassage()
						)
							return;
						const actionablePassage = liveRevealPassage();
						if (!actionablePassage) return;
						const currentWorkspace = currentRevealActions.current.workspace;
						const previous = {
							activeWindowId: currentWorkspace.activeWindowId,
							editorWindows: currentWorkspace.editorWindows,
							graphRequest: graphRevealRequest,
							mode: graphPreviousMode ?? currentWorkspace.mode,
							selectedIds: storyRef.current.passages
								.filter(passage => passage.selected)
								.map(passage => passage.id),
							selectedPassageId: currentWorkspace.selectedPassageId
						};
						const spec = {
							kind: 'passage',
							passageId: actionablePassage.id
						} as const;
						const appliedWindows =
							previous.editorWindows ??
							(previous.selectedPassageId
								? [{kind: 'passage', passageId: previous.selectedPassageId}]
								: []);
						const nextWindows = appliedWindows.some(window_ =>
							editorWindowsEqual(window_, spec)
						)
							? appliedWindows
							: [...appliedWindows, spec];
						const nextGraphRequest = {
							key: graphRevealRequest.key + 1,
							passageId: actionablePassage.id,
							requestId: revealRequest
						};
						const originStoryId = story.id;
						let originWorkspaceSnapshot: Record<string, unknown> = {};
						try {
							originWorkspaceSnapshot = JSON.parse(
								window.localStorage.getItem(
									`twine-story-edit-workspace-${originStoryId}`
								) ?? '{}'
							) as Record<string, unknown>;
						} catch {
							// Corrupt persistence cannot prevent a live reveal.
						}
						// Graph mode is prepared in an earlier flush so its workspace
						// effect may already have persisted `graph`. Bind the snapshot's
						// reveal-owned fields to the pre-transaction React state instead.
						originWorkspaceSnapshot = {
							...originWorkspaceSnapshot,
							activeWindowId: previous.activeWindowId,
							editorWindows: previous.editorWindows,
							mode: previous.mode,
							selectedPassageId: previous.selectedPassageId
						};
						const transaction = {
							originPersistenceLease: currentWorkspace.persistenceLease,
							originStoryId,
							requestId: revealRequest
						} as {
							graphPersistenceRollback?: () => void;
							graphRollback?: () => void;
							graphWorkspaceRevisions?: StoryEditWorkspaceRevisionSnapshot;
							originPersistenceLease: StoryEditWorkspacePersistenceLease;
							originStoryId: string;
							revisions?: StoryEditWorkspaceRevisionSnapshot;
							revealedBuffer?: {
								bufferId: string;
								snapshot: ReturnType<
									typeof workbenchBufferCoordinator.captureSnapshot
								>;
							};
							requestId: string;
						};
						const restoreOriginWorkspace = () => {
							const ownsBufferRevision =
								!transaction.revealedBuffer ||
								workbenchBufferCoordinator.isSnapshotRevisionCurrent(
									transaction.revealedBuffer.snapshot
								);
							dispatch((currentDispatch, getState) => {
								const currentOriginStory = getState().find(
									candidate => candidate.id === originStoryId
								);
								if (!currentOriginStory) return;
								const selectedIds = currentOriginStory.passages
									.filter(passage => passage.selected)
									.map(passage => passage.id);
								if (
									ownsBufferRevision &&
									isStoryEditWorkspaceRevisionSnapshotCurrent(
										originStoryId,
										transaction.revisions!,
										['passageSelection', 'interaction']
									) &&
									samePassageIds(selectedIds, [actionablePassage.id])
								) {
									currentDispatch(
										selectPassagesById(currentOriginStory, previous.selectedIds)
									);
								}
							});
							if (ownsBufferRevision) {
								restoreOwnedProjectWorkspaceFields(
									originStoryId,
									originWorkspaceSnapshot,
									{
										activeWindowId:
											revealMode === 'text'
												? editorWindowId(spec)
												: previous.activeWindowId,
										editorWindows:
											revealMode === 'text'
												? nextWindows
												: previous.editorWindows,
										mode: revealMode,
										selectedPassageId: actionablePassage.id
									},
									transaction.revisions!
								);
							}
							// This path runs only after the originating story has unmounted or
							// another story owns the reused graph panel. Never invoke its live
							// view callback here: an equal transform could otherwise make an A
							// rejection overwrite Story B's visible graph. The origin-bound
							// persistence CAS below is the only safe cross-story compensation.
							transaction.graphPersistenceRollback?.();
						};
						revealTransaction.current = transaction;
						registerStoryEditRevealRollback(revealRequest, () => {
							if (
								!routeMounted.current ||
								storyRef.current.id !== originStoryId
							) {
								invalidateStoryEditWorkspacePersistence(
									transaction.originPersistenceLease
								);
								// Let the origin graph/workspace unmount effects finish first;
								// then compensate only origin-bound persisted fields.
								window.setTimeout(restoreOriginWorkspace, 0);
								return;
							}
							if (revealTransaction.current !== transaction) return;
							queueMicrotask(() => {
								if (revealTransaction.current !== transaction) return;
								if (
									!routeMounted.current ||
									storyRef.current.id !== originStoryId
								) {
									invalidateStoryEditWorkspacePersistence(
										transaction.originPersistenceLease
									);
									window.setTimeout(restoreOriginWorkspace, 0);
									return;
								}
								const liveWorkspace = currentRevealActions.current.workspace;
								const ownsInteraction = liveWorkspace.isRevisionSnapshotCurrent(
									transaction.revisions!,
									['interaction']
								);
								const ownsField = (field: StoryEditWorkspaceRevisionField) =>
									ownsInteraction &&
									liveWorkspace.isRevisionSnapshotCurrent(
										transaction.revisions!,
										[field]
									);
								const ownsBuffer =
									!transaction.revealedBuffer ||
									workbenchBufferCoordinator.isSnapshotCurrent(
										originStoryId,
										transaction.revealedBuffer.bufferId,
										transaction.revealedBuffer.snapshot
									);
								if (
									ownsField('mode') &&
									ownsBuffer &&
									liveWorkspace.mode === revealMode
								)
									liveWorkspace.setMode(previous.mode);
								if (
									ownsField('selectedPassageId') &&
									ownsBuffer &&
									liveWorkspace.selectedPassageId === actionablePassage.id
								)
									liveWorkspace.setSelectedPassageId(
										previous.selectedPassageId
									);
								if (
									ownsField('activeWindowId') &&
									ownsBuffer &&
									liveWorkspace.activeWindowId === editorWindowId(spec)
								)
									liveWorkspace.setActiveWindowId(previous.activeWindowId);
								if (
									ownsField('editorWindows') &&
									ownsBuffer &&
									sameEditorWindowList(liveWorkspace.editorWindows, nextWindows)
								)
									liveWorkspace.setEditorWindows(previous.editorWindows);
								const selectedIds = storyRef.current.passages
									.filter(passage => passage.selected)
									.map(passage => passage.id);
								if (
									ownsBuffer &&
									ownsInteraction &&
									liveWorkspace.isRevisionSnapshotCurrent(
										transaction.revisions!,
										['passageSelection']
									) &&
									samePassageIds(selectedIds, [actionablePassage.id])
								)
									dispatch(
										selectPassagesById(storyRef.current, previous.selectedIds)
									);
								setPendingReveal(current =>
									current?.requestId === revealRequest ? undefined : current
								);
								setGraphRevealRequest(current =>
									current.requestId === revealRequest
										? previous.graphRequest
										: current
								);
								transaction.graphRollback?.();
							});
						});
						currentWorkspace.setMode(revealMode);
						currentWorkspace.setSelectedPassageId(actionablePassage.id);
						currentWorkspace.setActiveWindowId(
							revealMode === 'text'
								? editorWindowId(spec)
								: previous.activeWindowId
						);
						if (revealMode === 'text')
							currentWorkspace.setEditorWindows(nextWindows);
						currentWorkspace.markPassageSelectionInteraction();
						dispatch(selectPassage(storyRef.current, actionablePassage, true));
						if (revealMode === 'graph') setGraphRevealRequest(nextGraphRequest);
						setPendingReveal({
							...(revealMode === 'graph'
								? {graphRequestKey: nextGraphRequest.key}
								: {}),
							mode: revealMode,
							passageId: actionablePassage.id,
							requestId: revealRequest
						});
						transaction.revisions = currentWorkspace.getRevisionSnapshot();
						committed = armStoryEditRevealRollback(revealRequest);
					});
					if (!committed) {
						if (graphModePrepared) {
							flushSync(() => {
								currentRevealActions.current.workspace.setMode(
									graphPreviousMode!
								);
							});
						}
						return;
					}
					return;
				}
				if (mode === 'text' || mode === 'graph' || mode === 'split') {
					await handleChangeMode(mode);
					if (!isCurrentLocation()) return;
				}

				const actionablePassage = revealRequest ? liveRevealPassage() : passage;
				if (mode === 'graph' && actionablePassage) {
					const nextGraphRequest = {
						key: graphRevealRequest.key + 1,
						passageId: actionablePassage.id,
						requestId: revealRequest
					};

					if (revealRequest && !liveRevealPassage()) {
						throw new Error(
							'The requested passage no longer exists uniquely in the story.'
						);
					}
					currentRevealActions.current.handleChoosePassage(actionablePassage);
					setGraphRevealRequest(nextGraphRequest);
					if (revealRequest) {
						setPendingReveal({
							graphRequestKey: nextGraphRequest.key,
							mode: 'graph',
							passageId: actionablePassage.id,
							requestId: revealRequest
						});
					}
					return;
				}

				if (spec) {
					if (revealRequest && !liveRevealPassage()) {
						throw new Error(
							'The requested passage no longer exists uniquely in the story.'
						);
					}
					currentRevealActions.current.openEditorWindow(spec, {
						preserveMode: mode === 'text'
					});

					if (actionablePassage) {
						if (revealRequest && !liveRevealPassage()) {
							throw new Error(
								'The requested passage no longer exists uniquely in the story.'
							);
						}
						currentRevealActions.current.handleChoosePassage(actionablePassage);
					}

					const windowId = editorWindowId(spec);

					if (revealPosition !== undefined) {
						setRevealRequests(current => {
							const next = new Map(current);
							const previous = current.get(windowId);

							next.set(windowId, {
								end:
									revealEnd !== undefined && revealEnd >= revealPosition
										? revealEnd
										: undefined,
								key: (previous?.key ?? 0) + 1,
								position: revealPosition
							});
							return next;
						});
					} else if (resolvedTarget?.kind === 'passage' && lineValue !== null) {
						void coreProjectHost
							.queryPassageDocumentAsync(story.id, resolvedTarget.passageId)
							.then(document => {
								if (!isCurrentLocation()) return;
								if (revealRequest && !hasStoryEditReveal(revealRequest)) return;
								if (
									!uniqueStoryPassage(
										storyRef.current,
										resolvedTarget.passageId
									)
								) {
									if (revealRequest) {
										rejectStoryEditReveal(
											revealRequest,
											new Error(
												'The requested passage no longer exists uniquely in the story.'
											)
										);
									}
									return;
								}
								const position = sourcePositionForText(
									document.text,
									null,
									lineValue
								);

								if (position !== undefined) {
									setRevealRequests(current => {
										const next = new Map(current);
										const previous = current.get(windowId);

										next.set(windowId, {
											key: (previous?.key ?? 0) + 1,
											position
										});
										return next;
									});
								}
							});
					}

					if (query) {
						setSearchRequests(current => {
							const next = new Map(current);
							const previous = current.get(windowId);

							next.set(windowId, {
								key: (previous?.key ?? 0) + 1,
								query
							});
							return next;
						});
					}
					if (revealRequest && resolvedTarget?.kind === 'passage') {
						if (!liveRevealPassage()) {
							throw new Error(
								'The requested passage no longer exists uniquely in the story.'
							);
						}
						setPendingReveal({
							mode: 'text',
							passageId: resolvedTarget.passageId,
							requestId: revealRequest
						});
					}
					return;
				}

				if (query) openWorkbenchPanel('find-replace', {query});
				if (revealRequest) {
					throw new Error('The reveal request did not identify a passage.');
				}
			} catch (error) {
				if (revealRequest) {
					if (isCurrentLocation()) {
						rejectStoryEditReveal(revealRequest, error as Error);
						if (activeRevealRequest.current === revealRequest) {
							activeRevealRequest.current = undefined;
						}
					}
					return;
				}
				throw error;
			}
		};
		void apply();
	}, [
		coreProjectHost,
		graphRevealRequest.key,
		handleChangeMode,
		handleChoosePassage,
		location.key,
		location.pathname,
		location.search,
		openWorkbenchPanel,
		openEditorWindow,
		story,
		workspace
	]);

	return (
		<div className="story-edit-route">
			<WorkbenchNavigationGuard storyId={story.id} />
			<DocumentTitle title={story.name} />
			<StoryEditActions
				bottomDrawerOpen={workspace.bottomDrawerOpen}
				getCenter={getCenter}
				leftDockCollapsed={workspace.leftDockCollapsed}
				mode={workspace.mode}
				onChangeBottomDrawerOpen={workspace.setBottomDrawerOpen}
				onChangeLeftDockCollapsed={workspace.setLeftDockCollapsed}
				onChangeMode={mode => void handleChangeMode(mode)}
				onChangeRightDockCollapsed={workspace.setRightDockCollapsed}
				onEditPassages={handleEditPassages}
				onOpenEditorWindow={kind => openEditorWindow({kind})}
				onOpenFuzzyFinder={() => setFuzzyFinderOpen(true)}
				onOpenWorkbenchPanel={id => openWorkbenchPanel(id)}
				onTestPassage={handleTestPassage}
				rightDockCollapsed={workspace.rightDockCollapsed}
				story={story}
				testPassagePending={testPassagePending}
				testPassagePendingId={testPassagePendingId}
			/>
			<MainContent grabbable={false} padded={false} ref={mainContent}>
				<StoryWorkspaceShell
					activeBottomDrawerPanelId={workspace.bottomDrawerPanelId}
					bottomDrawerPanels={bottomDrawerPanels}
					bottomDrawerOpen={workspace.bottomDrawerOpen}
					editorDockLayout={workspace.editorDockLayout}
					graphPanel={
						<StoryGraphPanel
							graphOptions={workspace.graphOptions}
							graphView={workspace.graphView}
							isRevealRequestActive={() =>
								!graphRevealRequest.requestId ||
								hasStoryEditReveal(graphRevealRequest.requestId)
							}
							onCreate={handleCreatePassage}
							onGraphOptionsChange={workspace.setGraphOptions}
							onGraphViewChange={workspace.setGraphView}
							onRevealRollback={(
								requestKey,
								rollback,
								previousView,
								appliedView,
								isAppliedViewCurrent
							) => {
								const transaction = revealTransaction.current;
								if (
									transaction &&
									graphRevealRequest.requestId === transaction.requestId &&
									graphRevealRequest.key === requestKey
								) {
									transaction.graphRollback = rollback;
									transaction.graphWorkspaceRevisions =
										workspace.getRevisionSnapshot();
									transaction.revisions = workspace.getRevisionSnapshot();
									transaction.graphPersistenceRollback = () =>
										isAppliedViewCurrent() &&
										transaction.graphWorkspaceRevisions &&
										restoreOwnedProjectGraphView(
											transaction.originStoryId,
											previousView,
											appliedView,
											transaction.graphWorkspaceRevisions
										);
								}
							}}
							onRevealApplied={handleGraphRevealApplied}
							onDeselect={handleDeselectPassage}
							onEdit={handleEditPassage}
							onEditPassages={handleEditPassages}
							onSelect={handleSelectPassageInMap}
							onSelectIds={handleSelectPassageIds}
							onTestPassage={handleTestPassage}
							revealPassageId={graphRevealRequest.passageId}
							revealRequestKey={graphRevealRequest.key}
							selectedPassageId={workspace.selectedPassageId}
							story={story}
							testPassagePending={testPassagePending}
							testPassagePendingId={testPassagePendingId}
						/>
					}
					leftDockCollapsed={workspace.leftDockCollapsed}
					mode={workspace.mode}
					activeWindowId={workspace.activeWindowId}
					editorWindows={workspace.editorWindows}
					onChangeBottomDrawerOpen={workspace.setBottomDrawerOpen}
					onChangeBottomDrawerPanel={workspace.setBottomDrawerPanelId}
					onChangeEditorDockLayout={workspace.setEditorDockLayout}
					onChangeLeftDockCollapsed={workspace.setLeftDockCollapsed}
					onChangeRightDockCollapsed={workspace.setRightDockCollapsed}
					onCloseEditorWindow={handleCloseEditorWindow}
					onFocusEditorWindow={handleFocusEditorWindow}
					onOpenEditorWindow={openEditorWindow}
					onOpenFindReplace={(query, options) =>
						openWorkbenchPanel('find-replace', {query, ...options})
					}
					onReorderEditorWindows={handleReorderEditorWindows}
					onRevealPassageInGraph={handleRevealPassageInGraph}
					onSelectPassage={handleChoosePassage}
					onTestPassage={handleTestPassage}
					testPassagePending={testPassagePending}
					testPassagePendingId={testPassagePendingId}
					overlay={
						<PassageFuzzyFinder
							onClose={() => setFuzzyFinderOpen(false)}
							onOpen={() => setFuzzyFinderOpen(true)}
							onRevealPassageInGraph={handleRevealPassageInGraph}
							onTestPassage={handleTestPassage}
							open={fuzzyFinderOpen}
							setCenter={setCenter}
							story={story}
							testPassagePending={testPassagePending}
							testPassagePendingId={testPassagePendingId}
						/>
					}
					revealRequests={revealRequests}
					rightDockCollapsed={workspace.rightDockCollapsed}
					searchRequests={searchRequests}
					selectedPassageId={workspace.selectedPassageId}
					story={story}
				/>
			</MainContent>
		</div>
	);
};

export const InnerStoryEditRoute: React.FC = () => {
	const {storyId = ''} = useParams<'storyId'>();
	const {stories} = useStoriesContext();
	const story = stories.find(candidate => candidate.id === storyId);

	return story ? (
		<StoryEditRouteForStory key={story.id} story={story} />
	) : (
		<Navigate replace to="/" />
	);
};

export const StoryEditRoute: React.FC = InnerStoryEditRoute;
