import type {
	NativeStoryPreviewAppearanceUpdate,
	NativeStoryPreviewCommand,
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewDescriptor,
	NativeStoryPreviewReplacementResult
} from './shared';

export const storyPreviewBridgeName = 'twineStoryPreview';

export const storyPreviewIpcChannels = Object.freeze({
	appearance: 'story-preview:appearance',
	command: 'story-preview:command',
	commandResult: 'story-preview:command-result',
	frameLoaded: 'story-preview:frame-loaded',
	getInitialState: 'story-preview:get-initial-state',
	ownerCommand: 'story-preview:owner-command',
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
