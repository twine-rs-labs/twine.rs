import {contextBridge, ipcRenderer} from 'electron';
import type {
	NativeStoryPreviewAppearanceUpdate,
	NativeStoryPreviewClearStateOperation,
	NativeStoryPreviewCommand,
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewReplacementResult
} from '../shared';
import type {NativeStoryPreviewBridge} from '../preview-ipc-channels';

// Sandboxed Electron preloads can load Electron and a small built-in module
// subset only. Keep runtime channel values self-contained here; the adjacent
// contract test compares every use with the main-process channel constants.
const storyPreviewBridgeName = 'twineStoryPreview';
const storyPreviewIpcChannels = Object.freeze({
	appearance: 'story-preview:appearance',
	beginClearState: 'story-preview:begin-clear-state',
	cancelClearState: 'story-preview:cancel-clear-state',
	command: 'story-preview:command',
	commandResult: 'story-preview:command-result',
	completeClearState: 'story-preview:complete-clear-state',
	copyText: 'story-preview:copy-text',
	frameLoaded: 'story-preview:frame-loaded',
	getInitialState: 'story-preview:get-initial-state',
	ready: 'story-preview:ready',
	replacement: 'story-preview:replacement'
});

const maxPassageIdLength = 1024;
const maxCopyTextLength = 4 * 1024 * 1024;
const maxOperationIdLength = 128;
const maxRequestIdLength = 128;

function validGeneration(value: unknown): value is number {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function validPassageId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= maxPassageIdLength
	);
}

function validRequestId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= maxRequestIdLength
	);
}

function copyCommand(value: unknown): NativeStoryPreviewCommand {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid story preview command.');
	}

	const command = value as Partial<NativeStoryPreviewCommand>;

	if (!validGeneration(command.generation)) {
		throw new TypeError('Invalid story preview generation.');
	}
	if (!validRequestId(command.requestId)) {
		throw new TypeError('Invalid story preview request.');
	}
	const request = {requestId: command.requestId};

	switch (command.type) {
		case 'revealGraph':
		case 'revealSource':
			if (
				command.passageId !== undefined &&
				!validPassageId(command.passageId)
			) {
				throw new TypeError('Invalid story preview passage.');
			}

			return {
				generation: command.generation,
				...request,
				...(command.passageId === undefined
					? {}
					: {passageId: command.passageId}),
				type: command.type
			};
		case 'testFromStart':
			return {generation: command.generation, ...request, type: command.type};
		case 'testCurrent':
			if (!validPassageId(command.passageId)) {
				throw new TypeError('Invalid story preview passage.');
			}

			return {
				generation: command.generation,
				...request,
				passageId: command.passageId,
				type: command.type
			};
		default:
			throw new TypeError('Invalid story preview command.');
	}
}

function validGenerationValue(generation: unknown) {
	if (!validGeneration(generation)) {
		throw new TypeError('Invalid story preview generation.');
	}
}

function copyClearStateOperation(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new TypeError('Invalid Clear State operation.');
	}

	const operation = value as Partial<NativeStoryPreviewClearStateOperation>;

	if (
		!validGeneration(operation.generation) ||
		typeof operation.operationId !== 'string' ||
		operation.operationId.length === 0 ||
		operation.operationId.length > maxOperationIdLength
	) {
		throw new TypeError('Invalid Clear State operation.');
	}

	return {
		generation: operation.generation,
		operationId: operation.operationId
	};
}

function subscribe<T>(channel: string, callback: (value: T) => void) {
	if (typeof callback !== 'function') {
		throw new TypeError('A story preview listener must be a function.');
	}

	const listener = (_event: unknown, value: T) => callback(value);

	ipcRenderer.on(channel, listener);
	return () => ipcRenderer.removeListener(channel, listener);
}

const bridge: NativeStoryPreviewBridge = {
	beginClearState(generation) {
		validGenerationValue(generation);
		return ipcRenderer.invoke(
			storyPreviewIpcChannels.beginClearState,
			generation
		);
	},
	cancelClearState(operation) {
		return ipcRenderer.invoke(
			storyPreviewIpcChannels.cancelClearState,
			copyClearStateOperation(operation)
		);
	},
	completeClearState(operation) {
		return ipcRenderer.invoke(
			storyPreviewIpcChannels.completeClearState,
			copyClearStateOperation(operation)
		);
	},
	copyText(text) {
		if (
			typeof text !== 'string' ||
			text.length === 0 ||
			text.length > maxCopyTextLength
		) {
			return Promise.reject(new TypeError('Invalid runtime log text.'));
		}
		return ipcRenderer.invoke(storyPreviewIpcChannels.copyText, text);
	},
	command(command) {
		return ipcRenderer.invoke(
			storyPreviewIpcChannels.command,
			copyCommand(command)
		);
	},
	frameLoaded(generation) {
		validGenerationValue(generation);
		return ipcRenderer.invoke(storyPreviewIpcChannels.frameLoaded, generation);
	},
	getInitialState() {
		return ipcRenderer.invoke(storyPreviewIpcChannels.getInitialState);
	},
	onAppearance(callback) {
		return subscribe<NativeStoryPreviewAppearanceUpdate>(
			storyPreviewIpcChannels.appearance,
			callback
		);
	},
	onCommandResult(callback) {
		return subscribe<NativeStoryPreviewCommandResult>(
			storyPreviewIpcChannels.commandResult,
			callback
		);
	},
	onReplacement(callback) {
		return subscribe<NativeStoryPreviewReplacementResult>(
			storyPreviewIpcChannels.replacement,
			callback
		);
	},
	ready(generation) {
		validGenerationValue(generation);
		ipcRenderer.send(storyPreviewIpcChannels.ready, generation);
	}
};

// The manager also disables preload execution in child frames. Keep this
// defense here so a future BrowserWindow option change cannot expose the API to
// story content.
if (process.isMainFrame !== false) {
	contextBridge.exposeInMainWorld(storyPreviewBridgeName, bridge);
}
