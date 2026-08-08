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

	it('reconstitutes typed package snapshot staleness across IPC', async () => {
		jest.resetModules();
		jest.clearAllMocks();
		jest.useFakeTimers();
		jest.doMock('electron');
		Object.defineProperty(process, 'isMainFrame', {
			configurable: true,
			value: true
		});
		const electron = await import('electron');

		(electron.ipcRenderer.invoke as jest.Mock).mockImplementation(
			async (channel: string) => {
				if (channel === 'open-project-folder') {
					return {
						__twineProjectCapability: 'capability-1',
						rootPath: '/mock/project',
						stories: [],
						storyIds: []
					};
				}
				if (channel === 'read-project-package-asset-payloads') {
					return {
						code: 'PACKAGE_ASSET_SNAPSHOT_STALE',
						message: 'Project assets changed during the read.',
						status: 'error'
					};
				}
			}
		);

		await import('../preload');
		const [, api] = (
			electron.contextBridge.exposeInMainWorld as jest.Mock
		).mock.calls.find(([name]) => name === 'twineElectron') as [
			string,
			NonNullable<TwineElectronWindow['twineElectron']>
		];

		await api.openProjectFolder();
		await expect(
			api.readProjectPackageAssetPayloads('/mock/project', [])
		).rejects.toMatchObject({
			code: 'PACKAGE_ASSET_SNAPSHOT_STALE',
			message: 'Project assets changed during the read.'
		});
		expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
			'read-project-package-asset-payloads',
			'capability-1',
			[]
		);
		jest.clearAllTimers();
		jest.useRealTimers();
	});
});
