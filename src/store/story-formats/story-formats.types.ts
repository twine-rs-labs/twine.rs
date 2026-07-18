import type {StoryFormatHydrationDiagnostic} from '../../util/story-format/hydrate-properties';
import type {
	LegacyEditorFacade,
	ReadOnlyLegacyEditorFacade
} from '../../util/story-format/legacy-editor/legacy-editor-facade';
import type {LegacyStreamModeFactory} from '../../util/story-format/legacy-editor/legacy-stream-mode';
import {ThunkDispatch} from '../../util/use-thunk-reducer';

interface BaseStoryFormat {
	editorIntegrationDiagnostic?: StoryFormatHydrationDiagnostic;
	id: string;
	loadState: 'unloaded' | 'loading' | 'loaded' | 'error';
	name: string;
	url: string;
	userAdded: boolean;
	version: string;
}

/**
 * States for a story format.
 */
export type StoryFormat =
	| (BaseStoryFormat & {loadState: 'unloaded'})
	| (BaseStoryFormat & {loadState: 'loading'})
	| (BaseStoryFormat & {loadState: 'error'; loadError: Error})
	| (BaseStoryFormat & {
			loadState: 'loaded';
			properties: StoryFormatProperties;
	  });

export type StoryFormatToolbarButton = {
	type: 'button';
	command: string;
	disabled?: boolean;
	icon: string;
	iconOnly?: boolean;
	label: string;
};

export type StoryFormatToolbarMenuItem =
	Omit<StoryFormatToolbarButton, 'icon'> | {type: 'separator'};

export type StoryFormatToolbarItem =
	| StoryFormatToolbarButton
	| {
			type: 'menu';
			disabled: boolean;
			icon: string;
			iconOnly?: boolean;
			items: StoryFormatToolbarMenuItem[];
			label: string;
	  };

export interface StoryFormatToolbarFactoryEnvironment {
	appTheme: 'dark' | 'light';
	foregroundColor: string;
	locale: string;
}

export type StoryFormatToolbarFactory = (
	editor: ReadOnlyLegacyEditorFacade,
	environment: StoryFormatToolbarFactoryEnvironment
) => StoryFormatToolbarItem[];

export type StoryFormatModuleSlot =
	'runtime' | 'preview' | 'editor' | 'diagnostics' | 'devtools';

export interface StoryFormatDeclaredModule {
	id: string;
	includeInPublish?: boolean;
	lazy?: boolean;
	slot: StoryFormatModuleSlot;
	url?: string;
}

export interface StoryFormatCapabilityDeclarations {
	autocomplete?: boolean;
	devOnlyTools?: boolean;
	devtoolsPanels?: boolean;
	diagnostics?: boolean;
	docs?: boolean;
	editorToolbarActions?: boolean;
	exporter?: boolean;
	lazyLoadedModules?: boolean;
	menuItems?: boolean;
	migration?: boolean;
	parser?: boolean;
	preprocessing?: boolean;
	statistics?: boolean;
	syntax?: boolean;
}

export interface StoryFormatPublishPolicy {
	allowDevMarkersInRuntime?: boolean;
	excludeFromPublish?: string[];
	includeInPublish?: string[];
}

export interface StoryFormatDevelopmentOptions {
	devServerUrl?: string;
	hmr?: boolean;
	localFolderPath?: string;
	sourceMapUrl?: string;
}

export interface TwineRsStoryFormatMetadata {
	capabilities?: StoryFormatCapabilityDeclarations;
	development?: StoryFormatDevelopmentOptions;
	modules?: StoryFormatDeclaredModule[];
	publish?: StoryFormatPublishPolicy;
}

/**
 * Properties available once a story format is loaded. Note that some there is
 * some overlap between this and StoryFormat--this is so that we know certain
 * things, mainly the format name and version, before loading.
 * @see
 * https://github.com/iftechfoundation/twine-specs/blob/master/twine-2-storyformats-spec.md
 */
export interface StoryFormatProperties {
	author?: string;
	description?: string;
	editorExtensions?: {
		twine?: {
			[semverSpec: string]: {
				codeMirror?: {
					commands?: Record<string, (editor: LegacyEditorFacade) => void>;
					mode?: LegacyStreamModeFactory<unknown>;
					toolbar?: StoryFormatToolbarFactory;
				};
				references?: {
					parsePassageText?: (text: string) => string[];
				};
			};
		};
	};
	hydrate?: string;
	image?: string;
	license?: string;
	name: string;
	proofing?: boolean;
	source: string;
	twineRs?: TwineRsStoryFormatMetadata;
	url?: string;
	version: string;
}

export type StoryFormatsState = StoryFormat[];

export type StoryFormatsAction =
	| {type: 'init'; state: StoryFormat[]}
	| {type: 'repair'}
	| {
			type: 'create';
			props: Omit<StoryFormat, 'id' | 'loadState' | 'properties'>;
	  }
	| {type: 'delete'; id: string}
	| {type: 'update'; id: string; props: Partial<StoryFormat>};

export type StoryFormatsDispatch = ThunkDispatch<
	StoryFormatsState,
	StoryFormatsAction
>;

export interface StoryFormatsContextProps {
	dispatch: StoryFormatsDispatch;
	formats: StoryFormatsState;
}
