import type * as React from 'react';
import type {WorkbenchSelection} from '../../core';
import type {CoreProjectHost} from '../../core/project-host';
import type {Passage, Story} from '../../store/stories';
import type {EditorWindowSpec} from './editor-window-spec';

/**
 * Bounded state exposed to workbench-native inspector and drawer extensions.
 * Persisted changes must still be submitted through `host`; the remaining
 * callbacks change transient workbench selection or launch a preview.
 */
export interface StoryWorkbenchExtensionContext {
	host: CoreProjectHost;
	onHighlightPassages?: (passageIds: string[]) => void;
	onOpenEditorWindow?: (spec: EditorWindowSpec) => void;
	onRevealPassageInGraph: (passage: Passage) => void;
	onSelectPassage: (passage: Passage) => void;
	onTestPassage?: (passage: Passage) => void;
	selection: WorkbenchSelection;
	story: Story;
}

export interface StoryWorkbenchInspectorExtension {
	id: string;
	render: (context: StoryWorkbenchExtensionContext) => React.ReactNode;
}

export interface StoryWorkbenchBottomDrawerPanel {
	icon: string;
	id: string;
	render: (context: StoryWorkbenchExtensionContext) => React.ReactNode;
	title: string;
}
