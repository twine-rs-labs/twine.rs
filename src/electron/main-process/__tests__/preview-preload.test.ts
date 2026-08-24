import type {
	NativeStoryPreviewBridge,
	NativeStoryPreviewInitialState
} from '../../preview-ipc-channels';
import {
	storyPreviewBridgeName,
	storyPreviewIpcChannels
} from '../../preview-ipc-channels';

describe('desktop story preview preload', () => {
	it('exposes only the generation-scoped preview API', async () => {
		jest.resetModules();
		jest.doMock('electron');
		Object.defineProperty(process, 'isMainFrame', {
			configurable: true,
			value: true
		});

		const electron = await import('electron');

		await import('../preview-preload');

		expect(electron.contextBridge.exposeInMainWorld).toHaveBeenCalledTimes(1);
		const [name, api] = (electron.contextBridge.exposeInMainWorld as jest.Mock)
			.mock.calls[0] as [string, NativeStoryPreviewBridge];

		expect(name).toBe(storyPreviewBridgeName);
		expect(Object.keys(api).sort()).toEqual([
			'beginClearState',
			'cancelClearState',
			'command',
			'completeClearState',
			'copyText',
			'frameLoaded',
			'getInitialState',
			'onAppearance',
			'onCommandResult',
			'onReplacement',
			'ready'
		]);

		const initialState = {
			descriptor: {generation: 4},
			url: 'twine-preview://token/index.html'
		} as NativeStoryPreviewInitialState;
		(electron.ipcRenderer.invoke as jest.Mock).mockResolvedValue(initialState);
		await expect(api.getInitialState()).resolves.toBe(initialState);
		expect(electron.ipcRenderer.invoke).toHaveBeenCalledWith(
			storyPreviewIpcChannels.getInitialState
		);

		await api.beginClearState(4);
		expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
			storyPreviewIpcChannels.beginClearState,
			4
		);
		const clearOperation = {
			generation: 4,
			operationId: 'clear-4',
			url: 'twine-preview://token/ignored-by-preload'
		};
		await api.completeClearState(clearOperation);
		expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
			storyPreviewIpcChannels.completeClearState,
			{generation: 4, operationId: 'clear-4'}
		);
		await api.cancelClearState(clearOperation);
		expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
			storyPreviewIpcChannels.cancelClearState,
			{generation: 4, operationId: 'clear-4'}
		);

		await api.command({
			extra: 'discarded',
			generation: 4,
			passageId: 'passage-1',
			type: 'revealSource'
		} as never);
		expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
			storyPreviewIpcChannels.command,
			{generation: 4, passageId: 'passage-1', type: 'revealSource'}
		);

		await api.copyText(' runtime log ');
		expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
			storyPreviewIpcChannels.copyText,
			' runtime log '
		);
		await expect(api.copyText('')).rejects.toThrow('Invalid runtime log text');
		await expect(api.copyText('x'.repeat(4 * 1024 * 1024 + 1))).rejects.toThrow(
			'Invalid runtime log text'
		);

		api.ready(4);
		await api.frameLoaded(4);
		expect(electron.ipcRenderer.send).toHaveBeenCalledWith(
			storyPreviewIpcChannels.ready,
			4
		);
		expect(electron.ipcRenderer.invoke).toHaveBeenLastCalledWith(
			storyPreviewIpcChannels.frameLoaded,
			4
		);

		const callback = jest.fn();
		const unsubscribe = api.onReplacement(callback);
		const listener = (electron.ipcRenderer.on as jest.Mock).mock.calls.find(
			call => call[0] === storyPreviewIpcChannels.replacement
		)?.[1];
		const result = {generation: 5, status: 'success'};

		listener({sender: 'not exposed'}, result);
		expect(callback).toHaveBeenCalledWith(result);
		expect(callback).not.toHaveBeenCalledWith(
			expect.objectContaining({sender: 'not exposed'})
		);

		unsubscribe();
		expect(electron.ipcRenderer.removeListener).toHaveBeenCalledWith(
			storyPreviewIpcChannels.replacement,
			listener
		);

		expect(() =>
			api.command({generation: 4, passageId: '', type: 'testCurrent'})
		).toThrow('Invalid story preview passage');
		expect(() => api.ready(-1)).toThrow('Invalid story preview generation');
	});

	it('does not expose the bridge in a child frame', async () => {
		jest.resetModules();
		jest.doMock('electron');
		Object.defineProperty(process, 'isMainFrame', {
			configurable: true,
			value: false
		});

		const electron = await import('electron');

		await import('../preview-preload');
		expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
	});
});
