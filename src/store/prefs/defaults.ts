import {PrefsState} from './prefs.types';

export const defaults = (): PrefsState => ({
	appTheme: 'system',
	codeEditorFontFamily: 'var(--font-mono)',
	codeEditorFontScale: 1,
	codeEditorTheme: 'twine',
	dialogWidth: 600,
	disabledStoryFormatEditorExtensions: [],
	donateShown: false,
	editorCursorBlinks: true,
	editorFocusPreference: 'restore',
	defaultAssetFolder: '',
	defaultProjectFolder: '',
	firstRunTime: new Date().getTime(),
	graphDefaultCardSize: 'twine',
	graphGeneratedLayoutSavePrompt: true,
	graphRightClickCreatePassage: true,
	highContrast: false,
	keybindingPreset: 'default',
	keyboardOnlyEditing: true,
	lastUpdateSeen: '',
	lastUpdateCheckTime: new Date().getTime(),
	locale:
		(window.navigator as any).userLanguage ||
		window.navigator.language ||
		(window.navigator as any).browserLanguage ||
		(window.navigator as any).systemLanguage ||
		'en-us',
	passageEditorFontFamily: 'var(--font-ui)',
	passageEditorFontScale: 1,
	passageTagDisplay: 'color',
	preferredStoryEditMode: 'auto',
	reducedMotion: false,
	cloudSaveIntegration: 'off',
	proofingFormat: {
		name: 'Paperthin',
		version: '1.0.0'
	},
	storyFormat: {
		name: 'Harlowe',
		version: '3.3.9'
	},
	revisionControlIntegration: 'manual',
	shareLinkMode: 'local-file',
	hostingPublishIntegration: 'manual',
	storyFormatListFilter: 'current',
	storyListSort: 'name',
	storyListTagFilter: [],
	storyTagColors: {},
	welcomeSeen: false
});
