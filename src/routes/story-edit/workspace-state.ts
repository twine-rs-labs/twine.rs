import * as React from 'react';
import {usePrefsContext} from '../../store/prefs';
import type {StoryEditModePreference} from '../../store/prefs';
import {Story} from '../../store/stories';

export const storyEditModes = ['text', 'graph', 'split'] as const;

export type StoryEditMode = (typeof storyEditModes)[number];

interface ScrollPosition {
	left: number;
	top: number;
}

interface StoredProjectWorkspace {
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
	bottomDrawerOpen: boolean;
	leftDockCollapsed: boolean;
	mode: StoryEditMode;
	rightDockCollapsed: boolean;
	selectedPassageId?: string;
	setBottomDrawerOpen: (value: boolean) => void;
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

function readProjectWorkspace(storyId: string): StoredProjectWorkspace {
	const workspace = readJson<StoredProjectWorkspace>(
		projectStorageKey(storyId),
		{}
	);

	return {
		...workspace,
		mode: isMode(workspace.mode) ? workspace.mode : undefined
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

function storyHasSourceText(story: Story) {
	return story.passages.some(passage => passage.text.trim() !== '');
}

export function preferredModeForStory(story: Story): StoryEditMode {
	if (!storyHasGraphLayout(story)) {
		return 'text';
	}

	if (story.passages.length > 1 && storyHasSourceText(story)) {
		return 'split';
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

export function initialModeForStory(
	story: Story,
	projectMode?: StoryEditMode,
	workspaceMode?: StoryEditMode,
	preferredMode: StoryEditModePreference = 'auto'
): StoryEditMode {
	if (projectMode) {
		return projectMode;
	}

	if (preferredMode !== 'auto') {
		return preferredMode;
	}

	const storyPreferredMode = preferredModeForStory(story);

	if (storyPreferredMode === 'text') {
		return storyPreferredMode;
	}

	return workspaceMode ?? storyPreferredMode;
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
		() => readProjectWorkspace(story.id),
		[story.id]
	);
	const initialWorkspace = React.useMemo(readWorkspace, []);
	const [mode, setMode] = React.useState<StoryEditMode>(
		initialModeForStory(
			story,
			initialProjectWorkspace.mode,
			initialWorkspace.mode,
			prefs.preferredStoryEditMode
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

	React.useEffect(() => {
		const projectWorkspace = readProjectWorkspace(story.id);
		const workspace = readWorkspace();

		setMode(
			initialModeForStory(
				story,
				projectWorkspace.mode,
				workspace.mode,
				prefs.preferredStoryEditMode
			)
		);
		setSelectedPassageId(
			firstAvailablePassageId(story, projectWorkspace.selectedPassageId)
		);
	}, [prefs.preferredStoryEditMode, story.id]);

	React.useEffect(() => {
		setSelectedPassageId(current => firstAvailablePassageId(story, current));
	}, [story]);

	React.useEffect(() => {
		const projectWorkspace = readProjectWorkspace(story.id);

		writeJson(projectStorageKey(story.id), {
			...projectWorkspace,
			mode,
			selectedPassageId
		});
	}, [mode, selectedPassageId, story.id]);

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
		bottomDrawerOpen,
		leftDockCollapsed,
		mode,
		rightDockCollapsed,
		selectedPassageId,
		setBottomDrawerOpen,
		setLeftDockCollapsed,
		setMode,
		setRightDockCollapsed,
		setSelectedPassageId
	};
}
