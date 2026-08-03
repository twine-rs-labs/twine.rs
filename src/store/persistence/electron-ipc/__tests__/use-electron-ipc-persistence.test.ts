/** @jest-environment node */

import type {TwineElectronWindow} from '../../../../electron/shared';
import {persistenceQuitCoordinator} from '../persistence-quit-coordinator';
import {registerPersistenceQuitHandlers} from '../use-electron-ipc-persistence';

type ElectronBridge = NonNullable<TwineElectronWindow['twineElectron']>;

describe('registerPersistenceQuitHandlers', () => {
	it('is inert when imported outside an Electron renderer', () => {
		expect(typeof window).toBe('undefined');
		expect(() => registerPersistenceQuitHandlers(undefined)).not.toThrow();
	});

	it('registers renderer quit listeners and reports persistence readiness', async () => {
		let cancelListener: ((nonce: string) => void) | undefined;
		let requestListener: ((nonce: string) => void) | undefined;
		const bridge = {
			completePersistenceQuit: jest.fn(),
			onPersistenceQuitCancelled: jest.fn(callback => {
				cancelListener = callback;
				return jest.fn();
			}),
			onPersistenceQuitRequested: jest.fn(callback => {
				requestListener = callback;
				return jest.fn();
			}),
			rendererPersistenceReady: jest.fn()
		} as unknown as ElectronBridge;
		jest
			.spyOn(persistenceQuitCoordinator, 'prepare')
			.mockResolvedValue(undefined);
		const cancel = jest
			.spyOn(persistenceQuitCoordinator, 'cancel')
			.mockReturnValue(true);

		registerPersistenceQuitHandlers(bridge);

		expect(bridge.onPersistenceQuitRequested).toHaveBeenCalledTimes(1);
		expect(bridge.onPersistenceQuitCancelled).toHaveBeenCalledTimes(1);
		expect(bridge.rendererPersistenceReady).toHaveBeenCalledTimes(1);
		requestListener?.('quit-1');
		await Promise.resolve();
		expect(bridge.completePersistenceQuit).toHaveBeenCalledWith('quit-1');
		cancelListener?.('quit-1');
		expect(cancel).toHaveBeenCalledWith('quit-1');
	});
});
