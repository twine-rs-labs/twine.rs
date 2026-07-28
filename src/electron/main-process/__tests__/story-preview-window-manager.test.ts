import type {WebContents} from 'electron';
import {storyPreviewIpcChannels} from '../../preview-ipc-channels';
import type {
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewDescriptor
} from '../../shared';
import {
	createStoryPreviewWindowManager,
	type ManagedStoryPreviewBuild,
	maxManagedStoryPreviewWindows
} from '../story-preview-window-manager';

type Listener = (...args: any[]) => void;
type IpcHandler = (...args: any[]) => any;

function emitter() {
	const listeners = new Map<string, Listener[]>();
	const on = jest.fn((event: string, listener: Listener) => {
		listeners.set(event, [...(listeners.get(event) ?? []), listener]);
	});
	const once = jest.fn((event: string, listener: Listener) => {
		listeners.set(event, [...(listeners.get(event) ?? []), listener]);
	});
	const removeListener = jest.fn((event: string, listener: Listener) => {
		listeners.set(
			event,
			(listeners.get(event) ?? []).filter(candidate => candidate !== listener)
		);
	});

	return {
		emit(event: string, ...args: any[]) {
			for (const listener of [...(listeners.get(event) ?? [])]) {
				listener(...args);
			}
		},
		listeners,
		on,
		once,
		removeListener
	};
}

function fakeWebContents(url = 'file:///preview.html') {
	const events = emitter();
	const mainFrame = {url};

	return {
		...events,
		isDestroyed: jest.fn(() => false),
		mainFrame,
		send: jest.fn(),
		session: {
			on: jest.fn(),
			setPermissionCheckHandler: jest.fn(),
			setPermissionRequestHandler: jest.fn()
		},
		setWindowOpenHandler: jest.fn()
	} as unknown as WebContents &
		ReturnType<typeof emitter> & {
			isDestroyed: jest.Mock;
			mainFrame: {url: string};
			send: jest.Mock;
			session: {
				on: jest.Mock;
				setPermissionCheckHandler: jest.Mock;
				setPermissionRequestHandler: jest.Mock;
			};
			setWindowOpenHandler: jest.Mock;
		};
}

function fakeWindow(entryUrl: string) {
	const events = emitter();
	const webContents = fakeWebContents(entryUrl);

	return {
		...events,
		destroy: jest.fn(),
		isDestroyed: jest.fn(() => false),
		loadURL: jest.fn().mockResolvedValue(undefined),
		show: jest.fn(),
		webContents
	};
}

function descriptor(
	overrides: Partial<ManagedStoryPreviewBuild['descriptor']> = {}
): ManagedStoryPreviewBuild['descriptor'] {
	return {
		appearance: {
			highContrast: false,
			reducedMotion: false,
			theme: 'light'
		},
		bridgeSessionId: 'bridge-1',
		htmlBytes: 20,
		launchPassage: {id: 'passage-1', name: 'Start'},
		passages: [
			{id: 'passage-1', localId: '1', name: 'Start'},
			{id: 'passage-2', localId: '2', name: 'Next'}
		],
		storyDataCount: 2,
		storyId: 'story-1',
		storyName: 'Story',
		target: 'play',
		...overrides
	};
}

function summary() {
	return {
		assetCount: 0,
		characterCount: 0,
		diagnosticCount: 0,
		errorCount: 0,
		graph: {
			brokenLinks: 0,
			emptyPassages: 0,
			links: 0,
			orphanPassages: 0,
			passages: 2,
			resolvedLinks: 0,
			selfLinks: 0,
			taggedPassages: 0,
			unreachablePassages: 0
		},
		missingAssetCount: 0,
		passageCount: 2,
		revision: 1,
		storyId: 'story-1',
		tagCount: 0,
		warningCount: 0,
		wordCount: 0
	};
}

function build(
	overrides: Partial<ManagedStoryPreviewBuild> = {}
): ManagedStoryPreviewBuild {
	return {
		descriptor: descriptor(),
		html: '<html>Story</html>',
		...overrides
	};
}

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function testManager(
	options: {
		linkMode?: 'block' | 'system';
		replacementTimeoutMs?: number;
	} = {}
) {
	const entryUrl = 'file:///app/story-preview.html';
	const windows: ReturnType<typeof fakeWindow>[] = [];
	const windowOptions: unknown[] = [];
	const staged: Array<{files: never[]; id: number}> = [];
	let nextStageGate: Promise<void> | undefined;
	const stagePackage = jest.fn(async () => {
		const gate = nextStageGate;

		nextStageGate = undefined;
		await gate;
		const value = {files: [] as never[], id: staged.length + 1};

		staged.push(value);
		return value as any;
	});
	const registerPackage = jest.fn(
		(value: {id: number}) =>
			`twine-preview://00000000-0000-4000-8000-${String(value.id).padStart(
				12,
				'0'
			)}/index.html`
	);
	const releasePackage = jest.fn().mockResolvedValue(undefined);
	const releaseStagedPackage = jest.fn().mockResolvedValue(undefined);
	const openExternal = jest.fn().mockResolvedValue(undefined);
	const focusOwner = jest.fn();
	let id = 0;
	const manager = createStoryPreviewWindowManager({
		createWindow: config => {
			windowOptions.push(config);
			const window = fakeWindow(entryUrl);

			windows.push(window);
			return window as any;
		},
		focusOwner,
		linkMode: () => options.linkMode ?? 'block',
		openExternal,
		previewEntryUrl: () => entryUrl,
		randomId: () => `session-${++id}`,
		registerPackage: registerPackage as any,
		replacementTimeoutMs: options.replacementTimeoutMs,
		releasePackage,
		releaseStagedPackage,
		stagePackage: stagePackage as any
	});
	const ipcHandlers = new Map<string, IpcHandler>();
	const ipcListeners = new Map<string, IpcHandler>();

	manager.registerPreviewIpc({
		handle: jest.fn((channel, listener) => {
			ipcHandlers.set(channel, listener);
		}),
		on: jest.fn((channel, listener) => {
			ipcListeners.set(channel, listener);
		})
	} as any);

	return {
		blockNextStage(gate: Promise<void>) {
			nextStageGate = gate;
		},
		entryUrl,
		focusOwner,
		ipcHandlers,
		ipcListeners,
		manager,
		openExternal,
		registerPackage,
		releasePackage,
		releaseStagedPackage,
		stagePackage,
		windowOptions,
		windows
	};
}

function previewEvent(window: ReturnType<typeof fakeWindow>, entryUrl: string) {
	window.webContents.mainFrame.url = entryUrl;
	return {
		sender: window.webContents,
		senderFrame: window.webContents.mainFrame
	};
}

async function openReadyPreview(
	harness: ReturnType<typeof testManager>,
	owner = fakeWebContents('file:///app/index.html'),
	previewBuild = build()
) {
	const opening = harness.manager.open(owner, previewBuild);

	await flushPromises();
	const window = harness.windows.at(-1)!;
	const event = previewEvent(window, harness.entryUrl);
	const initialState = harness.ipcHandlers.get(
		storyPreviewIpcChannels.getInitialState
	)!(event) as {
		descriptor: NativeStoryPreviewDescriptor;
		url: string;
	};

	harness.ipcListeners.get(storyPreviewIpcChannels.ready)!(
		event,
		initialState.descriptor.generation
	);
	await harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(
		event,
		initialState.descriptor.generation
	);
	const launch = await opening;

	return {event, launch, owner, window};
}

describe('story preview window manager', () => {
	it('creates a hidden dedicated sandboxed window and resolves only after shell and story readiness', async () => {
		const harness = testManager();
		const owner = fakeWebContents('file:///app/index.html');
		let resolved = false;
		const opening = harness.manager.open(owner, build()).then(value => {
			resolved = true;
			return value;
		});

		await flushPromises();
		expect(resolved).toBe(false);
		expect(harness.windowOptions[0]).toEqual(
			expect.objectContaining({
				show: false,
				webPreferences: expect.objectContaining({
					contextIsolation: true,
					nodeIntegration: false,
					nodeIntegrationInSubFrames: false,
					preload: expect.stringMatching(/preview-preload\.js$/),
					sandbox: true,
					webSecurity: true
				})
			})
		);
		const window = harness.windows[0];
		const event = previewEvent(window, harness.entryUrl);
		const initial = harness.ipcHandlers.get(
			storyPreviewIpcChannels.getInitialState
		)!(event);

		expect(initial).toEqual(
			expect.objectContaining({
				descriptor: expect.objectContaining({
					generation: 1,
					sessionId: 'session-1'
				}),
				url: expect.stringMatching(/^twine-preview:/)
			})
		);
		harness.ipcListeners.get(storyPreviewIpcChannels.ready)!(event, 1);
		await flushPromises();
		expect(resolved).toBe(false);
		expect(window.show).not.toHaveBeenCalled();
		await harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(
			event,
			1
		);
		await expect(opening).resolves.toEqual(initial);
		expect(window.show).toHaveBeenCalledTimes(1);
		expect(
			window.webContents.session.setPermissionCheckHandler
		).not.toHaveBeenCalled();
		expect(
			window.webContents.session.setPermissionRequestHandler
		).not.toHaveBeenCalled();
		expect(window.webContents.session.on).not.toHaveBeenCalled();
	});

	it('derives preview identity from the sender and rejects another preview', async () => {
		const harness = testManager();
		const first = await openReadyPreview(harness);
		const second = await openReadyPreview(harness);
		const getInitialState = harness.ipcHandlers.get(
			storyPreviewIpcChannels.getInitialState
		)!;

		expect(getInitialState(first.event).descriptor.sessionId).toBe('session-1');
		expect(getInitialState(second.event).descriptor.sessionId).toBe(
			'session-2'
		);
		expect(() =>
			getInitialState({
				sender: fakeWebContents(harness.entryUrl),
				senderFrame: first.window.webContents.mainFrame
			})
		).toThrow();
	});

	it('routes only validated generation commands to the owner', async () => {
		const harness = testManager();
		const {event, launch, owner} = await openReadyPreview(harness);
		const command = harness.ipcHandlers.get(storyPreviewIpcChannels.command)!;

		expect(
			command(event, {
				generation: 1,
				passageId: 'passage-2',
				type: 'testFromStart'
			})
		).toEqual(expect.objectContaining({status: 'error'}));
		expect(
			command(event, {
				generation: 1,
				passageId: 'missing',
				type: 'testCurrent'
			})
		).toEqual(expect.objectContaining({status: 'error'}));
		expect(command(event, {generation: 1, type: 'testFromStart'})).toEqual({
			command: 'testFromStart',
			generation: 1,
			status: 'busy'
		});
		expect(owner.send).toHaveBeenCalledWith(
			storyPreviewIpcChannels.ownerCommand,
			{
				command: {generation: 1, type: 'testFromStart'},
				passageId: 'passage-1',
				sessionId: launch.descriptor.sessionId,
				storyId: 'story-1'
			}
		);
		expect(command(event, {generation: 1, type: 'testFromStart'})).toEqual(
			expect.objectContaining({status: 'error'})
		);
	});

	it('focuses the owner for reveal commands and forwards completion', async () => {
		const harness = testManager();
		const {event, launch, owner, window} = await openReadyPreview(harness);
		const command = harness.ipcHandlers.get(storyPreviewIpcChannels.command)!;
		const result = command(event, {
			generation: 1,
			passageId: 'passage-2',
			type: 'revealSource'
		});

		expect(result).toEqual({
			command: 'revealSource',
			generation: 1,
			status: 'busy'
		});
		expect(harness.focusOwner).toHaveBeenCalledWith(owner);
		const completion: NativeStoryPreviewCommandResult = {
			command: 'revealSource',
			generation: 1,
			status: 'success'
		};

		harness.manager.completeCommand(
			owner,
			launch.descriptor.sessionId,
			completion
		);
		expect(window.webContents.send).toHaveBeenLastCalledWith(
			storyPreviewIpcChannels.commandResult,
			completion
		);
		expect(() =>
			harness.manager.completeCommand(
				owner,
				launch.descriptor.sessionId,
				completion
			)
		).toThrow('stale or unsolicited');

		expect(
			command(event, {
				generation: 1,
				passageId: 'passage-2',
				type: 'revealSource'
			})
		).toEqual(expect.objectContaining({status: 'busy'}));
		expect(() =>
			harness.manager.completeCommand(owner, launch.descriptor.sessionId, {
				command: 'revealSource',
				generation: 1,
				message: 'x'.repeat(4097),
				operation: 'command',
				status: 'error'
			})
		).toThrow('command error');
		expect(() =>
			harness.manager.completeCommand(owner, launch.descriptor.sessionId, {
				command: 'revealSource',
				generation: 1,
				message: 'The replacement failed.',
				operation: 'command',
				status: 'error'
			})
		).not.toThrow();
	});

	it('commits a replacement only after the matching frame-load acknowledgement', async () => {
		const harness = testManager();
		const {event, launch, owner, window} = await openReadyPreview(harness);
		const replacing = harness.manager.replace(
			owner,
			launch.descriptor.sessionId,
			1,
			build({
				descriptor: descriptor({
					bridgeSessionId: 'bridge-2',
					target: 'test'
				}),
				html: '<html>Replacement</html>'
			})
		);

		await flushPromises();
		expect(harness.releasePackage).not.toHaveBeenCalled();
		expect(window.webContents.send).toHaveBeenCalledWith(
			storyPreviewIpcChannels.replacement,
			expect.objectContaining({
				generation: 2,
				replacement: expect.objectContaining({
					descriptor: expect.objectContaining({
						generation: 2,
						sessionId: launch.descriptor.sessionId
					})
				}),
				status: 'success'
			})
		);
		await harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(
			event,
			2
		);
		const committed = await replacing;

		expect(committed.descriptor.generation).toBe(2);
		expect(harness.releasePackage).toHaveBeenCalledWith(launch.url);
		expect(
			harness.ipcHandlers.get(storyPreviewIpcChannels.getInitialState)!(event)
		).toEqual(committed);
	});

	it('rolls a failed replacement back without releasing the committed package', async () => {
		const harness = testManager();
		const {event, launch, owner, window} = await openReadyPreview(harness);
		const replacing = harness.manager.replace(
			owner,
			launch.descriptor.sessionId,
			1,
			build({descriptor: descriptor({bridgeSessionId: 'bridge-2'})})
		);

		await flushPromises();
		const replacement = window.webContents.send.mock.calls.find(
			([channel]) => channel === storyPreviewIpcChannels.replacement
		)?.[1];
		const candidateUrl = replacement.replacement.url;
		const failedLoad = window.webContents.listeners.get('did-fail-load')![0];

		failedLoad({}, -2, 'failed', candidateUrl, false);
		await expect(replacing).rejects.toThrow('failed to load');
		await expect(
			harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(event, 2)
		).rejects.toThrow('stale generation');
		expect(harness.releasePackage).toHaveBeenCalledWith(candidateUrl);
		expect(harness.releasePackage).not.toHaveBeenCalledWith(launch.url);
		expect(
			harness.ipcHandlers.get(storyPreviewIpcChannels.getInitialState)!(event)
		).toEqual(launch);
	});

	it('rejects an initial story-frame load failure before showing the shell', async () => {
		const harness = testManager();
		const opening = harness.manager.open(
			fakeWebContents('file:///app/index.html'),
			build()
		);

		await flushPromises();
		const window = harness.windows[0];
		const event = previewEvent(window, harness.entryUrl);
		const initial = harness.ipcHandlers.get(
			storyPreviewIpcChannels.getInitialState
		)!(event);
		const failedLoad = window.webContents.listeners.get('did-fail-load')![0];

		harness.ipcListeners.get(storyPreviewIpcChannels.ready)!(event, 1);
		failedLoad({}, -2, 'connection refused', initial.url, false);

		await expect(opening).rejects.toThrow(
			'Initial story preview failed to load: connection refused'
		);
		expect(window.show).not.toHaveBeenCalled();
		expect(window.destroy).toHaveBeenCalledTimes(1);
		expect(harness.releasePackage).toHaveBeenCalledWith(initial.url);
	});

	it('rolls back replacement timeout and rejects a late frame acknowledgement', async () => {
		const harness = testManager({replacementTimeoutMs: 5});
		const {event, launch, owner, window} = await openReadyPreview(harness);
		const replacing = harness.manager.replace(
			owner,
			launch.descriptor.sessionId,
			1,
			build({descriptor: descriptor({bridgeSessionId: 'bridge-2'})})
		);

		await flushPromises();
		const replacement = window.webContents.send.mock.calls.find(
			([channel]) => channel === storyPreviewIpcChannels.replacement
		)?.[1];

		await expect(replacing).rejects.toThrow('did not load in time');
		await expect(
			harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(event, 2)
		).rejects.toThrow('stale generation');
		expect(harness.releasePackage).toHaveBeenCalledWith(
			replacement.replacement.url
		);
		expect(harness.releasePackage).not.toHaveBeenCalledWith(launch.url);
	});

	it('releases staged and candidate replacements when the session closes', async () => {
		const stagingHarness = testManager();
		const stagedSession = await openReadyPreview(stagingHarness);
		let releaseStage!: () => void;
		const stageGate = new Promise<void>(resolve => {
			releaseStage = resolve;
		});

		stagingHarness.blockNextStage(stageGate);
		const stagingReplacement = stagingHarness.manager.replace(
			stagedSession.owner,
			stagedSession.launch.descriptor.sessionId,
			1,
			build({descriptor: descriptor({bridgeSessionId: 'bridge-2'})})
		);

		await flushPromises();
		await stagingHarness.manager.close(
			stagedSession.owner,
			stagedSession.launch.descriptor.sessionId
		);
		releaseStage();
		await expect(stagingReplacement).rejects.toThrow('closed while staging');
		expect(stagingHarness.releasePackage).toHaveBeenCalledTimes(2);

		const candidateHarness = testManager();
		const candidateSession = await openReadyPreview(candidateHarness);
		const candidateReplacement = candidateHarness.manager.replace(
			candidateSession.owner,
			candidateSession.launch.descriptor.sessionId,
			1,
			build({descriptor: descriptor({bridgeSessionId: 'bridge-2'})})
		);

		await flushPromises();
		await candidateHarness.manager.close(
			candidateSession.owner,
			candidateSession.launch.descriptor.sessionId
		);
		await expect(candidateReplacement).rejects.toThrow('session closed');
		expect(candidateHarness.releasePackage).toHaveBeenCalledTimes(2);
	});

	it('keeps owner sessions independent and cleans each lifecycle exactly once', async () => {
		const harness = testManager();
		const firstOwner = fakeWebContents('file:///app/index.html');
		const secondOwner = fakeWebContents('file:///app/index.html');
		const first = await openReadyPreview(harness, firstOwner);
		const second = await openReadyPreview(harness, secondOwner);

		firstOwner.emit('render-process-gone');
		await flushPromises();
		expect(harness.manager.activeSessionCount).toBe(1);
		expect(harness.releasePackage).toHaveBeenCalledWith(first.launch.url);
		expect(harness.releasePackage).not.toHaveBeenCalledWith(second.launch.url);

		second.window.webContents.emit('render-process-gone');
		await flushPromises();
		expect(harness.manager.activeSessionCount).toBe(0);
		expect(harness.releasePackage).toHaveBeenCalledWith(second.launch.url);
	});

	it('releases a session after a normal preview-window close', async () => {
		const harness = testManager();
		const {launch, window} = await openReadyPreview(harness);

		window.emit('closed');
		await flushPromises();

		expect(harness.manager.activeSessionCount).toBe(0);
		expect(harness.releasePackage).toHaveBeenCalledWith(launch.url);
		expect(window.destroy).not.toHaveBeenCalled();
	});

	it('closes every owner preview on a top-level reload but ignores subframe navigation', async () => {
		const harness = testManager();
		const owner = fakeWebContents('file:///app/index.html');
		await openReadyPreview(harness, owner);
		await openReadyPreview(harness, owner);

		owner.emit('did-start-navigation', {
			isMainFrame: false,
			isSameDocument: false
		});
		expect(harness.manager.activeSessionCount).toBe(2);
		owner.emit('did-start-navigation', {
			isMainFrame: true,
			isSameDocument: false
		});
		await flushPromises();
		expect(harness.manager.activeSessionCount).toBe(0);
		expect(harness.releasePackage).toHaveBeenCalledTimes(2);
	});

	it('releases every session and destroys its window during app shutdown', async () => {
		const harness = testManager();
		const first = await openReadyPreview(harness);
		const second = await openReadyPreview(harness);

		await harness.manager.shutdown();

		expect(harness.manager.activeSessionCount).toBe(0);
		expect(first.window.destroy).toHaveBeenCalledTimes(1);
		expect(second.window.destroy).toHaveBeenCalledTimes(1);
		expect(harness.releasePackage).toHaveBeenCalledWith(first.launch.url);
		expect(harness.releasePackage).toHaveBeenCalledWith(second.launch.url);
		await expect(
			harness.manager.open(fakeWebContents('file:///app/index.html'), build())
		).rejects.toThrow('quitting');
	});

	it('blocks shell/direct-story escapes while leaving descendant embeds alone', async () => {
		const harness = testManager({linkMode: 'system'});
		const {launch, window} = await openReadyPreview(harness);
		const navigate = window.webContents.listeners.get(
			'will-frame-navigate'
		)![0];
		const mainEscape = {
			frame: window.webContents.mainFrame,
			isMainFrame: true,
			preventDefault: jest.fn(),
			url: 'https://example.com/main'
		};
		const directStoryFrame = {parent: window.webContents.mainFrame};
		const directInternal = {
			frame: directStoryFrame,
			isMainFrame: false,
			preventDefault: jest.fn(),
			url: launch.url.replace('index.html', 'next.html')
		};
		const directEscape = {
			frame: directStoryFrame,
			isMainFrame: false,
			preventDefault: jest.fn(),
			url: 'https://example.com/story'
		};
		const descendantEmbed = {
			frame: {parent: directStoryFrame},
			isMainFrame: false,
			preventDefault: jest.fn(),
			url: 'https://player.example/embed'
		};
		const anotherPreview = {
			frame: directStoryFrame,
			isMainFrame: false,
			preventDefault: jest.fn(),
			url: launch.url.replace('000000000001', '000000000099')
		};

		navigate(mainEscape);
		navigate(directInternal);
		navigate(directEscape);
		navigate(descendantEmbed);
		navigate(anotherPreview);
		await flushPromises();

		expect(mainEscape.preventDefault).toHaveBeenCalledTimes(1);
		expect(directInternal.preventDefault).not.toHaveBeenCalled();
		expect(directEscape.preventDefault).toHaveBeenCalledTimes(1);
		expect(descendantEmbed.preventDefault).not.toHaveBeenCalled();
		expect(anotherPreview.preventDefault).toHaveBeenCalledTimes(1);
		expect(harness.openExternal).toHaveBeenCalledWith(
			'https://example.com/main'
		);
		expect(harness.openExternal).toHaveBeenCalledWith(
			'https://example.com/story'
		);
		const popup = window.webContents.setWindowOpenHandler.mock.calls[0][0];

		expect(popup({url: 'https://example.com/popup'})).toEqual({action: 'deny'});
		expect(harness.openExternal).toHaveBeenCalledWith(
			'https://example.com/popup'
		);
	});

	it('broadcasts appearance without rebuilding or exposing another owner', async () => {
		const harness = testManager();
		const firstOwner = fakeWebContents('file:///app/index.html');
		const secondOwner = fakeWebContents('file:///app/index.html');
		const first = await openReadyPreview(harness, firstOwner);
		const second = await openReadyPreview(harness, secondOwner);
		const appearance = {
			highContrast: true,
			reducedMotion: true,
			theme: 'dark' as const
		};

		expect(harness.manager.updateAppearance(firstOwner, appearance)).toBe(1);
		expect(first.window.webContents.send).toHaveBeenCalledWith(
			storyPreviewIpcChannels.appearance,
			{appearance, generation: 1}
		);
		expect(second.window.webContents.send).not.toHaveBeenCalledWith(
			storyPreviewIpcChannels.appearance,
			expect.anything()
		);
	});

	it('retains owner appearance before a preview session exists', async () => {
		const harness = testManager();
		const owner = fakeWebContents('file:///app/index.html');
		const appearance = {
			highContrast: true,
			reducedMotion: true,
			theme: 'dark' as const
		};

		expect(harness.manager.updateAppearance(owner, appearance)).toBe(0);
		const preview = await openReadyPreview(harness, owner);

		expect(preview.launch.descriptor.appearance).toEqual(appearance);
		expect(
			harness.ipcHandlers.get(storyPreviewIpcChannels.getInitialState)!(
				preview.event
			).descriptor.appearance
		).toEqual(appearance);
	});

	it('forgets retained owner appearance when the owner reloads', async () => {
		const harness = testManager();
		const owner = fakeWebContents('file:///app/index.html');

		harness.manager.updateAppearance(owner, {
			highContrast: true,
			reducedMotion: true,
			theme: 'dark'
		});
		owner.emit('did-start-navigation', {
			isMainFrame: true,
			isSameDocument: false
		});
		const preview = await openReadyPreview(harness, owner);

		expect(preview.launch.descriptor.appearance).toEqual(
			descriptor().appearance
		);
	});

	it('merges owner appearance updates that arrive while a replacement stages', async () => {
		const harness = testManager();
		const preview = await openReadyPreview(harness);
		let releaseStage!: () => void;
		const stageGate = new Promise<void>(resolve => {
			releaseStage = resolve;
		});
		const appearance = {
			highContrast: true,
			reducedMotion: true,
			theme: 'dark' as const
		};

		harness.blockNextStage(stageGate);
		const replacing = harness.manager.replace(
			preview.owner,
			preview.launch.descriptor.sessionId,
			1,
			build({
				descriptor: descriptor({
					appearance: {
						highContrast: false,
						reducedMotion: false,
						theme: 'light'
					},
					bridgeSessionId: 'bridge-2'
				})
			})
		);

		await flushPromises();
		expect(harness.manager.updateAppearance(preview.owner, appearance)).toBe(1);
		releaseStage();
		await flushPromises();
		const replacement = preview.window.webContents.send.mock.calls.findLast(
			([channel]) => channel === storyPreviewIpcChannels.replacement
		)?.[1];

		expect(replacement.replacement.descriptor.appearance).toEqual(appearance);
		await harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(
			preview.event,
			2
		);
		await expect(replacing).resolves.toMatchObject({
			descriptor: {appearance}
		});
	});

	it('rejects malformed descriptors before staging and enforces the live cap', async () => {
		const harness = testManager();
		const owner = fakeWebContents('file:///app/index.html');

		await expect(
			harness.manager.open(
				owner,
				build({
					descriptor: descriptor({
						passages: [
							{id: 'same', localId: '1', name: 'One'},
							{id: 'same', localId: '2', name: 'Two'}
						]
					})
				})
			)
		).rejects.toThrow('passage metadata');
		expect(harness.stagePackage).not.toHaveBeenCalled();
		await expect(
			harness.manager.open(
				owner,
				build({
					descriptor: descriptor({
						summary: {
							assetCount: 0,
							graph: {passages: 1},
							storyId: 'story-1'
						} as never
					})
				})
			)
		).rejects.toThrow('descriptor');
		expect(harness.stagePackage).not.toHaveBeenCalled();

		const descriptorsWithUnknownFields = [
			{...descriptor(), projectRoot: '/private/story'},
			{
				...descriptor(),
				appearance: {
					...descriptor().appearance,
					capabilities: ['filesystem']
				}
			},
			{
				...descriptor(),
				launchPassage: {
					...descriptor().launchPassage!,
					text: 'secret passage text'
				}
			},
			{
				...descriptor(),
				passages: [
					{
						...descriptor().passages[0],
						metadata: {projectRoot: '/private/story'}
					}
				]
			},
			{...descriptor(), summary: {...summary(), capabilities: ['filesystem']}},
			{
				...descriptor(),
				summary: {
					...summary(),
					graph: {...summary().graph, arbitraryMetadata: true}
				}
			}
		];

		for (const unknownDescriptor of descriptorsWithUnknownFields) {
			await expect(
				harness.manager.open(
					owner,
					build({descriptor: unknownDescriptor as never})
				)
			).rejects.toThrow(/descriptor|passage/);
		}
		expect(harness.stagePackage).not.toHaveBeenCalled();

		for (let index = 0; index < maxManagedStoryPreviewWindows; index++) {
			await openReadyPreview(
				harness,
				fakeWebContents('file:///app/index.html')
			);
		}
		await expect(
			harness.manager.open(fakeWebContents('file:///app/index.html'), build())
		).rejects.toThrow(`${maxManagedStoryPreviewWindows}`);
		expect(harness.manager.activeSessionCount).toBe(
			maxManagedStoryPreviewWindows
		);
	});

	it('releases staged data if protocol registration or window creation fails', async () => {
		const registrationFailure = testManager();

		registrationFailure.registerPackage.mockImplementationOnce(() => {
			throw new Error('registry full');
		});
		await expect(
			registrationFailure.manager.open(
				fakeWebContents('file:///app/index.html'),
				build()
			)
		).rejects.toThrow('registry full');
		expect(registrationFailure.releaseStagedPackage).toHaveBeenCalledTimes(1);

		const windowFailure = testManager();
		const broken = createStoryPreviewWindowManager({
			createWindow: () => {
				throw new Error('window failed');
			},
			previewEntryUrl: () => windowFailure.entryUrl,
			registerPackage: windowFailure.registerPackage as any,
			releasePackage: windowFailure.releasePackage,
			releaseStagedPackage: windowFailure.releaseStagedPackage,
			stagePackage: windowFailure.stagePackage as any
		});

		await expect(
			broken.open(fakeWebContents('file:///app/index.html'), build())
		).rejects.toThrow('window failed');
		expect(windowFailure.releasePackage).toHaveBeenCalledTimes(1);
	});
});
