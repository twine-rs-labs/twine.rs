import {Color} from '../../util/color';
import {StoryFormat} from '../story-formats';

export type GraphCardSizePreference =
	| 'large'
	| 'medium'
	| 'narrow'
	| 'small'
	| 'tall'
	| 'wide';

export type StoryEditModePreference = 'auto' | 'graph' | 'split' | 'text';

export type PrefsAction =
	| {type: 'init'; state: Partial<PrefsState>}
	| {
			type: 'update';
			name: keyof PrefsState;
			value:
				| boolean
				| number
				| string
				| string[]
				| {name: string; version: string}
				| {name: string; version: string}[]
				| Record<string, Color>;
	  }
	| {type: 'repair'; allFormats: StoryFormat[]};

export interface PrefsState {
	/**
	 * What theme to use for the application.
	 */
	appTheme: 'dark' | 'light' | 'system';
	/**
	 * Font family for the story JS and stylesheet editor.
	 */
	codeEditorFontFamily: string;
	/**
	 * Font scale (1 being 100%) for the story JS and stylesheet editor.
	 */
	codeEditorFontScale: number;
	/**
	 * Width of side dialogs in pixels.
	 */
	dialogWidth: number;
	/**
	 * Story formats whose editor extensions should not be enabled.
	 */
	disabledStoryFormatEditorExtensions: {
		name: string;
		version: string;
	}[];
	/**
	 * Has the donation prompt been shown?
	 */
	donateShown: boolean;
	/**
	 * Whether the cursor should blink in editor fields (passages, story JS, story
	 * stylesheet).
	 */
	editorCursorBlinks: boolean;
	/**
	 * Default folder path for newly created project folders.
	 */
	defaultProjectFolder: string;
	/**
	 * Default folder path for asset imports.
	 */
	defaultAssetFolder: string;
	/**
	 * Default graph card size for newly-created passages and graph resize presets.
	 */
	graphDefaultCardSize: GraphCardSizePreference;
	/**
	 * Whether generated graph layouts should be treated as explicit save candidates.
	 */
	graphGeneratedLayoutSavePrompt: boolean;
	/**
	 * Timestamp when the app was first run.
	 */
	firstRunTime: number;
	/**
	 * Prefer a stronger app contrast treatment where supported by DS screens.
	 */
	highContrast: boolean;
	/**
	 * Keyboard shortcut profile for workbench/editor commands.
	 */
	keybindingPreset: 'default' | 'emacs' | 'vim';
	/**
	 * Last version number seen during an update check.
	 */
	lastUpdateSeen: string;
	/**
	 * Timestamp when the last update check occurred.
	 */
	lastUpdateCheckTime: number;
	/**
	 * User-set locale code.
	 */
	locale: string;
	/**
	 * Font family for the passage editor.
	 */
	passageEditorFontFamily: string;
	/**
	 * Font scale (1 being 100%) for the passage editor.
	 */
	passageEditorFontScale: number;
	/**
	 * Whether to show just tag colors (thin colored stripes; ignore tags without
	 * colors) or tag names (list all tags, even uncolored tags) of tags on passage
	 * cards in the story map.
	 */
	passageTagDisplay: 'color' | 'name';
	/**
	 * Preferred initial story editor mode. Auto preserves per-story/project logic.
	 */
	preferredStoryEditMode: StoryEditModePreference;
	/**
	 * Reduce nonessential UI motion.
	 */
	reducedMotion: boolean;
	/**
	 * Name and version of the selected proofing format.
	 */
	proofingFormat: {
		name: string;
		version: string;
	};
	/**
	 * Name and version of the default story format.
	 */
	storyFormat: {
		name: string;
		version: string;
	};
	/**
	 * Which story formats to show in the list route. This does not affect story
	 * formats shown when setting it on a story.
	 */
	storyFormatListFilter: 'current' | 'all' | 'user';
	/**
	 * How the story list should be sorted.
	 */
	storyListSort: 'date' | 'name';
	/**
	 * What tags the story list should show. This is additive, e.g. acts as
	 * logical OR, and an empty array equates to showing all stories.
	 */
	storyListTagFilter: string[];
	/**
	 * Colors for story tags.
	 */
	storyTagColors: Record<string, Color>;
	/**
	 * Use CodeMirror for text editing?
	 */
	useCodeMirror: boolean;
	/**
	 * Has the user been shown the welcome route?
	 */
	welcomeSeen: boolean;
}

export type PrefsDispatch = React.Dispatch<PrefsAction>;

export interface PrefsContextProps {
	dispatch: PrefsDispatch;
	prefs: PrefsState;
}
