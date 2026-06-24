import * as React from 'react';
import type {CoreLinkLayerOptions} from '../../core/bindings/CoreLinkLayerOptions';
import {usePrefsContext} from '../../store/prefs';
import type {StoryEditModePreference} from '../../store/prefs';
import {Story} from '../../store/stories';
import {EditorWindowSpec, editorWindowId} from './editor-window-spec';

export const storyEditModes = ['text', 'graph', 'split'] as const;
export const storyGraphDensities = ['structure', 'names', 'excerpt'] as const;
export const storyGraphOrientations = ['right', 'down', 'left', 'up'] as const;
export const storyGraphTools = ['select', 'pan'] as const;
export const editorDockLayouts = ['tile', 'stack'] as const;

export type StoryEditMode = (typeof storyEditModes)[number];
export type StoryGraphDensity = (typeof storyGraphDensities)[number];
export type StoryGraphOrientation = (typeof storyGraphOrientations)[number];
export type StoryGraphTool = (typeof storyGraphTools)[number];
export type EditorDockLayout = (typeof editorDockLayouts)[number];

interface ScrollPosition {
	left: number;
	top: number;
}

export interface StoryGraphWorkspaceView {
	k: number;
	x: number;
	y: number;
}

export interface StoryGraphWorkspaceOptions {
	density?: StoryGraphDensity;
	focusSelection?: boolean;
	layers?: Partial<CoreLinkLayerOptions>;
	orientation?: StoryGraphOrientation;
	tool?: StoryGraphTool;
}

interface StoredProjectWorkspace {
	activeWindowId?: string;
	editorDockLayout?: EditorDockLayout;
	editorWindows?: EditorWindowSpec[];
	graphOptions?: StoryGraphWorkspaceOptions;
	graphView?: StoryGraphWorkspaceView;
	mode?: StoryEditMode;
	scrollByMode?: Partial<Record<StoryEditMode, ScrollPosition>>;
	selectedPassageId?: string;
}

interface StoredWorkspace {
	bottomDrawerOpen?: boolean;
	leftDockCollapsed?: boolean;
	mode?: StoryEditMode;
	rightDockCollapsed?: boolean;
}

export interface StoryEditWorkspaceState {
	activeWindowId?: string;
	bottomDrawerOpen: boolean;
	editorDockLayout: EditorDockLayout;
	editorWindows?: EditorWindowSpec[];
	graphOptions: StoryGraphWorkspaceOptions;
	graphView?: StoryGraphWorkspaceView;
	leftDockCollapsed: boolean;
	mode: StoryEditMode;
	rightDockCollapsed: boolean;
	selectedPassageId?: string;
	setActiveWindowId: React.Dispatch<React.SetStateAction<string | undefined>>;
	setBottomDrawerOpen: (value: boolean) => void;
	setEditorDockLayout: (value: EditorDockLayout) => void;
	setEditorWindows: React.Dispatch<
		React.SetStateAction<EditorWindowSpec[] | undefined>
	>;
	setGraphOptions: React.Dispatch<
		React.SetStateAction<StoryGraphWorkspaceOptions>
	>;
	setGraphView: React.Dispatch<
		React.SetStateAction<StoryGraphWorkspaceView | undefined>
	>;
	setLeftDockCollapsed: (value: boolean) => void;
	setMode: (value: StoryEditMode) => void;
	setRightDockCollapsed: (value: boolean) => void;
	setSelectedPassageId: (value: string | undefined) => void;
}

const projectStorageKey = (storyId: string) =>
	`twine-story-edit-workspace-${storyId}`;
const workspaceStorageKey = 'twine-story-edit-workspace';

function isMode(value: unknown): value is StoryEditMode {
	return storyEditModes.includes(value as StoryEditMode);
}

function isGraphDensity(value: unknown): value is StoryGraphDensity {
	return storyGraphDensities.includes(value as StoryGraphDensity);
}

function isGraphOrientation(value: unknown): value is StoryGraphOrientation {
	return storyGraphOrientations.includes(value as StoryGraphOrientation);
}

function isGraphTool(value: unknown): value is StoryGraphTool {
	return storyGraphTools.includes(value as StoryGraphTool);
}

function isEditorDockLayout(value: unknown): value is EditorDockLayout {
	return editorDockLayouts.includes(value as EditorDockLayout);
}

function finiteNumber(value: unknown) {
	return typeof value === 'number' && Number.isFinite(value);
}

function readJson<T>(key: string, fallback: T): T {
	try {
		const serialized = window.localStorage.getItem(key);

		if (!serialized) {
			return fallback;
		}

		return JSON.parse(serialized);
	} catch (error) {
		console.warn(`Could not load ${key} from local storage`, error);
		return fallback;
	}
}

function writeJson<T>(key: string, value: T) {
	try {
		window.localStorage.setItem(key, JSON.stringify(value));
	} catch (error) {
		console.warn(`Could not save ${key} to local storage`, error);
	}
}

function editorWindowSpecFromValue(
	value: unknown
): EditorWindowSpec | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const candidate = value as Partial<EditorWindowSpec>;

	if (candidate.kind === 'script' || candidate.kind === 'stylesheet') {
		return {kind: candidate.kind};
	}

	if (
		candidate.kind === 'passage' &&
		typeof candidate.passageId === 'string' &&
		candidate.passageId.length > 0
	) {
		return {kind: 'passage', passageId: candidate.passageId};
	}
}

function graphViewFromValue(
	value: unknown
): StoryGraphWorkspaceView | undefined {
	if (!value || typeof value !== 'object') {
		return undefined;
	}

	const candidate = value as Partial<StoryGraphWorkspaceView>;

	if (
		finiteNumber(candidate.k) &&
		finiteNumber(candidate.x) &&
		finiteNumber(candidate.y) &&
		candidate.k! > 0
	) {
		return {k: candidate.k!, x: candidate.x!, y: candidate.y!};
	}
}

function graphOptionsFromValue(value: unknown): StoryGraphWorkspaceOptions {
	if (!value || typeof value !== 'object') {
		return {};
	}

	const candidate = value as StoryGraphWorkspaceOptions;
	const layers =
		candidate.layers && typeof candidate.layers === 'object'
			? {
					...(typeof candidate.layers.broken === 'boolean'
						? {broken: candidate.layers.broken}
						: {}),
					...(typeof candidate.layers.resolved === 'boolean'
						? {resolved: candidate.layers.resolved}
						: {}),
					...(typeof candidate.layers.selfLinks === 'boolean'
						? {selfLinks: candidate.layers.selfLinks}
						: {})
				}
			: undefined;

	return {
		...(isGraphDensity(candidate.density) ? {density: candidate.density} : {}),
		...(typeof candidate.focusSelection === 'boolean'
			? {focusSelection: candidate.focusSelection}
			: {}),
		...(layers && Object.keys(layers).length > 0 ? {layers} : {}),
		...(isGraphOrientation(candidate.orientation)
			? {orientation: candidate.orientation}
			: {}),
		...(isGraphTool(candidate.tool) ? {tool: candidate.tool} : {})
	};
}

function editorWindowsForStory(
	story: Story,
	value: unknown
): EditorWindowSpec[] | undefined {
	if (!Array.isArray(value)) {
		return undefined;
	}

	const passageIds = new Set(story.passages.map(passage => passage.id));
	const seen = new Set<string>();
	const windows: EditorWindowSpec[] = [];

	for (const item of value) {
		const spec = editorWindowSpecFromValue(item);

		if (!spec) {
			continue;
		}

		if (spec.kind === 'passage' && !passageIds.has(spec.passageId)) {
			continue;
		}

		const id = editorWindowId(spec);

		if (seen.has(id)) {
			continue;
		}

		seen.add(id);
		windows.push(spec);
	}

	return windows;
}

function activeWindowIdForWindows(
	value: unknown,
	windows: EditorWindowSpec[] | undefined
) {
	if (!windows || windows.length === 0) {
		return undefined;
	}

	const windowIds = windows.map(editorWindowId);

	return typeof value === 'string' && windowIds.includes(value)
		? value
		: windowIds[0];
}

function readProjectWorkspace(storyId: string): StoredProjectWorkspace {
	const workspace = readJson<StoredProjectWorkspace>(
		projectStorageKey(storyId),
		{}
	);

	return {
		...workspace,
		editorDockLayout: isEditorDockLayout(workspace.editorDockLayout)
			? workspace.editorDockLayout
			: undefined,
		graphOptions: graphOptionsFromValue(workspace.graphOptions),
		graphView: graphViewFromValue(workspace.graphView),
		mode: isMode(workspace.mode) ? workspace.mode : undefined
	};
}

export function readProjectWorkspaceForStory(
	story: Story
): StoredProjectWorkspace {
	const workspace = readProjectWorkspace(story.id);
	const editorWindows = editorWindowsForStory(story, workspace.editorWindows);

	return {
		...workspace,
		activeWindowId: activeWindowIdForWindows(
			workspace.activeWindowId,
			editorWindows
		),
		editorWindows
	};
}

function readWorkspace(): StoredWorkspace {
	const workspace = readJson<StoredWorkspace>(workspaceStorageKey, {});

	return {
		...workspace,
		mode: isMode(workspace.mode) ? workspace.mode : undefined
	};
}

function storyHasGraphLayout(story: Story) {
	return story.passages.some(
		passage =>
			passage.left !== 0 ||
			passage.top !== 0 ||
			passage.width !== 100 ||
			passage.height !== 100
	);
}

export function preferredModeForStory(story: Story): StoryEditMode {
	if (!storyHasGraphLayout(story)) {
		return 'text';
	}

	return 'graph';
}

function firstAvailablePassageId(story: Story, preferredId?: string) {
	const preferredPassage = story.passages.find(
		passage => passage.id === preferredId
	);

	if (preferredPassage?.selected) {
		return preferredPassage.id;
	}

	const selectedPassage = story.passages.find(passage => passage.selected);

	if (selectedPassage) {
		return selectedPassage.id;
	}

	if (preferredPassage) {
		return preferredPassage.id;
	}

	if (story.passages.some(passage => passage.id === story.startPassage)) {
		return story.startPassage;
	}

	return story.passages[0]?.id;
}

function graphOptionsEqual(
	left: StoryGraphWorkspaceOptions,
	right: StoryGraphWorkspaceOptions
) {
	return JSON.stringify(left) === JSON.stringify(right);
}

function graphViewEqual(
	left: StoryGraphWorkspaceView | undefined,
	right: StoryGraphWorkspaceView | undefined
) {
	return (
		left === right ||
		(!!left &&
			!!right &&
			left.k === right.k &&
			left.x === right.x &&
			left.y === right.y)
	);
}

export function initialModeForStory(
	story: Story,
	projectMode?: StoryEditMode,
	_workspaceMode?: StoryEditMode,
	preferredMode: StoryEditModePreference = 'auto',
	hasOpenEditorWindows = false
): StoryEditMode {
	if (preferredMode !== 'auto') {
		return preferredMode;
	}

	const storyPreferredMode = preferredModeForStory(story);

	if (storyPreferredMode === 'text') {
		return storyPreferredMode;
	}

	if (projectMode === 'split' && hasOpenEditorWindows) {
		return projectMode;
	}

	if (projectMode === 'text' || projectMode === 'graph') {
		return projectMode;
	}

	return storyPreferredMode;
}

export function setStoryEditScrollMemory(
	storyId: string,
	mode: StoryEditMode,
	position: ScrollPosition
) {
	const project = readProjectWorkspace(storyId);

	writeJson(projectStorageKey(storyId), {
		...project,
		scrollByMode: {
			...project.scrollByMode,
			[mode]: position
		}
	});
}

export function useStoryEditScrollMemory(
	storyId: string,
	mode: StoryEditMode,
	elementRef: React.RefObject<HTMLElement>
) {
	React.useLayoutEffect(() => {
		const element = elementRef.current;

		if (!element) {
			return;
		}

		const scrollTarget = element;
		const savedPosition = readProjectWorkspace(storyId).scrollByMode?.[mode];

		if (savedPosition) {
			window.requestAnimationFrame(() => scrollTarget.scrollTo(savedPosition));
		}

		function savePosition() {
			setStoryEditScrollMemory(storyId, mode, {
				left: scrollTarget.scrollLeft,
				top: scrollTarget.scrollTop
			});
		}

		scrollTarget.addEventListener('scroll', savePosition, {passive: true});

		return () => {
			scrollTarget.removeEventListener('scroll', savePosition);
			savePosition();
		};
	}, [elementRef, mode, storyId]);
}

export function useStoryEditWorkspace(story: Story): StoryEditWorkspaceState {
	const {prefs} = usePrefsContext();
	const initialProjectWorkspace = React.useMemo(
		() => readProjectWorkspaceForStory(story),
		[story.id]
	);
	const initialWorkspace = React.useMemo(readWorkspace, []);
	const [mode, setMode] = React.useState<StoryEditMode>(
		initialModeForStory(
			story,
			initialProjectWorkspace.mode,
			initialWorkspace.mode,
			prefs.preferredStoryEditMode,
			(initialProjectWorkspace.editorWindows?.length ?? 0) > 0
		)
	);
	const [selectedPassageId, setSelectedPassageId] = React.useState<
		string | undefined
	>(() =>
		firstAvailablePassageId(story, initialProjectWorkspace.selectedPassageId)
	);
	const [leftDockCollapsed, setLeftDockCollapsed] = React.useState(
		initialWorkspace.leftDockCollapsed ?? false
	);
	const [rightDockCollapsed, setRightDockCollapsed] = React.useState(
		initialWorkspace.rightDockCollapsed ?? false
	);
	const [bottomDrawerOpen, setBottomDrawerOpen] = React.useState(
		initialWorkspace.bottomDrawerOpen ?? false
	);
	const [editorDockLayout, setEditorDockLayout] =
		React.useState<EditorDockLayout>(
			() => initialProjectWorkspace.editorDockLayout ?? 'tile'
		);
	const [editorWindows, setEditorWindows] = React.useState<
		EditorWindowSpec[] | undefined
	>(() => initialProjectWorkspace.editorWindows);
	const [activeWindowId, setActiveWindowId] = React.useState<
		string | undefined
	>(() => initialProjectWorkspace.activeWindowId);
	const [graphView, setGraphViewState] = React.useState<
		StoryGraphWorkspaceView | undefined
	>(() => initialProjectWorkspace.graphView);
	const [graphOptions, setGraphOptionsState] =
		React.useState<StoryGraphWorkspaceOptions>(
			() => initialProjectWorkspace.graphOptions ?? {}
		);
	const setGraphOptions = React.useCallback<
		React.Dispatch<React.SetStateAction<StoryGraphWorkspaceOptions>>
	>(value => {
		setGraphOptionsState(current => {
			const next = typeof value === 'function' ? value(current) : value;

			return graphOptionsEqual(current, next) ? current : next;
		});
	}, []);
	const setGraphView = React.useCallback<
		React.Dispatch<React.SetStateAction<StoryGraphWorkspaceView | undefined>>
	>(value => {
		setGraphViewState(current => {
			const next = typeof value === 'function' ? value(current) : value;

			return graphViewEqual(current, next) ? current : next;
		});
	}, []);

	React.useEffect(() => {
		const projectWorkspace = readProjectWorkspaceForStory(story);
		const workspace = readWorkspace();

		setMode(
			initialModeForStory(
				story,
				projectWorkspace.mode,
				workspace.mode,
				prefs.preferredStoryEditMode,
				(projectWorkspace.editorWindows?.length ?? 0) > 0
			)
		);
		setSelectedPassageId(
			firstAvailablePassageId(story, projectWorkspace.selectedPassageId)
		);
		setEditorDockLayout(projectWorkspace.editorDockLayout ?? 'tile');
		setEditorWindows(projectWorkspace.editorWindows);
		setActiveWindowId(projectWorkspace.activeWindowId);
		setGraphViewState(projectWorkspace.graphView);
		setGraphOptionsState(projectWorkspace.graphOptions ?? {});
	}, [prefs.preferredStoryEditMode, story.id]);

	React.useEffect(() => {
		setSelectedPassageId(current => firstAvailablePassageId(story, current));
	}, [story]);

	React.useEffect(() => {
		setEditorWindows(current => editorWindowsForStory(story, current));
	}, [story]);

	React.useEffect(() => {
		setActiveWindowId(current =>
			activeWindowIdForWindows(current, editorWindows)
		);
	}, [editorWindows]);

	React.useEffect(() => {
		const projectWorkspace = readProjectWorkspace(story.id);

		writeJson(projectStorageKey(story.id), {
			...projectWorkspace,
			activeWindowId,
			editorDockLayout,
			editorWindows,
			graphOptions,
			graphView,
			mode,
			selectedPassageId
		});
	}, [
		activeWindowId,
		editorDockLayout,
		editorWindows,
		graphOptions,
		graphView,
		mode,
		selectedPassageId,
		story.id
	]);

	React.useEffect(() => {
		const workspace = readWorkspace();

		writeJson(workspaceStorageKey, {
			...workspace,
			bottomDrawerOpen,
			leftDockCollapsed,
			mode,
			rightDockCollapsed
		});
	}, [bottomDrawerOpen, leftDockCollapsed, mode, rightDockCollapsed]);

	return {
		activeWindowId,
		bottomDrawerOpen,
		editorDockLayout,
		editorWindows,
		graphOptions,
		graphView,
		leftDockCollapsed,
		mode,
		rightDockCollapsed,
		selectedPassageId,
		setActiveWindowId,
		setBottomDrawerOpen,
		setEditorDockLayout,
		setEditorWindows,
		setGraphOptions,
		setGraphView,
		setLeftDockCollapsed,
		setMode,
		setRightDockCollapsed,
		setSelectedPassageId
	};
}
