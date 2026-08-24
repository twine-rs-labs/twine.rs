import type {WebContents} from 'electron';
import {readFileSync} from 'node:fs';
import path from 'node:path';
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
import {
	SUGARCUBE_COMPATIBILITY,
	sugarCubeRestartProfileForAdapter
} from '../../../routes/story-preview-sugarcube';
import {HARLOWE_3_3_9_COMPATIBILITY} from '../../../routes/story-preview-harlowe';

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
	const mainFrame = {frames: [] as any[], url};
	const cookies = {
		flushStore: jest.fn().mockResolvedValue(undefined),
		get: jest.fn().mockResolvedValue([]),
		remove: jest.fn().mockResolvedValue(undefined)
	};

	return {
		...events,
		isDestroyed: jest.fn(() => false),
		mainFrame,
		send: jest.fn(),
		session: {
			clearData: jest.fn().mockResolvedValue(undefined),
			cookies,
			on: jest.fn(),
			setPermissionCheckHandler: jest.fn(),
			setPermissionRequestHandler: jest.fn()
		},
		setWindowOpenHandler: jest.fn()
	} as unknown as WebContents &
		ReturnType<typeof emitter> & {
			isDestroyed: jest.Mock;
			mainFrame: {frames: any[]; url: string};
			send: jest.Mock;
			session: {
				clearData: jest.Mock;
				cookies: {
					flushStore: jest.Mock;
					get: jest.Mock;
					remove: jest.Mock;
				};
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
		admission: {kind: 'none'},
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

function exactSugarCubeBuild(version = '2.31.0') {
	const compatibility = SUGARCUBE_COMPATIBILITY.find(
		entry => entry.version === version
	);

	if (!compatibility) {
		throw new Error(`Missing SugarCube ${version} compatibility fixture.`);
	}
	const restartProfile = sugarCubeRestartProfileForAdapter(
		compatibility.adapterId
	);

	if (!restartProfile) {
		throw new Error(`Missing SugarCube ${version} Restart fixture.`);
	}

	return build({
		descriptor: descriptor({
			admission: {
				adapterId: compatibility.adapterId,
				format: 'SugarCube',
				kind: 'builtin-sha256',
				sourceSha256: compatibility.sourceSha256,
				version: compatibility.version
			}
		}),
		html: `<html><head></head><body><tw-storydata format="SugarCube" format-version="${version}"></tw-storydata><script id="script-sugarcube">${restartProfile.engineRestartSource};${restartProfile.startupFragment}</script></body></html>`
	});
}

function exactHarloweBuild(bridgeSessionId = 'bridge-1') {
	const raw = readFileSync(
		path.resolve('public/story-formats/harlowe-3.3.9/format.js'),
		'utf8'
	);
	let properties: {source?: unknown} | undefined;

	new Function('window', raw)({
		storyFormat(value: {source?: unknown}) {
			properties = value;
		}
	});
	if (typeof properties?.source !== 'string') {
		throw new Error('Bundled Harlowe fixture has no source.');
	}
	const storyData =
		'<tw-storydata name="Story" startnode="1" creator="twine.rs" creator-version="0.2.0" format="Harlowe" format-version="3.3.9" ifid="00000000-0000-4000-8000-000000000001" options="" tags="" zoom="1" hidden><style role="stylesheet" id="twine-user-stylesheet" type="text/twine-css"></style><script role="script" id="twine-user-script" type="text/twine-javascript"></script><tw-passagedata pid="1" name="Start" tags="" position="0,0" size="100,100">Story</tw-passagedata></tw-storydata>';

	return build({
		descriptor: descriptor({
			admission: {
				adapterId: HARLOWE_3_3_9_COMPATIBILITY.adapterId,
				format: 'Harlowe',
				kind: 'builtin-sha256',
				sourceSha256: HARLOWE_3_3_9_COMPATIBILITY.sourceSha256,
				version: HARLOWE_3_3_9_COMPATIBILITY.version
			},
			bridgeSessionId
		}),
		html: properties.source
			.replace(/{{STORY_NAME}}/g, 'Story')
			.replace(/{{STORY_DATA}}/g, storyData)
	});
}

async function flushPromises() {
	await Promise.resolve();
	await Promise.resolve();
	await Promise.resolve();
}

function testManager(
	options: {
		clearStateLeaseTimeoutMs?: number;
		linkMode?: 'block' | 'system';
		replacementTimeoutMs?: number;
	} = {}
) {
	const entryUrl = 'file:///app/story-preview.html';
	const windows: ReturnType<typeof fakeWindow>[] = [];
	const windowOptions: unknown[] = [];
	const staged: Array<{files: never[]; id: number}> = [];
	let nextStageGate: Promise<void> | undefined;
	const stagePackage = jest.fn(async (_html: string, _assets: unknown[]) => {
		void _html;
		void _assets;
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
	const registerStateCleanup = jest.fn(
		(url: string, operationId = 'clear') => ({
			operationId,
			url: url.replace(
				'/index.html',
				'/__twine-preview-clear-state/00000000-0000-4000-8000-000000000099'
			)
		})
	);
	const releaseStateCleanup = jest.fn();
	const releaseStagedPackage = jest.fn().mockResolvedValue(undefined);
	const openExternal = jest.fn().mockResolvedValue(undefined);
	const focusOwner = jest.fn();
	const writeClipboardText = jest.fn();
	const waitForFrameDetach = jest.fn().mockResolvedValue(undefined);
	let id = 0;
	const manager = createStoryPreviewWindowManager({
		clearStateLeaseTimeoutMs: options.clearStateLeaseTimeoutMs,
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
		registerStateCleanup,
		replacementTimeoutMs: options.replacementTimeoutMs,
		releasePackage,
		releaseStateCleanup,
		releaseStagedPackage,
		stagePackage: stagePackage as any,
		waitForFrameDetach,
		writeClipboardText
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
		registerStateCleanup,
		releasePackage,
		releaseStateCleanup,
		releaseStagedPackage,
		stagePackage,
		windowOptions,
		windows,
		waitForFrameDetach,
		writeClipboardText
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
	it('limits clipboard writes to the trusted live preview renderer', async () => {
		const harness = testManager();
		const {event, window} = await openReadyPreview(harness);
		const copy = harness.ipcHandlers.get(storyPreviewIpcChannels.copyText)!;

		expect(copy(event, ' \t\n')).toBeUndefined();
		expect(harness.writeClipboardText).toHaveBeenCalledWith(' \t\n');
		expect(() => copy(event, '')).toThrow('Runtime log text is invalid');
		expect(() => copy(event, 'x'.repeat(4 * 1024 * 1024 + 1))).toThrow(
			'Runtime log text is invalid'
		);
		const child = {...event, senderFrame: {url: harness.entryUrl}};
		expect(() => copy(child, 'x')).toThrow('Blocked preview IPC');
		const rogue = fakeWebContents(harness.entryUrl);
		expect(() =>
			copy({sender: rogue, senderFrame: rogue.mainFrame}, 'x')
		).toThrow('Unknown story preview renderer');
		window.webContents.mainFrame.url = 'file:///application/index.html';
		expect(() =>
			copy(
				{sender: window.webContents, senderFrame: window.webContents.mainFrame},
				'x'
			)
		).toThrow('Blocked preview IPC');
		harness.writeClipboardText.mockImplementationOnce(() => {
			throw new Error('clipboard unavailable');
		});
		window.webContents.mainFrame.url = harness.entryUrl;
		expect(() => copy(previewEvent(window, harness.entryUrl), 'x')).toThrow(
			'clipboard unavailable'
		);
	});
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

	it('clears only the exact current preview origin and path-scoped cookies', async () => {
		const harness = testManager();
		const {event, launch, window} = await openReadyPreview(harness);
		const hostname = new URL(launch.url).hostname;

		window.webContents.session.cookies.get.mockResolvedValue([
			{name: 'root', domain: hostname, path: '/'},
			{name: 'nested', domain: `.${hostname}`, path: '/nested'},
			{name: 'sibling', domain: `child.${hostname}`, path: '/'}
		]);
		const begin = harness.ipcHandlers.get(
			storyPreviewIpcChannels.beginClearState
		)!;
		const complete = harness.ipcHandlers.get(
			storyPreviewIpcChannels.completeClearState
		)!;
		const operation = await begin(event, 1);

		expect(harness.waitForFrameDetach).toHaveBeenCalledWith(
			window.webContents,
			launch.url,
			5000
		);
		expect(operation).toEqual({
			generation: 1,
			operationId: 'session-2',
			url: launch.url.replace(
				'/index.html',
				'/__twine-preview-clear-state/00000000-0000-4000-8000-000000000099'
			)
		});

		await complete(event, {
			generation: operation.generation,
			operationId: operation.operationId
		});
		expect(window.webContents.session.clearData).toHaveBeenCalledWith({
			dataTypes: [
				'backgroundFetch',
				'cache',
				'fileSystems',
				'indexedDB',
				'localStorage',
				'serviceWorkers',
				'webSQL'
			],
			originMatchingMode: 'origin-in-all-contexts',
			origins: [`twine-preview://${hostname}`]
		});
		expect(window.webContents.session.cookies.remove.mock.calls).toEqual([
			[`twine-preview://${hostname}/`, 'root'],
			[`twine-preview://${hostname}/nested`, 'nested']
		]);
		expect(window.webContents.session.cookies.flushStore).toHaveBeenCalledTimes(
			1
		);
		expect(
			harness.ipcHandlers.get(storyPreviewIpcChannels.getInitialState)!(event)
		).toEqual(launch);
		await expect(
			complete(event, {
				generation: operation.generation,
				operationId: operation.operationId
			})
		).rejects.toThrow('stale or unsolicited');
	});

	it('locks Clear State against commands and replacement until cancellation', async () => {
		const harness = testManager();
		const {event, launch, owner} = await openReadyPreview(harness);
		const begin = harness.ipcHandlers.get(
			storyPreviewIpcChannels.beginClearState
		)!;
		const cancel = harness.ipcHandlers.get(
			storyPreviewIpcChannels.cancelClearState
		)!;
		const command = harness.ipcHandlers.get(storyPreviewIpcChannels.command)!;
		const operation = await begin(event, 1);

		expect(command(event, {generation: 1, type: 'testFromStart'})).toEqual(
			expect.objectContaining({status: 'error'})
		);
		await expect(
			harness.manager.replace(owner, launch.descriptor.sessionId, 1, build())
		).rejects.toThrow('Clear State is already pending');

		cancel(event, {
			generation: operation.generation,
			operationId: operation.operationId
		});
		expect(harness.releaseStateCleanup).toHaveBeenCalledWith(operation.url);
		expect(command(event, {generation: 1, type: 'testFromStart'})).toEqual({
			command: 'testFromStart',
			generation: 1,
			status: 'busy'
		});
	});

	it('releases a pending Clear State begin when the preview shell reloads', async () => {
		const harness = testManager();
		const {event, launch, owner, window} = await openReadyPreview(harness);
		const begin = harness.ipcHandlers.get(
			storyPreviewIpcChannels.beginClearState
		)!;
		const cancel = harness.ipcHandlers.get(
			storyPreviewIpcChannels.cancelClearState
		)!;
		const command = harness.ipcHandlers.get(storyPreviewIpcChannels.command)!;

		harness.waitForFrameDetach.mockReturnValueOnce(
			new Promise<void>(() => undefined)
		);
		const beginning = begin(event, 1);
		const rejected = expect(beginning).rejects.toThrow(
			'preview shell reloaded'
		);

		await flushPromises();
		window.webContents.emit('did-start-navigation', {
			isMainFrame: true,
			isSameDocument: false
		});
		await rejected;
		expect(harness.releaseStateCleanup).not.toHaveBeenCalled();

		expect(command(event, {generation: 1, type: 'testFromStart'})).toEqual({
			command: 'testFromStart',
			generation: 1,
			status: 'busy'
		});
		harness.manager.completeCommand(owner, launch.descriptor.sessionId, {
			command: 'testFromStart',
			generation: 1,
			status: 'success'
		});

		const nextOperation = await begin(event, 1);

		cancel(event, nextOperation);
		expect(harness.releaseStateCleanup).toHaveBeenCalledTimes(1);
	});

	it('releases an acknowledged Clear State operation exactly once on shell reload', async () => {
		const harness = testManager();
		const {event, launch, owner, window} = await openReadyPreview(harness);
		const begin = harness.ipcHandlers.get(
			storyPreviewIpcChannels.beginClearState
		)!;
		const cancel = harness.ipcHandlers.get(
			storyPreviewIpcChannels.cancelClearState
		)!;
		const complete = harness.ipcHandlers.get(
			storyPreviewIpcChannels.completeClearState
		)!;
		const command = harness.ipcHandlers.get(storyPreviewIpcChannels.command)!;
		const operation = await begin(event, 1);

		window.webContents.emit('did-start-navigation', {
			isMainFrame: true,
			isSameDocument: false
		});
		expect(harness.releaseStateCleanup).toHaveBeenCalledTimes(1);
		expect(harness.releaseStateCleanup).toHaveBeenCalledWith(operation.url);

		expect(command(event, {generation: 1, type: 'testFromStart'})).toEqual({
			command: 'testFromStart',
			generation: 1,
			status: 'busy'
		});
		harness.manager.completeCommand(owner, launch.descriptor.sessionId, {
			command: 'testFromStart',
			generation: 1,
			status: 'success'
		});
		const replacing = harness.manager.replace(
			owner,
			launch.descriptor.sessionId,
			1,
			build({descriptor: descriptor({bridgeSessionId: 'bridge-2'})})
		);

		await flushPromises();
		await harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(
			event,
			2
		);
		await expect(replacing).resolves.toEqual(
			expect.objectContaining({
				descriptor: expect.objectContaining({generation: 2})
			})
		);
		const nextOperation = await begin(event, 2);

		await expect(complete(event, operation)).rejects.toThrow(
			'stale or unsolicited'
		);
		expect(harness.releaseStateCleanup).toHaveBeenCalledTimes(1);
		expect(command(event, {generation: 2, type: 'testFromStart'})).toEqual(
			expect.objectContaining({status: 'error'})
		);
		cancel(event, nextOperation);
		expect(harness.releaseStateCleanup).toHaveBeenCalledTimes(2);
	});

	it('expires the exact Clear State lease without disturbing a newer operation', async () => {
		jest.useFakeTimers();

		try {
			const harness = testManager({clearStateLeaseTimeoutMs: 10});
			const {event} = await openReadyPreview(harness);
			const begin = harness.ipcHandlers.get(
				storyPreviewIpcChannels.beginClearState
			)!;
			const cancel = harness.ipcHandlers.get(
				storyPreviewIpcChannels.cancelClearState
			)!;
			let finishOldDetach!: () => void;

			harness.waitForFrameDetach.mockReturnValueOnce(
				new Promise<void>(resolve => {
					finishOldDetach = resolve;
				})
			);
			const expired = begin(event, 1);
			const rejected = expect(expired).rejects.toThrow('lease expired');

			await flushPromises();
			jest.advanceTimersByTime(10);
			await rejected;
			const current = await begin(event, 1);

			finishOldDetach();
			await flushPromises();
			expect(harness.releaseStateCleanup).not.toHaveBeenCalled();
			cancel(event, current);
			expect(harness.releaseStateCleanup).toHaveBeenCalledTimes(1);
		} finally {
			jest.useRealTimers();
		}
	});

	it('releases an acknowledged Clear State operation exactly once on close', async () => {
		const harness = testManager();
		const {event, launch, owner, window} = await openReadyPreview(harness);
		const begin = harness.ipcHandlers.get(
			storyPreviewIpcChannels.beginClearState
		)!;
		const complete = harness.ipcHandlers.get(
			storyPreviewIpcChannels.completeClearState
		)!;
		const operation = await begin(event, 1);

		await harness.manager.close(owner, launch.descriptor.sessionId);
		expect(harness.releaseStateCleanup).toHaveBeenCalledTimes(1);
		expect(harness.releaseStateCleanup).toHaveBeenCalledWith(operation.url);
		window.webContents.emit('did-start-navigation', {
			isMainFrame: true,
			isSameDocument: false
		});
		await expect(complete(event, operation)).rejects.toThrow(
			'Unknown story preview renderer'
		);
		expect(harness.releaseStateCleanup).toHaveBeenCalledTimes(1);
	});

	it('rejects Clear State in Proof and releases its lock after detach failure', async () => {
		const proofHarness = testManager();
		const proof = await openReadyPreview(
			proofHarness,
			undefined,
			build({descriptor: descriptor({target: 'proof'})})
		);
		await expect(
			proofHarness.ipcHandlers.get(storyPreviewIpcChannels.beginClearState)!(
				proof.event,
				1
			)
		).rejects.toThrow('unavailable in Proof');

		const harness = testManager();
		const preview = await openReadyPreview(harness);
		harness.waitForFrameDetach.mockRejectedValueOnce(
			new Error('detach timeout')
		);
		const begin = harness.ipcHandlers.get(
			storyPreviewIpcChannels.beginClearState
		)!;
		await expect(begin(preview.event, 1)).rejects.toThrow('detach timeout');
		await expect(begin(preview.event, 1)).resolves.toEqual(
			expect.objectContaining({generation: 1})
		);
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

	it('blocks exact Harlowe native document navigation and rolls back a candidate', async () => {
		const harness = testManager();
		const preview = await openReadyPreview(
			harness,
			undefined,
			exactHarloweBuild()
		);
		const replacing = harness.manager.replace(
			preview.owner,
			preview.launch.descriptor.sessionId,
			1,
			exactHarloweBuild('bridge-2')
		);

		await flushPromises();
		const replacement = preview.window.webContents.send.mock.calls.findLast(
			([channel]) => channel === storyPreviewIpcChannels.replacement
		)?.[1].replacement;

		expect(replacement.descriptor.admission).toEqual(
			exactHarloweBuild('bridge-2').descriptor.admission
		);
		const navigate = preview.window.webContents.listeners.get(
			'will-frame-navigate'
		)![0];
		const candidateFrame = {
			parent: preview.window.webContents.mainFrame,
			url: replacement.url
		};
		const navigation = {
			frame: candidateFrame,
			isMainFrame: false,
			isSameDocument: false,
			preventDefault: jest.fn(),
			url: replacement.url
		};
		const rejected = expect(replacing).rejects.toThrow(
			'native document navigation'
		);

		navigate(navigation);
		expect(navigation.preventDefault).toHaveBeenCalledTimes(1);
		await rejected;
		expect(harness.releasePackage).toHaveBeenCalledWith(replacement.url);
		await expect(
			harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(
				preview.event,
				2
			)
		).rejects.toThrow('stale generation');
		expect(
			harness.ipcHandlers.get(storyPreviewIpcChannels.getInitialState)!(
				preview.event
			)
		).toMatchObject({descriptor: {generation: 1}, url: preview.launch.url});
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

	it('derives exact Restart eligibility from the HTML main stages', async () => {
		const harness = testManager();
		const initialBuild = exactSugarCubeBuild();
		const preview = await openReadyPreview(harness, undefined, initialBuild);
		const compatibility = SUGARCUBE_COMPATIBILITY[0];
		const restartProfile = sugarCubeRestartProfileForAdapter(
			compatibility.adapterId
		)!;
		const stagedInitialHtml = harness.stagePackage.mock.calls[0][0] as string;

		expect(preview.launch.descriptor.sugarCubeRestartEligible).toBe(true);
		expect(preview.launch.descriptor.admission).toEqual(
			initialBuild.descriptor.admission
		);
		expect(stagedInitialHtml).toContain('bridge-1');
		expect(stagedInitialHtml).toContain(restartProfile.startupReplacement);
		expect(stagedInitialHtml).not.toContain(restartProfile.startupFragment);
		const mismatchedReplacement = exactSugarCubeBuild();

		const replacing = harness.manager.replace(
			preview.owner,
			preview.launch.descriptor.sessionId,
			1,
			build({
				descriptor: mismatchedReplacement.descriptor,
				html: mismatchedReplacement.html.replace(
					'format-version="2.31.0"',
					'format-version="2.37.3"'
				)
			})
		);

		await flushPromises();
		const replacement = preview.window.webContents.send.mock.calls.findLast(
			([channel]) => channel === storyPreviewIpcChannels.replacement
		)?.[1];

		expect(replacement.replacement.descriptor.sugarCubeRestartEligible).toBe(
			false
		);
		expect(replacement.replacement.descriptor.admission).toEqual({
			kind: 'none'
		});
		expect(harness.stagePackage.mock.calls[1][0]).toContain('bridge-1');
		expect(harness.stagePackage.mock.calls[1][0]).toContain(
			'ENABLE_SUGARCUBE_RESTART = false'
		);
		expect(harness.stagePackage.mock.calls[1][0]).not.toContain(
			restartProfile.startupReplacement
		);
		await harness.ipcHandlers.get(storyPreviewIpcChannels.frameLoaded)!(
			preview.event,
			2
		);
		await expect(replacing).resolves.toMatchObject({
			descriptor: {
				admission: {kind: 'none'},
				sugarCubeRestartEligible: false
			}
		});

		await expect(
			harness.manager.open(
				fakeWebContents('file:///app/index.html'),
				build({
					descriptor: {
						...descriptor(),
						sugarCubeRestartEligible: true
					} as never
				})
			)
		).rejects.toThrow('descriptor');
	});

	it.each([
		[
			'a different version',
			(html: string) =>
				html.replace('format-version="2.31.0"', 'format-version="2.37.3"')
		],
		[
			'a duplicate',
			(html: string) =>
				html.replace(
					'</tw-storydata>',
					'</tw-storydata><tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata>'
				)
		],
		[
			'no',
			(html: string) =>
				html.replace(
					'<tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata>',
					''
				)
		],
		[
			'only an inert template',
			(html: string) =>
				html.replace(
					'<tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata>',
					'<template><tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata></template>'
				)
		],
		[
			'only a scripted noscript',
			(html: string) =>
				html.replace(
					'<tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata>',
					'<noscript><tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata></noscript>'
				)
		],
		[
			'only a frameset child',
			(html: string) =>
				html.replace(
					'<body><tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata>',
					'<frameset><tw-storydata format="SugarCube" format-version="2.31.0"></tw-storydata></frameset>'
				)
		]
	] as const)(
		'downgrades exact admission before staging initial HTML with %s structural tuple',
		async (_label, transformHtml) => {
			const harness = testManager();
			const exactBuild = exactSugarCubeBuild();
			const preview = await openReadyPreview(
				harness,
				undefined,
				build({
					descriptor: exactBuild.descriptor,
					html: transformHtml(exactBuild.html)
				})
			);
			const restartProfile = sugarCubeRestartProfileForAdapter(
				SUGARCUBE_COMPATIBILITY[0].adapterId
			)!;
			const stagedHtml = harness.stagePackage.mock.calls[0][0] as string;

			expect(preview.launch.descriptor).toMatchObject({
				admission: {kind: 'none'},
				sugarCubeRestartEligible: false
			});
			expect(stagedHtml).toContain('ENABLE_SUGARCUBE_RESTART = false');
			expect(stagedHtml).not.toContain(restartProfile.startupReplacement);
		}
	);

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
