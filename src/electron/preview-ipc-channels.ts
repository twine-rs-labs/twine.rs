import type {
	NativeStoryPreviewAppearanceUpdate,
	NativeStoryPreviewClearStateOperation,
	NativeStoryPreviewCommand,
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewDescriptor,
	NativeStoryPreviewReplacementResult
} from './shared';

export const storyPreviewBridgeName = 'twineStoryPreview';

export const storyPreviewIpcChannels = Object.freeze({
	appearance: 'story-preview:appearance',
	beginClearState: 'story-preview:begin-clear-state',
	cancelClearState: 'story-preview:cancel-clear-state',
	command: 'story-preview:command',
	commandResult: 'story-preview:command-result',
	copyText: 'story-preview:copy-text',
	completeClearState: 'story-preview:complete-clear-state',
	frameLoaded: 'story-preview:frame-loaded',
	getInitialState: 'story-preview:get-initial-state',
	ownerCommand: 'story-preview:owner-command',
	ownerCommandCancellation: 'story-preview:owner-command-cancellation',
	ready: 'story-preview:ready',
	replacement: 'story-preview:replacement'
});

export interface NativeStoryPreviewInitialState {
	descriptor: NativeStoryPreviewDescriptor;
	url: string;
}

/**
 * The complete API exposed to the dedicated preview renderer. It intentionally
 * has no project, filesystem, settings, or raw IPC capabilities.
 */
export interface NativeStoryPreviewBridge {
	beginClearState(
		generation: number
	): Promise<NativeStoryPreviewClearStateOperation>;
	cancelClearState(
		operation: NativeStoryPreviewClearStateOperation
	): Promise<void>;
	completeClearState(
		operation: NativeStoryPreviewClearStateOperation
	): Promise<void>;
	copyText(text: string): Promise<void>;
	command(
		command: NativeStoryPreviewCommand
	): Promise<NativeStoryPreviewCommandResult>;
	frameLoaded(generation: number): Promise<void>;
	getInitialState(): Promise<NativeStoryPreviewInitialState>;
	onAppearance(
		callback: (update: NativeStoryPreviewAppearanceUpdate) => void
	): () => void;
	onCommandResult(
		callback: (result: NativeStoryPreviewCommandResult) => void
	): () => void;
	onReplacement(
		callback: (result: NativeStoryPreviewReplacementResult) => void
	): () => void;
	ready(generation: number): void;
}
