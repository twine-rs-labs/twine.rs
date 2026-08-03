import type {TwineElectronWindow} from '../../shared';

describe('desktop authoring preload', () => {
	it('exposes asynchronous persistence quit coordination without sync IPC', async () => {
		jest.resetModules();
		jest.useFakeTimers();
		jest.doMock('electron');
		Object.defineProperty(process, 'isMainFrame', {
			configurable: true,
			value: true
		});
		const electron = await import('electron');

		await import('../preload');
		const [, api] = (
			electron.contextBridge.exposeInMainWorld as jest.Mock
		).mock.calls.find(([name]) => name === 'twineElectron') as [
			string,
			NonNullable<TwineElectronWindow['twineElectron']>
		];
		const requested = jest.fn();
		const cancelled = jest.fn();
		const unsubscribeRequested = api.onPersistenceQuitRequested(requested);
		const unsubscribeCancelled = api.onPersistenceQuitCancelled(cancelled);
		const requestListener = (
			electron.ipcRenderer.on as jest.Mock
		).mock.calls.find(
			([channel]) => channel === 'persistence-quit-requested'
		)?.[1];
		const cancelListener = (
			electron.ipcRenderer.on as jest.Mock
		).mock.calls.find(
			([channel]) => channel === 'persistence-quit-cancelled'
		)?.[1];

		requestListener({}, 'quit-1');
		cancelListener({}, 'quit-1');
		expect(requested).toHaveBeenCalledWith('quit-1');
		expect(cancelled).toHaveBeenCalledWith('quit-1');
		api.completePersistenceQuit('quit-1');
		expect(electron.ipcRenderer.send).toHaveBeenCalledWith(
			'persistence-quit-prepared',
			'quit-1',
			undefined
		);
		expect('sendSync' in electron.ipcRenderer).toBe(false);
		api.rendererPersistenceReady();
		expect(electron.ipcRenderer.send).toHaveBeenCalledWith(
			'persistence-renderer-ready'
		);

		unsubscribeRequested();
		unsubscribeCancelled();
		expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
			'persistence-quit-requested',
			requestListener
		);
		jest.clearAllTimers();
		jest.useRealTimers();
	});
});
