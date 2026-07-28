import path from 'path';
import {pathToFileURL} from 'url';

type PreviewIpcEvent = {
	sender?: {mainFrame?: unknown};
	senderFrame?: {url?: string} | null;
};

export function previewRendererEntryUrl() {
	return pathToFileURL(
		path.resolve(__dirname, '../../../../renderer/story-preview.html')
	).toString();
}

/**
 * Only the top-level dedicated preview document may use preview IPC. This gate
 * deliberately remains separate from the application renderer gate so adding a
 * preview endpoint can never make the general project bridge callable here.
 */
export function assertPreviewIpcEvent(
	event: PreviewIpcEvent,
	expectedUrl = previewRendererEntryUrl()
) {
	const sender = event?.sender;
	const senderFrame = event?.senderFrame;

	if (!sender || !senderFrame || senderFrame !== sender.mainFrame) {
		throw new Error('Blocked preview IPC from an untrusted renderer frame.');
	}

	let actualUrl: URL;
	let trustedUrl: URL;

	try {
		actualUrl = new URL(senderFrame.url ?? '');
		trustedUrl = new URL(expectedUrl);
		actualUrl.hash = '';
		trustedUrl.hash = '';
	} catch {
		throw new Error('Blocked preview IPC from an untrusted renderer origin.');
	}

	if (actualUrl.toString() !== trustedUrl.toString()) {
		throw new Error('Blocked preview IPC from an untrusted renderer origin.');
	}
}

type IpcRegistrar = {
	handle(
		channel: string,
		listener: (event: any, ...args: any[]) => any
	): unknown;
	on(channel: string, listener: (event: any, ...args: any[]) => any): unknown;
};

/** Registers preview-only endpoints with the dedicated preview entry gate. */
export function previewIpcRegistrar(
	ipc: IpcRegistrar,
	expectedUrl = previewRendererEntryUrl()
): IpcRegistrar {
	return {
		handle(channel, listener) {
			return ipc.handle(channel, (event, ...args) => {
				assertPreviewIpcEvent(event, expectedUrl);
				return listener(event, ...args);
			});
		},
		on(channel, listener) {
			return ipc.on(channel, (event, ...args) => {
				assertPreviewIpcEvent(event, expectedUrl);
				return listener(event, ...args);
			});
		}
	};
}
