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

	it('tracks lifecycle transactions and drops project access after deletion commit', async () => {
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
				if (channel === 'begin-project-replacement') {
					return {
						id: 'replacement-1',
						project: {
							__twineProjectCapability: 'capability-2',
							rootPath: '/mock/project',
							stories: [],
							storyIds: []
						}
					};
				}
				if (channel === 'begin-project-folder-deletion') {
					return {id: 'deletion-1', rootPath: '/mock/project'};
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
		const replacement = await api.beginProjectReplacement('/mock/project', []);

		expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
			'begin-project-replacement',
			'capability-1',
			[],
			undefined
		);
		await api.commitProjectReplacements([replacement.id]);
		const deletion = await api.beginProjectFolderDeletion('/mock/project');

		expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
			'begin-project-folder-deletion',
			'capability-2'
		);
		await api.commitProjectFolderDeletion(deletion.id);
		expect(() => api.listProjectAssets('/mock/project')).toThrow(
			'not granted by the main process'
		);
		jest.clearAllTimers();
		jest.useRealTimers();
	});
});
