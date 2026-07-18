import type {CompletionSource} from '@codemirror/autocomplete';
import type {Extension} from '@codemirror/state';
import type {StoryFormatEditorPreferences} from '../../../store/prefs';
import type * as React from 'react';

export interface NativeEditorDialect {
	family: string;
	id: string;
	version: string;
}

export interface NativeEditorSessionContext {
	passageNames: readonly string[];
	preferences: StoryFormatEditorPreferences;
	tagNames: readonly string[];
}

export interface NativeEditorFindOptions {
	matchCase: boolean;
	query: string;
	scope: 'code' | 'everywhere' | 'prose' | 'selection';
	useRegExp: boolean;
}

export interface NativeEditorFindResult {
	count: number;
	index: number;
	invalidPattern?: boolean;
}

export interface NativeEditorController {
	clearFind: () => void;
	find: (options: NativeEditorFindOptions) => NativeEditorFindResult;
	getFindResult: () => NativeEditorFindResult;
	findNext: (direction: -1 | 1) => NativeEditorFindResult;
	proofreading: boolean;
	replaceAll: (replacement: string) => NativeEditorFindResult;
	replaceCurrent: (replacement: string) => NativeEditorFindResult;
	requestPanel: (panel: 'find') => void;
	setProofreading: (enabled: boolean) => void;
	subscribe: (listener: () => void) => () => void;
	takeRequestedPanel: () => 'find' | undefined;
}

export interface NativeEditorHost {
	applyEdits: (
		edits: Array<{from: number; insert: string; to: number}>,
		selections?: Array<{anchor: number; head: number}>,
		mainSelectionIndex?: number
	) => void;
	focus: () => void;
	getSnapshot: () => {
		document: string;
		mainSelectionIndex: number;
		selections: Array<{anchor: number; head: number}>;
	};
}

export interface NativeEditorToolbarProps {
	controller: NativeEditorController;
	editor: NativeEditorHost;
	onChangePreferences: (preferences: StoryFormatEditorPreferences) => void;
	preferences: StoryFormatEditorPreferences;
}

export interface NativeEditorSession {
	Toolbar?: React.ComponentType<NativeEditorToolbarProps>;
	completionSources?: readonly CompletionSource[];
	controller: NativeEditorController;
	dispose?: () => void;
	extensions: readonly Extension[];
	key: string;
	ownsSyntax: boolean;
	useCodeFont: boolean;
}

export interface NativeEditorProvider {
	createSession: (context: NativeEditorSessionContext) => NativeEditorSession;
	dialect: NativeEditorDialect;
}

export interface NativeEditorProviderModule {
	default: NativeEditorProvider;
}

export type NativeEditorProviderLoader =
	() => Promise<NativeEditorProviderModule>;
