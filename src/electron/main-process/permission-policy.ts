import type {Session, WebContents} from 'electron';

const supportedMainFramePermissions = new Set(['clipboard-sanitized-write']);

function permitsTrustedMainFrame(
	trustedWebContents: WebContents,
	trustedRendererUrl: string,
	requestingWebContents: WebContents | null,
	permission: string,
	isMainFrame: boolean,
	requestingUrl?: string
) {
	let isTrustedDocument = false;

	try {
		const trusted = new URL(trustedRendererUrl);
		const requesting = new URL(requestingUrl ?? '');

		isTrustedDocument =
			requesting.protocol === trusted.protocol &&
			requesting.host === trusted.host &&
			requesting.pathname === trusted.pathname;
	} catch {
		isTrustedDocument = false;
	}

	return (
		requestingWebContents === trustedWebContents &&
		isMainFrame &&
		isTrustedDocument &&
		supportedMainFramePermissions.has(permission)
	);
}

/**
 * Installs the complete Electron permission policy for the application session.
 * The main renderer may write sanitized clipboard text; every other web or device
 * permission is denied, including requests made by embedded story content.
 */
export function installPermissionPolicy(
	targetSession: Session,
	trustedWebContents: WebContents,
	trustedRendererUrl: string
) {
	targetSession.setPermissionCheckHandler(
		(requestingWebContents, permission, _requestingOrigin, details) =>
			permitsTrustedMainFrame(
				trustedWebContents,
				trustedRendererUrl,
				requestingWebContents,
				permission,
				details.isMainFrame,
				details.requestingUrl
			)
	);
	targetSession.setPermissionRequestHandler(
		(requestingWebContents, permission, callback, details) => {
			callback(
				permitsTrustedMainFrame(
					trustedWebContents,
					trustedRendererUrl,
					requestingWebContents,
					permission,
					details.isMainFrame,
					details.requestingUrl
				)
			);
		}
	);
	targetSession.setDevicePermissionHandler(() => false);
	targetSession.setDisplayMediaRequestHandler((_request, callback) =>
		callback({})
	);
	targetSession.setBluetoothPairingHandler((_details, callback) =>
		callback({confirmed: false})
	);

	targetSession.on('select-hid-device', (event, _details, callback) => {
		event.preventDefault();
		callback();
	});
	targetSession.on(
		'select-serial-port',
		(event, _ports, _webContents, callback) => {
			event.preventDefault();
			callback('');
		}
	);
	targetSession.on('select-usb-device', (event, _details, callback) => {
		event.preventDefault();
		callback();
	});
	trustedWebContents.on(
		'select-bluetooth-device',
		(event, _devices, callback) => {
			event.preventDefault();
			callback('');
		}
	);
}
