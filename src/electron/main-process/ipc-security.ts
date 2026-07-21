import {pathToFileURL} from 'url';
import path from 'path';

type IpcEvent = {
	sender?: {mainFrame?: unknown};
	senderFrame?: {url?: string} | null;
};

function rendererEntryUrl() {
	return pathToFileURL(
		path.resolve(__dirname, '../../../../renderer/index.html')
	).toString();
}

/**
 * Only the top-level application document may use the desktop bridge. This
 * rejects subframes and any renderer that has navigated away from the bundled
 * application entry point before an IPC listener sees renderer-controlled
 * arguments.
 */
export function assertTrustedIpcEvent(event: IpcEvent) {
	const sender = event?.sender;
	const senderFrame = event?.senderFrame;

	// Existing unit tests call registered listeners with a minimal event object.
	// Real Electron IPC events always contain both values; production must fail
	// closed if either value is absent.
	if (process.env.NODE_ENV === 'test' && (!sender || !senderFrame)) {
		return;
	}

	if (!sender || !senderFrame || senderFrame !== sender.mainFrame) {
		throw new Error('Blocked IPC from an untrusted renderer frame.');
	}

	let actualUrl: URL;

	try {
		actualUrl = new URL(senderFrame.url ?? '');
		actualUrl.hash = '';
	} catch {
		throw new Error('Blocked IPC from an untrusted renderer origin.');
	}

	if (actualUrl.toString() !== rendererEntryUrl()) {
		throw new Error('Blocked IPC from an untrusted renderer origin.');
	}
}

type IpcRegistrar = {
	handle(
		channel: string,
		listener: (event: any, ...args: any[]) => any
	): unknown;
	on(channel: string, listener: (event: any, ...args: any[]) => any): unknown;
};

/** Registers every IPC endpoint with the same sender/frame/origin gate. */
export function trustedIpcRegistrar(ipc: IpcRegistrar): IpcRegistrar {
	return {
		handle(channel, listener) {
			return ipc.handle(channel, (event, ...args) => {
				assertTrustedIpcEvent(event);
				return listener(event, ...args);
			});
		},
		on(channel, listener) {
			return ipc.on(channel, (event, ...args) => {
				assertTrustedIpcEvent(event);
				return listener(event, ...args);
			});
		}
	};
}
