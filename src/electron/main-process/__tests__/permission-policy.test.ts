import type {Session, WebContents} from 'electron';
import {installPermissionPolicy} from '../permission-policy';

function testContext() {
	const targetSession = {
		on: jest.fn(),
		setBluetoothPairingHandler: jest.fn(),
		setDevicePermissionHandler: jest.fn(),
		setDisplayMediaRequestHandler: jest.fn(),
		setPermissionCheckHandler: jest.fn(),
		setPermissionRequestHandler: jest.fn()
	};
	const trustedWebContents = {on: jest.fn()};

	installPermissionPolicy(
		targetSession as unknown as Session,
		trustedWebContents as unknown as WebContents,
		'file:///app/renderer/index.html'
	);

	return {targetSession, trustedWebContents};
}

describe('installPermissionPolicy', () => {
	it('allows only sanitized clipboard writes from the trusted main frame', () => {
		const {targetSession, trustedWebContents} = testContext();
		const check = targetSession.setPermissionCheckHandler.mock.calls[0][0];
		const request = targetSession.setPermissionRequestHandler.mock.calls[0][0];
		const trusted = trustedWebContents as unknown as WebContents;
		const other = {} as WebContents;

		expect(
			check(trusted, 'clipboard-sanitized-write', 'file://', {
				isMainFrame: true,
				requestingUrl: 'file:///app/renderer/index.html#/stories'
			})
		).toBe(true);
		expect(
			check(trusted, 'clipboard-sanitized-write', 'file://', {
				isMainFrame: false,
				requestingUrl: 'file:///app/renderer/index.html'
			})
		).toBe(false);
		expect(
			check(trusted, 'media', 'file://', {
				isMainFrame: true,
				requestingUrl: 'file:///app/renderer/index.html'
			})
		).toBe(false);
		expect(
			check(other, 'clipboard-sanitized-write', 'file://', {
				isMainFrame: true,
				requestingUrl: 'file:///app/renderer/index.html'
			})
		).toBe(false);
		expect(
			check(trusted, 'clipboard-sanitized-write', 'file://', {
				isMainFrame: true,
				requestingUrl: 'file:///tmp/untrusted.html'
			})
		).toBe(false);

		for (const [
			webContents,
			permission,
			isMainFrame,
			requestingUrl,
			expected
		] of [
			[
				trusted,
				'clipboard-sanitized-write',
				true,
				'file:///app/renderer/index.html?source=test',
				true
			],
			[
				trusted,
				'clipboard-sanitized-write',
				false,
				'file:///app/renderer/index.html',
				false
			],
			[trusted, 'media', true, 'file:///app/renderer/index.html', false],
			[
				other,
				'clipboard-sanitized-write',
				true,
				'file:///app/renderer/index.html',
				false
			],
			[
				trusted,
				'clipboard-sanitized-write',
				true,
				'file:///tmp/untrusted.html',
				false
			]
		] as const) {
			const callback = jest.fn();
			request(webContents, permission, callback, {isMainFrame, requestingUrl});
			expect(callback).toHaveBeenCalledWith(expected);
		}
	});

	it('denies display capture, device permissions, and Bluetooth pairing', () => {
		const {targetSession} = testContext();
		const devicePermission =
			targetSession.setDevicePermissionHandler.mock.calls[0][0];
		const displayMedia =
			targetSession.setDisplayMediaRequestHandler.mock.calls[0][0];
		const bluetoothPairing =
			targetSession.setBluetoothPairingHandler.mock.calls[0][0];
		const displayCallback = jest.fn();
		const pairingCallback = jest.fn();

		expect(devicePermission({deviceType: 'usb'})).toBe(false);
		displayMedia({}, displayCallback);
		bluetoothPairing({}, pairingCallback);

		expect(displayCallback).toHaveBeenCalledWith({});
		expect(pairingCallback).toHaveBeenCalledWith({confirmed: false});
	});

	it('cancels every device-selection event', () => {
		const {targetSession, trustedWebContents} = testContext();
		const sessionHandlers = new Map(
			targetSession.on.mock.calls.map(([event, handler]) => [event, handler])
		);
		const bluetoothHandler = trustedWebContents.on.mock.calls.find(
			([event]) => event === 'select-bluetooth-device'
		)?.[1];

		for (const [eventName, callbackArgument] of [
			['select-hid-device', undefined],
			['select-usb-device', undefined],
			['select-serial-port', '']
		] as const) {
			const event = {preventDefault: jest.fn()};
			const callback = jest.fn();
			const handler = sessionHandlers.get(eventName);

			if (eventName === 'select-serial-port') {
				handler(event, [], {}, callback);
			} else {
				handler(event, {}, callback);
			}

			expect(event.preventDefault).toHaveBeenCalledTimes(1);
			if (callbackArgument === undefined) {
				expect(callback).toHaveBeenCalledWith();
			} else {
				expect(callback).toHaveBeenCalledWith(callbackArgument);
			}
		}

		const bluetoothEvent = {preventDefault: jest.fn()};
		const bluetoothCallback = jest.fn();
		bluetoothHandler(bluetoothEvent, [], bluetoothCallback);
		expect(bluetoothEvent.preventDefault).toHaveBeenCalledTimes(1);
		expect(bluetoothCallback).toHaveBeenCalledWith('');
	});
});
