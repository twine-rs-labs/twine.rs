import {randomUUID} from 'crypto';
import path from 'path';
import {
	app,
	BrowserWindow,
	clipboard,
	ipcMain,
	type BrowserWindowConstructorOptions,
	type IpcMain,
	type Session,
	type WebContents
} from 'electron';
import type {
	NativeStoryPreviewAppearance,
	NativeStoryPreviewAppearanceUpdate,
	NativeStoryPreviewClearStateOperation,
	NativeStoryPreviewCommand,
	NativeStoryPreviewCommandResult,
	NativeStoryPreviewDescriptor,
	NativeStoryPreviewDescriptorInput,
	NativeStoryPreviewOwnerCommand,
	NativeStoryPreviewReplacement,
	NativeStoryPreviewReplacementResult
} from '../shared/electron-shared.types';
import {storyPreviewIpcChannels} from '../preview-ipc-channels';
import {openExternalUrl, validatedExternalUrl} from './external-url';
import {linkHandlingMode} from './platform-settings';
import {
	previewIpcRegistrar,
	previewRendererEntryUrl
} from './preview-ipc-security';
import {
	type ScratchFileAsset,
	releaseScratchPreviewPackage,
	stageScratchPreviewPackage
} from './scratch-file';
import {
	registerStoryPreviewPackage,
	registerStoryPreviewStateCleanup,
	releaseStoryPreviewPackage,
	releaseStoryPreviewStateCleanup
} from './story-preview-protocol';
import {canonicalPreviewFormatAdmission} from '../../routes/story-preview-format';
import {instrumentPreviewHtml} from '../../routes/story-preview-contract';
import {
	backgroundWindowForE2E,
	showWindowWhenReady,
	shouldFocusOwnerWindow
} from './window-activation';

export const maxManagedStoryPreviewWindows = 32;
export const storyPreviewReadyTimeoutMs = 15_000;
export const storyPreviewReplacementTimeoutMs = 15_000;
export const storyPreviewClearStateTimeoutMs = 5_000;
export const storyPreviewClearStateLeaseTimeoutMs = 30_000;
export const maxStoryPreviewPendingCommands = 32;
export const storyPreviewOwnerCommandLeaseTimeoutMs = 15_000;
export const maxStoryPreviewDescriptorBytes = 64 * 1024 * 1024;
export const maxStoryPreviewPassages = 100_000;

const maxIdentifierLength = 256;
const maxStoryNameLength = 1024;
const previewWindowWidth = 1120;
const previewWindowHeight = 800;
const storySummaryCountFields = [
	'assetCount',
	'characterCount',
	'diagnosticCount',
	'errorCount',
	'missingAssetCount',
	'passageCount',
	'revision',
	'tagCount',
	'warningCount',
	'wordCount'
] as const;
const storySummaryGraphCountFields = [
	'brokenLinks',
	'emptyPassages',
	'links',
	'orphanPassages',
	'passages',
	'resolvedLinks',
	'selfLinks',
	'taggedPassages',
	'unreachablePassages'
] as const;
const storyPreviewDescriptorFields = [
	'admission',
	'appearance',
	'bridgeSessionId',
	'htmlBytes',
	'launchPassage',
	'passages',
	'storyDataCount',
	'storyId',
	'storyName',
	'summary',
	'target'
] as const;
const storySummaryFields = [
	...storySummaryCountFields,
	'graph',
	'storyId'
] as const;

export interface ManagedStoryPreviewBuild {
	assets?: ScratchFileAsset[];
	descriptor: NativeStoryPreviewDescriptorInput;
	html: string;
}

export interface ManagedStoryPreviewLaunch {
	descriptor: NativeStoryPreviewDescriptor;
	url: string;
}

interface PreviewWindowLike {
	destroy?(): void;
	focus?(): void;
	isDestroyed?(): boolean;
	loadURL(url: string): Promise<void> | void;
	once(event: string, listener: (...args: any[]) => void): unknown;
	show(): void;
	webContents: WebContents;
}

interface Deferred<T> {
	promise: Promise<T>;
	reject(error: Error): void;
	resolve(value: T): void;
	settled(): boolean;
}

interface PreviewGeneration {
	descriptor: NativeStoryPreviewDescriptor;
	url: string;
}

interface PreviewCandidate extends PreviewGeneration {
	commandDispatchId?: string;
	completion: Deferred<ManagedStoryPreviewLaunch>;
	timeout: ReturnType<typeof setTimeout>;
}

interface PreviewClearStateOperation {
	abort: Deferred<void>;
	cleanupUrl?: string;
	generation: number;
	id: string;
	timeout?: ReturnType<typeof setTimeout>;
	url: string;
}

interface PreviewSession {
	candidate?: PreviewCandidate;
	clearState?: PreviewClearStateOperation;
	closed: boolean;
	current: PreviewGeneration;
	id: string;
	initialFrameLoaded: boolean;
	owner: WebContents;
	pendingCommands: Map<
		string,
		{
			accepted: boolean;
			deadline: number;
			dispatchId: string;
			generation: number;
			requestId: string;
			timeout?: ReturnType<typeof setTimeout>;
			type: NativeStoryPreviewCommand['type'];
		}
	>;
	ready: Deferred<void>;
	readyTimeout: ReturnType<typeof setTimeout>;
	replacing: boolean;
	shellReady: boolean;
	window: PreviewWindowLike;
}

interface OwnerState {
	appearance?: NativeStoryPreviewAppearance;
	destroyed: () => void;
	navigation: (...args: any[]) => void;
	processGone: () => void;
	sessions: Set<PreviewSession>;
}

interface PreviewIpcEvent {
	sender: WebContents;
}

interface StoryPreviewWindowManagerDependencies {
	createWindow(options: BrowserWindowConstructorOptions): PreviewWindowLike;
	focusOwner(owner: WebContents): void;
	linkMode(): 'block' | 'system';
	openExternal(url: string): Promise<void>;
	previewEntryUrl(): string;
	randomId(): string;
	registerPackage: typeof registerStoryPreviewPackage;
	registerStateCleanup: typeof registerStoryPreviewStateCleanup;
	releasePackage: typeof releaseStoryPreviewPackage;
	releaseStateCleanup: typeof releaseStoryPreviewStateCleanup;
	releaseStagedPackage: typeof releaseScratchPreviewPackage;
	stagePackage: typeof stageScratchPreviewPackage;
	waitForFrameDetach(
		contents: WebContents,
		url: string,
		timeoutMs: number
	): Promise<void>;
	writeClipboardText(text: string): void;
}

export interface StoryPreviewWindowManagerOptions extends Partial<StoryPreviewWindowManagerDependencies> {
	clearStateLeaseTimeoutMs?: number;
	ownerCommandLeaseTimeoutMs?: number;
	readyTimeoutMs?: number;
	replacementTimeoutMs?: number;
}

function deferred<T>(): Deferred<T> {
	let isSettled = false;
	let rejectPromise!: (error: Error) => void;
	let resolvePromise!: (value: T) => void;
	const promise = new Promise<T>((resolve, reject) => {
		rejectPromise = reject;
		resolvePromise = resolve;
	});

	// Lifecycle events may reject a candidate just before its caller begins
	// awaiting it. Keep that expected race from becoming an unhandled rejection.
	void promise.catch(() => undefined);

	return {
		promise,
		reject(error) {
			if (!isSettled) {
				isSettled = true;
				rejectPromise(error);
			}
		},
		resolve(value) {
			if (!isSettled) {
				isSettled = true;
				resolvePromise(value);
			}
		},
		settled() {
			return isSettled;
		}
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);

	return prototype === Object.prototype || prototype === null;
}

function isPlainSerializable(
	value: unknown,
	seen = new Set<object>()
): boolean {
	if (
		value === null ||
		value === undefined ||
		typeof value === 'string' ||
		typeof value === 'boolean'
	) {
		return true;
	}
	if (typeof value === 'number') {
		return Number.isFinite(value);
	}
	if (typeof value !== 'object' || seen.has(value)) {
		return false;
	}

	seen.add(value);
	const valid = Array.isArray(value)
		? value.every(item => isPlainSerializable(item, seen))
		: isRecord(value) &&
			Object.values(value).every(item => isPlainSerializable(item, seen));

	seen.delete(value);
	return valid;
}

function validString(
	value: unknown,
	maxLength = maxIdentifierLength
): value is string {
	return (
		typeof value === 'string' && value.length > 0 && value.length <= maxLength
	);
}

function validNonnegativeInteger(value: unknown) {
	return Number.isSafeInteger(value) && (value as number) >= 0;
}

function hasOnlyFields(
	value: Record<string, unknown>,
	fields: readonly string[]
) {
	const allowedFields = new Set(fields);

	return Object.keys(value).every(field => allowedFields.has(field));
}

function validAppearance(
	value: unknown
): value is NativeStoryPreviewAppearance {
	return (
		isRecord(value) &&
		hasOnlyFields(value, ['highContrast', 'reducedMotion', 'theme']) &&
		(value.theme === 'dark' || value.theme === 'light') &&
		typeof value.highContrast === 'boolean' &&
		typeof value.reducedMotion === 'boolean'
	);
}

function validStorySummary(value: unknown, storyId: string) {
	if (
		!isRecord(value) ||
		!hasOnlyFields(value, storySummaryFields) ||
		value.storyId !== storyId ||
		!isRecord(value.graph) ||
		!hasOnlyFields(value.graph, storySummaryGraphCountFields)
	) {
		return false;
	}
	const graph = value.graph;

	return (
		storySummaryCountFields.every(field =>
			validNonnegativeInteger(value[field])
		) &&
		storySummaryGraphCountFields.every(field =>
			validNonnegativeInteger(graph[field])
		)
	);
}

function cloneAndValidateDescriptor(
	input: NativeStoryPreviewDescriptorInput,
	sessionId: string,
	generation: number
): NativeStoryPreviewDescriptor {
	if (!isRecord(input)) {
		throw new Error('Story preview descriptor is invalid.');
	}

	try {
		if (!isPlainSerializable(input)) {
			throw new Error();
		}
	} catch {
		throw new Error('Story preview descriptor must be serializable.');
	}

	if (
		!hasOnlyFields(input, storyPreviewDescriptorFields) ||
		!validString(input.storyId) ||
		!validString(input.storyName, maxStoryNameLength) ||
		!validString(input.bridgeSessionId) ||
		!validAppearance(input.appearance) ||
		!['play', 'proof', 'test'].includes(input.target) ||
		!validNonnegativeInteger(input.htmlBytes) ||
		!validNonnegativeInteger(input.storyDataCount) ||
		!Array.isArray(input.passages) ||
		input.passages.length > maxStoryPreviewPassages ||
		(input.summary !== undefined &&
			!validStorySummary(input.summary, input.storyId))
	) {
		throw new Error(
			'Story preview descriptor is invalid or exceeds its limit.'
		);
	}
	const admission = canonicalPreviewFormatAdmission(input.admission);

	if (!admission) {
		throw new Error('Story preview format admission is invalid.');
	}

	const passageIds = new Set<string>();
	const localIds = new Set<string>();

	for (const passage of input.passages) {
		if (
			!isRecord(passage) ||
			!hasOnlyFields(passage, ['id', 'localId', 'name']) ||
			!validString(passage.id) ||
			!validString(passage.localId) ||
			!validString(passage.name, maxStoryNameLength) ||
			passageIds.has(passage.id) ||
			localIds.has(passage.localId)
		) {
			throw new Error('Story preview passage metadata is invalid.');
		}
		passageIds.add(passage.id);
		localIds.add(passage.localId);
	}

	if (
		input.launchPassage !== undefined &&
		(!isRecord(input.launchPassage) ||
			!hasOnlyFields(input.launchPassage, ['id', 'name']) ||
			!validString(input.launchPassage.id) ||
			!validString(input.launchPassage.name, maxStoryNameLength) ||
			!passageIds.has(input.launchPassage.id))
	) {
		throw new Error('Story preview launch passage is invalid.');
	}

	const descriptor: NativeStoryPreviewDescriptor = {
		admission,
		appearance: {
			highContrast: input.appearance.highContrast,
			reducedMotion: input.appearance.reducedMotion,
			theme: input.appearance.theme
		},
		bridgeSessionId: input.bridgeSessionId,
		generation,
		htmlBytes: input.htmlBytes,
		...(input.launchPassage
			? {
					launchPassage: {
						id: input.launchPassage.id,
						name: input.launchPassage.name
					}
				}
			: {}),
		passages: input.passages.map(passage => ({
			id: passage.id,
			localId: passage.localId,
			name: passage.name
		})),
		sessionId,
		storyDataCount: input.storyDataCount,
		storyId: input.storyId,
		storyName: input.storyName,
		sugarCubeRestartEligible: false,
		...(input.summary
			? {
					summary: {
						assetCount: input.summary.assetCount,
						characterCount: input.summary.characterCount,
						diagnosticCount: input.summary.diagnosticCount,
						errorCount: input.summary.errorCount,
						graph: {
							brokenLinks: input.summary.graph.brokenLinks,
							emptyPassages: input.summary.graph.emptyPassages,
							links: input.summary.graph.links,
							orphanPassages: input.summary.graph.orphanPassages,
							passages: input.summary.graph.passages,
							resolvedLinks: input.summary.graph.resolvedLinks,
							selfLinks: input.summary.graph.selfLinks,
							taggedPassages: input.summary.graph.taggedPassages,
							unreachablePassages: input.summary.graph.unreachablePassages
						},
						missingAssetCount: input.summary.missingAssetCount,
						passageCount: input.summary.passageCount,
						revision: input.summary.revision,
						storyId: input.summary.storyId,
						tagCount: input.summary.tagCount,
						warningCount: input.summary.warningCount,
						wordCount: input.summary.wordCount
					}
				}
			: {}),
		target: input.target
	};
	let encoded: string;

	try {
		encoded = JSON.stringify(descriptor);
	} catch {
		throw new Error('Story preview descriptor must be serializable.');
	}

	if (Buffer.byteLength(encoded, 'utf8') > maxStoryPreviewDescriptorBytes) {
		throw new Error('Story preview descriptor exceeds the safe byte limit.');
	}

	return descriptor;
}

function commandKey(
	command: Pick<NativeStoryPreviewOwnerCommand, 'dispatchId'>
) {
	return command.dispatchId;
}

function commandError(
	command: Pick<NativeStoryPreviewCommand, 'generation' | 'type' | 'requestId'>,
	message: string
): NativeStoryPreviewCommandResult {
	return {
		command: command.type,
		generation: command.generation,
		requestId: command.requestId,
		message,
		operation: 'command',
		status: 'error'
	};
}

function validateCommand(
	value: unknown,
	session: PreviewSession
): {
	command: NativeStoryPreviewCommand;
	passageId?: string;
} {
	if (
		!isRecord(value) ||
		!validNonnegativeInteger(value.generation) ||
		!['revealGraph', 'revealSource', 'testCurrent', 'testFromStart'].includes(
			value.type as string
		)
	) {
		throw new Error('Story preview command is invalid.');
	}

	const generation = value.generation as number;
	const type = value.type as NativeStoryPreviewCommand['type'];
	if (!validString(value.requestId, 128)) {
		throw new Error('Story preview command request is invalid.');
	}
	const requestId = value.requestId as string;

	if (generation !== session.current.descriptor.generation) {
		throw new Error('Story preview command belongs to a stale generation.');
	}

	const knownPassages = new Set(
		session.current.descriptor.passages.map(passage => passage.id)
	);
	let passageId: string | undefined;

	if (type === 'testFromStart') {
		if (value.passageId !== undefined) {
			throw new Error('Test From Start does not accept a preview passage.');
		}
		passageId = session.current.descriptor.launchPassage?.id;
		return {
			command: {generation, requestId, type},
			passageId
		};
	}

	if (value.passageId !== undefined && !validString(value.passageId)) {
		throw new Error('Story preview command passage is invalid.');
	}
	passageId =
		(value.passageId as string | undefined) ??
		session.current.descriptor.launchPassage?.id;

	if (type === 'testCurrent' && !passageId) {
		throw new Error('Test Current requires a known passage.');
	}
	if (passageId && !knownPassages.has(passageId)) {
		throw new Error('Story preview command passage is unknown.');
	}

	return {
		command:
			type === 'testCurrent'
				? {generation, passageId: passageId!, requestId, type}
				: {generation, passageId, requestId, type},
		passageId
	};
}

function sameOrigin(left: string, right: string) {
	try {
		const leftUrl = new URL(left);
		const rightUrl = new URL(right);

		// Node's URL implementation reports "null" for custom-scheme origins.
		// Compare the tuple explicitly so separate preview tokens never collapse
		// into the same apparent origin.
		return (
			leftUrl.protocol === rightUrl.protocol &&
			leftUrl.hostname === rightUrl.hostname &&
			leftUrl.port === rightUrl.port &&
			leftUrl.username === rightUrl.username &&
			leftUrl.password === rightUrl.password
		);
	} catch {
		return false;
	}
}

function storyPreviewOrigin(url: string) {
	let parsed: URL;

	try {
		parsed = new URL(url);
	} catch {
		throw new Error('Story preview origin is invalid.');
	}

	if (
		parsed.protocol !== 'twine-preview:' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
			parsed.hostname
		) ||
		parsed.username !== '' ||
		parsed.password !== '' ||
		parsed.port !== ''
	) {
		throw new Error('Story preview origin is invalid.');
	}

	return {
		hostname: parsed.hostname.toLowerCase(),
		origin: `twine-preview://${parsed.hostname.toLowerCase()}`
	};
}

export async function waitForStoryPreviewFrameDetach(
	contents: WebContents,
	url: string,
	timeoutMs: number
) {
	const startedAt = Date.now();

	while (true) {
		if (contents.isDestroyed()) {
			throw new Error('Story preview closed while detaching its story frame.');
		}

		const mainFrame = contents.mainFrame;
		const hasLiveStoryFrame = (mainFrame.frames ?? []).some(
			frame =>
				frame.parent === mainFrame &&
				frame.detached !== true &&
				sameOrigin(frame.url, url)
		);

		if (!hasLiveStoryFrame) {
			return;
		}
		if (Date.now() - startedAt >= timeoutMs) {
			throw new Error('Story preview frame did not detach in time.');
		}

		await new Promise(resolve => setTimeout(resolve, 25));
	}
}

async function clearStoryPreviewOriginData(
	session: Session,
	url: string,
	revalidate: () => void
) {
	const {hostname, origin} = storyPreviewOrigin(url);

	await session.clearData({
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
		origins: [origin]
	});
	revalidate();

	const cookies = await session.cookies.get({domain: hostname});
	revalidate();

	for (const cookie of cookies) {
		const normalizedDomain = (cookie.domain ?? '')
			.replace(/^\./, '')
			.toLowerCase();

		if (normalizedDomain !== hostname) {
			continue;
		}

		const cookiePath = cookie.path?.startsWith('/')
			? cookie.path
			: `/${cookie.path ?? ''}`;

		await session.cookies.remove(`${origin}${cookiePath}`, cookie.name);
		revalidate();
	}

	await session.cookies.flushStore();
	revalidate();
}

function mainNavigationStarted(args: any[]) {
	const details = args[0];

	if (details && typeof details === 'object' && 'isMainFrame' in details) {
		return details.isMainFrame === true && details.isSameDocument !== true;
	}

	// Deprecated Electron listener parameters:
	// event, url, isInPlace, isMainFrame, ...
	return args[3] === true && args[2] !== true;
}

export function createStoryPreviewWindowManager(
	options: StoryPreviewWindowManagerOptions = {}
) {
	const dependencies: StoryPreviewWindowManagerDependencies = {
		createWindow: config => new BrowserWindow(config),
		focusOwner: owner => BrowserWindow.fromWebContents(owner)?.focus(),
		linkMode: linkHandlingMode,
		openExternal: openExternalUrl,
		previewEntryUrl: previewRendererEntryUrl,
		randomId: randomUUID,
		registerPackage: registerStoryPreviewPackage,
		registerStateCleanup: registerStoryPreviewStateCleanup,
		releasePackage: releaseStoryPreviewPackage,
		releaseStateCleanup: releaseStoryPreviewStateCleanup,
		releaseStagedPackage: releaseScratchPreviewPackage,
		stagePackage: stageScratchPreviewPackage,
		waitForFrameDetach: waitForStoryPreviewFrameDetach,
		writeClipboardText: text => clipboard.writeText(text),
		...options
	};
	const readyTimeoutMs = options.readyTimeoutMs ?? storyPreviewReadyTimeoutMs;
	const replacementTimeoutMs =
		options.replacementTimeoutMs ?? storyPreviewReplacementTimeoutMs;
	const clearStateLeaseTimeoutMs =
		options.clearStateLeaseTimeoutMs ?? storyPreviewClearStateLeaseTimeoutMs;
	const ownerCommandLeaseTimeoutMs =
		options.ownerCommandLeaseTimeoutMs ??
		storyPreviewOwnerCommandLeaseTimeoutMs;
	const sessionsById = new Map<string, PreviewSession>();
	const sessionsByPreview = new Map<WebContents, PreviewSession>();
	const owners = new Map<WebContents, OwnerState>();
	let ipcInitialized = false;
	let pendingLaunches = 0;
	let shuttingDown = false;

	function assertOwner(owner: WebContents, sessionId: string) {
		const session = sessionsById.get(sessionId);

		if (!session || session.closed || session.owner !== owner) {
			throw new Error('Unknown or unowned story preview session.');
		}

		return session;
	}

	function cancelOwnerCommand(
		session: PreviewSession,
		pending: PreviewSession['pendingCommands'] extends Map<string, infer T>
			? T
			: never,
		message: string
	) {
		const candidate = session.candidate;

		if (candidate?.commandDispatchId === pending.dispatchId) {
			void rollbackCandidate(session, candidate, new Error(message));
		}
		if (!session.owner.isDestroyed()) {
			try {
				session.owner.send(storyPreviewIpcChannels.ownerCommandCancellation, {
					command: pending.type,
					dispatchId: pending.dispatchId,
					generation: pending.generation,
					message,
					requestId: pending.requestId,
					sessionId: session.id
				});
			} catch {
				// Owner teardown must not prevent preview-session cleanup.
			}
		}
	}

	function expireOwnerCommand(
		session: PreviewSession,
		key: string,
		pending: PreviewSession['pendingCommands'] extends Map<string, infer T>
			? T
			: never
	) {
		if (session.pendingCommands.get(key) !== pending) return false;
		const message =
			'The story preview owner did not complete the command in time.';
		if (pending.timeout) clearTimeout(pending.timeout);
		cancelOwnerCommand(session, pending, message);
		session.pendingCommands.delete(key);
		session.window.webContents.send(
			storyPreviewIpcChannels.commandResult,
			commandError(
				{
					generation: pending.generation,
					requestId: pending.requestId,
					type: pending.type
				},
				message
			)
		);
		return true;
	}

	function isOwnerCommandLive(
		session: PreviewSession,
		key: string,
		pending: PreviewSession['pendingCommands'] extends Map<string, infer T>
			? T
			: never
	) {
		if (Date.now() < pending.deadline) return true;
		expireOwnerCommand(session, key, pending);
		return false;
	}

	function sessionForPreview(event: PreviewIpcEvent) {
		const session = sessionsByPreview.get(event.sender);

		if (
			!session ||
			session.closed ||
			session.window.webContents !== event.sender
		) {
			throw new Error('Unknown story preview renderer.');
		}

		return session;
	}

	function removeOwnerStateIfEmpty(owner: WebContents) {
		const ownerState = owners.get(owner);

		if (
			!ownerState ||
			ownerState.sessions.size > 0 ||
			ownerState.appearance !== undefined
		) {
			return;
		}

		owner.removeListener('destroyed', ownerState.destroyed);
		owner.removeListener('render-process-gone', ownerState.processGone);
		owner.removeListener('did-start-navigation', ownerState.navigation);
		owners.delete(owner);
	}

	async function releaseUrl(url: string) {
		try {
			await dependencies.releasePackage(url);
		} catch (error) {
			console.warn('Could not release a story preview package.', error);
		}
	}

	function finalizeClearStateOperation(
		session: PreviewSession,
		operation: PreviewClearStateOperation,
		reason: Error
	) {
		if (session.clearState !== operation) {
			return false;
		}

		session.clearState = undefined;
		if (operation.timeout) {
			clearTimeout(operation.timeout);
			operation.timeout = undefined;
		}
		if (operation.cleanupUrl) {
			dependencies.releaseStateCleanup(operation.cleanupUrl);
			operation.cleanupUrl = undefined;
		}
		operation.abort.reject(reason);
		return true;
	}

	async function closeSession(
		session: PreviewSession,
		destroyWindow: boolean,
		reason = new Error('Story preview session closed.')
	) {
		if (session.closed) {
			return;
		}

		session.closed = true;
		clearTimeout(session.readyTimeout);
		session.ready.reject(reason);
		sessionsById.delete(session.id);
		sessionsByPreview.delete(session.window.webContents);
		const ownerState = owners.get(session.owner);

		ownerState?.sessions.delete(session);
		removeOwnerStateIfEmpty(session.owner);

		const urls = [session.current.url];

		if (session.candidate) {
			clearTimeout(session.candidate.timeout);
			session.candidate.completion.reject(reason);
			urls.push(session.candidate.url);
			session.candidate = undefined;
		}
		if (session.clearState) {
			finalizeClearStateOperation(session, session.clearState, reason);
		}

		for (const pending of session.pendingCommands.values()) {
			if (pending.timeout) clearTimeout(pending.timeout);
			cancelOwnerCommand(session, pending, reason.message);
		}
		session.pendingCommands.clear();
		if (
			destroyWindow &&
			!session.window.isDestroyed?.() &&
			session.window.destroy
		) {
			try {
				session.window.destroy();
			} catch (error) {
				console.warn('Could not destroy a story preview window.', error);
			}
		}
		await Promise.all(urls.map(releaseUrl));
	}

	function closeOwnerSessions(owner: WebContents, reason: Error) {
		const sessions = [...(owners.get(owner)?.sessions ?? [])];

		for (const session of sessions) {
			void closeSession(session, true, reason);
		}
	}

	function clearOwner(owner: WebContents, reason: Error) {
		const state = owners.get(owner);

		if (!state) {
			return;
		}

		state.appearance = undefined;
		closeOwnerSessions(owner, reason);
		removeOwnerStateIfEmpty(owner);
	}

	function ensureOwnerState(owner: WebContents) {
		let state = owners.get(owner);

		if (!state) {
			const destroyed = () =>
				clearOwner(
					owner,
					new Error('The owning editor renderer was destroyed.')
				);
			const processGone = () =>
				clearOwner(owner, new Error('The owning editor crashed.'));
			const navigation = (...args: any[]) => {
				if (mainNavigationStarted(args)) {
					clearOwner(owner, new Error('The owning editor renderer reloaded.'));
				}
			};

			state = {
				destroyed,
				navigation,
				processGone,
				sessions: new Set()
			};
			owners.set(owner, state);
			owner.once('destroyed', destroyed);
			owner.on('render-process-gone', processGone);
			owner.on('did-start-navigation', navigation);
		}

		return state;
	}

	function captureOwner(owner: WebContents, session: PreviewSession) {
		ensureOwnerState(owner).sessions.add(session);
	}

	function mergeLatestOwnerAppearance(
		owner: WebContents,
		generation: PreviewGeneration
	) {
		const appearance = owners.get(owner)?.appearance;

		if (appearance) {
			generation.descriptor.appearance = {...appearance};
		}
	}

	function maybeOpenExternal(url: string) {
		if (dependencies.linkMode() !== 'system') {
			return;
		}

		let externalUrl: string;

		try {
			externalUrl = validatedExternalUrl(url);
		} catch {
			return;
		}

		void dependencies.openExternal(externalUrl).catch(error => {
			console.warn('Blocked or failed to open a preview link.', error);
		});
	}

	function allowsPackageNavigation(session: PreviewSession, url: string) {
		return (
			sameOrigin(url, session.current.url) ||
			(session.candidate ? sameOrigin(url, session.candidate.url) : false)
		);
	}

	function exactHarloweGenerationForFrame(
		session: PreviewSession,
		frameUrl: string | undefined
	) {
		if (!frameUrl) return undefined;
		const generation =
			session.candidate && sameOrigin(frameUrl, session.candidate.url)
				? session.candidate
				: sameOrigin(frameUrl, session.current.url)
					? session.current
					: undefined;
		const admission = generation?.descriptor.admission;

		return admission?.kind === 'builtin-sha256' &&
			admission.format === 'Harlowe'
			? generation
			: undefined;
	}

	function installWindowPolicy(session: PreviewSession) {
		const contents = session.window.webContents;

		contents.on('will-attach-webview', event => event.preventDefault());
		contents.on('will-frame-navigate', details => {
			if (details.isMainFrame) {
				if (details.url !== dependencies.previewEntryUrl()) {
					details.preventDefault();
					maybeOpenExternal(details.url);
				}
				return;
			}

			// Restrict only the direct app-owned story iframe. Descendant frames
			// remain browser-compatible for HTTPS embeds.
			if (details.frame?.parent === contents.mainFrame) {
				const exactHarloweGeneration = exactHarloweGenerationForFrame(
					session,
					details.frame.url
				);

				// A WebFrameMain and its renderer-visible WindowProxy survive native
				// document navigation. Exact Harlowe authority cannot follow that
				// stable frame identity, so managed previews remount through the shell
				// instead of allowing story-controlled document replacement.
				if (exactHarloweGeneration && details.isSameDocument !== true) {
					details.preventDefault();
					if (!allowsPackageNavigation(session, details.url)) {
						maybeOpenExternal(details.url);
					}
					const candidate = session.candidate;

					if (candidate === exactHarloweGeneration) {
						void rollbackCandidate(
							session,
							candidate,
							new Error(
								'Replacement story preview attempted a native document navigation.'
							)
						);
					}
					return;
				}
				if (!allowsPackageNavigation(session, details.url)) {
					details.preventDefault();
					maybeOpenExternal(details.url);
				}
			}
		});
		contents.setWindowOpenHandler(({url}) => {
			maybeOpenExternal(url);
			return {action: 'deny'};
		});
	}

	function finishInitialReady(session: PreviewSession) {
		if (
			session.closed ||
			session.ready.settled() ||
			!session.shellReady ||
			!session.initialFrameLoaded
		) {
			return;
		}

		clearTimeout(session.readyTimeout);
		session.ready.resolve();
		showWindowWhenReady(session.window);
	}

	function attachPreviewLifecycle(session: PreviewSession) {
		session.window.once('closed', () => {
			void closeSession(
				session,
				false,
				new Error('Story preview window was closed.')
			);
		});
		session.window.webContents.once('destroyed', () => {
			void closeSession(
				session,
				false,
				new Error('Story preview renderer was destroyed.')
			);
		});
		session.window.webContents.on('render-process-gone', () => {
			void closeSession(
				session,
				true,
				new Error('Story preview renderer crashed.')
			);
		});
		session.window.webContents.on('did-start-navigation', (...args: any[]) => {
			if (mainNavigationStarted(args) && session.clearState) {
				finalizeClearStateOperation(
					session,
					session.clearState,
					new Error('Story preview shell reloaded during Clear State.')
				);
			}
		});
		session.window.webContents.on(
			'did-fail-load',
			(_event, _errorCode, errorDescription, validatedURL, isMainFrame) => {
				if (isMainFrame) {
					void closeSession(
						session,
						true,
						new Error(`Story preview shell failed to load: ${errorDescription}`)
					);
					return;
				}
				if (
					session.candidate &&
					sameOrigin(validatedURL, session.candidate.url)
				) {
					void rollbackCandidate(
						session,
						session.candidate,
						new Error(
							`Replacement story preview failed to load: ${errorDescription}`
						)
					);
				} else if (
					!session.ready.settled() &&
					sameOrigin(validatedURL, session.current.url)
				) {
					void closeSession(
						session,
						true,
						new Error(
							`Initial story preview failed to load: ${errorDescription}`
						)
					);
				}
			}
		);
	}

	async function rollbackCandidate(
		session: PreviewSession,
		candidate: PreviewCandidate,
		error: Error
	) {
		if (session.candidate !== candidate) {
			return;
		}

		clearTimeout(candidate.timeout);
		session.candidate = undefined;
		session.replacing = false;
		candidate.completion.reject(error);
		try {
			session.window.webContents.send(storyPreviewIpcChannels.replacement, {
				generation: candidate.descriptor.generation,
				message: error.message,
				operation: 'replacement',
				status: 'error'
			} satisfies NativeStoryPreviewReplacementResult);
		} catch (notificationError) {
			console.warn(
				'Could not notify a story preview about replacement failure.',
				notificationError
			);
		}
		await releaseUrl(candidate.url);
	}

	async function commitCandidate(
		session: PreviewSession,
		candidate: PreviewCandidate
	) {
		if (session.closed || session.candidate !== candidate) {
			return;
		}

		clearTimeout(candidate.timeout);
		const previous = session.current;

		mergeLatestOwnerAppearance(session.owner, candidate);
		session.current = {
			descriptor: candidate.descriptor,
			url: candidate.url
		};
		session.candidate = undefined;
		session.replacing = false;
		await releaseUrl(previous.url);
		candidate.completion.resolve({
			descriptor: candidate.descriptor,
			url: candidate.url
		});
	}

	async function stageGeneration(
		build: ManagedStoryPreviewBuild,
		sessionId: string,
		generation: number
	): Promise<PreviewGeneration> {
		const baseDescriptor = cloneAndValidateDescriptor(
			build.descriptor,
			sessionId,
			generation
		);
		const instrumented = instrumentPreviewHtml(
			build.html,
			baseDescriptor.bridgeSessionId,
			{admission: baseDescriptor.admission}
		);
		const descriptor: NativeStoryPreviewDescriptor = {
			...baseDescriptor,
			admission: instrumented.admission,
			sugarCubeRestartEligible: instrumented.sugarCubeRestartEligible
		};
		const staged = await dependencies.stagePackage(
			instrumented.html,
			build.assets ?? []
		);
		let url: string;

		try {
			url = dependencies.registerPackage(staged);
		} catch (error) {
			await dependencies.releaseStagedPackage(staged);
			throw error;
		}

		return {descriptor, url};
	}

	async function open(
		owner: WebContents,
		build: ManagedStoryPreviewBuild
	): Promise<ManagedStoryPreviewLaunch> {
		if (shuttingDown) {
			throw new Error('Story previews cannot open while the app is quitting.');
		}
		if (!owner || owner.isDestroyed()) {
			throw new Error('Story preview requires a live owning editor.');
		}
		if (sessionsById.size + pendingLaunches >= maxManagedStoryPreviewWindows) {
			throw new Error(
				`No more than ${maxManagedStoryPreviewWindows} story preview windows may be open.`
			);
		}
		pendingLaunches++;

		let sessionId = dependencies.randomId();

		while (sessionsById.has(sessionId)) {
			sessionId = dependencies.randomId();
		}

		let initial: PreviewGeneration;

		try {
			initial = await stageGeneration(build, sessionId, 1);
		} catch (error) {
			pendingLaunches--;
			throw error;
		}
		if (shuttingDown || owner.isDestroyed()) {
			pendingLaunches--;
			await releaseUrl(initial.url);
			throw new Error(
				shuttingDown
					? 'Story previews cannot open while the app is quitting.'
					: 'The owning editor closed while staging its story preview.'
			);
		}
		mergeLatestOwnerAppearance(owner, initial);
		let previewWindow: PreviewWindowLike;

		try {
			previewWindow = dependencies.createWindow({
				height: previewWindowHeight,
				show: false,
				title: `${initial.descriptor.storyName} — Preview`,
				webPreferences: {
					...(backgroundWindowForE2E() ? {backgroundThrottling: false} : {}),
					contextIsolation: true,
					nodeIntegration: false,
					nodeIntegrationInSubFrames: false,
					preload: path.resolve(__dirname, './preview-preload.js'),
					sandbox: true,
					webSecurity: true
				},
				width: previewWindowWidth
			});
		} catch (error) {
			pendingLaunches--;
			await releaseUrl(initial.url);
			throw error;
		}

		mergeLatestOwnerAppearance(owner, initial);
		const ready = deferred<void>();
		const session: PreviewSession = {
			closed: false,
			current: initial,
			id: sessionId,
			initialFrameLoaded: false,
			owner,
			pendingCommands: new Map(),
			ready,
			readyTimeout: setTimeout(() => {
				void closeSession(
					session,
					true,
					new Error('Story preview shell did not become ready in time.')
				);
			}, readyTimeoutMs),
			replacing: false,
			shellReady: false,
			window: previewWindow
		};

		session.readyTimeout.unref?.();
		sessionsById.set(session.id, session);
		sessionsByPreview.set(previewWindow.webContents, session);
		pendingLaunches--;
		captureOwner(owner, session);
		installWindowPolicy(session);
		attachPreviewLifecycle(session);

		try {
			await previewWindow.loadURL(dependencies.previewEntryUrl());
			await ready.promise;
			if (session.closed) {
				throw new Error('Story preview closed before it became ready.');
			}
			return {
				descriptor: session.current.descriptor,
				url: session.current.url
			};
		} catch (error) {
			await closeSession(
				session,
				true,
				error instanceof Error ? error : new Error(String(error))
			);
			throw error;
		}
	}

	async function replace(
		owner: WebContents,
		sessionId: string,
		expectedGeneration: number,
		build: ManagedStoryPreviewBuild,
		commandDispatchId?: string
	): Promise<ManagedStoryPreviewLaunch> {
		const session = assertOwner(owner, sessionId);
		const assertCommandDispatch = () => {
			if (commandDispatchId === undefined) return;
			if (!validString(commandDispatchId, 128)) {
				throw new Error('Story preview replacement command is invalid.');
			}
			const pending = session.pendingCommands.get(commandDispatchId);
			if (
				!pending ||
				pending.dispatchId !== commandDispatchId ||
				(pending.type !== 'testCurrent' && pending.type !== 'testFromStart')
			) {
				throw new Error(
					'Story preview replacement command is stale or unsolicited.'
				);
			}
			if (!isOwnerCommandLive(session, commandDispatchId, pending)) {
				throw new Error('Story preview replacement command has expired.');
			}
		};

		assertCommandDispatch();

		if (
			!Number.isSafeInteger(expectedGeneration) ||
			expectedGeneration !== session.current.descriptor.generation
		) {
			throw new Error(
				'Story preview replacement belongs to a stale generation.'
			);
		}
		if (session.replacing) {
			throw new Error('A story preview replacement is already pending.');
		}
		if (session.clearState) {
			throw new Error('Clear State is already pending for this story preview.');
		}

		session.replacing = true;
		const generation = expectedGeneration + 1;
		let next: PreviewGeneration;

		try {
			next = await stageGeneration(build, session.id, generation);
		} catch (error) {
			session.replacing = false;
			throw error;
		}

		if (session.closed) {
			await releaseUrl(next.url);
			throw new Error('Story preview closed while staging its replacement.');
		}
		try {
			assertCommandDispatch();
		} catch (error) {
			session.replacing = false;
			await releaseUrl(next.url);
			throw error;
		}
		mergeLatestOwnerAppearance(owner, next);

		const completion = deferred<ManagedStoryPreviewLaunch>();
		const candidate: PreviewCandidate = {
			...next,
			...(commandDispatchId ? {commandDispatchId} : {}),
			completion,
			timeout: setTimeout(() => {
				void rollbackCandidate(
					session,
					candidate,
					new Error('Replacement story preview did not load in time.')
				);
			}, replacementTimeoutMs)
		};

		candidate.timeout.unref?.();
		session.candidate = candidate;
		try {
			const replacement: NativeStoryPreviewReplacement = {
				descriptor: next.descriptor,
				generation,
				url: next.url
			};

			session.window.webContents.send(storyPreviewIpcChannels.replacement, {
				generation,
				replacement,
				status: 'success'
			} satisfies NativeStoryPreviewReplacementResult);
		} catch (error) {
			await rollbackCandidate(
				session,
				candidate,
				error instanceof Error ? error : new Error(String(error))
			);
		}

		return completion.promise;
	}

	async function close(owner: WebContents, sessionId: string) {
		return closeSession(assertOwner(owner, sessionId), true);
	}

	function initialState(event: PreviewIpcEvent) {
		const session = sessionForPreview(event);

		mergeLatestOwnerAppearance(session.owner, session.current);
		return {
			descriptor: session.current.descriptor,
			url: session.current.url
		};
	}

	function ready(event: PreviewIpcEvent, generation: unknown) {
		const session = sessionForPreview(event);

		if (
			!Number.isSafeInteger(generation) ||
			generation !== session.current.descriptor.generation
		) {
			throw new Error('Story preview readiness belongs to a stale generation.');
		}

		session.shellReady = true;
		finishInitialReady(session);
	}

	async function frameLoaded(event: PreviewIpcEvent, generation: unknown) {
		const session = sessionForPreview(event);

		if (!Number.isSafeInteger(generation)) {
			throw new Error('Story preview frame generation is invalid.');
		}
		if (generation === session.current.descriptor.generation) {
			if (!session.ready.settled()) {
				session.initialFrameLoaded = true;
				finishInitialReady(session);
			}
			return;
		}
		if (session.candidate?.descriptor.generation !== generation) {
			throw new Error('Story preview frame belongs to a stale generation.');
		}

		const candidate = session.candidate;

		if (!candidate) {
			throw new Error('Story preview frame has no pending replacement.');
		}
		await commitCandidate(session, candidate);
	}

	function assertClearStateOperation(
		session: PreviewSession,
		operation: PreviewClearStateOperation
	) {
		if (
			session.closed ||
			sessionsById.get(session.id) !== session ||
			session.clearState !== operation ||
			session.current.descriptor.generation !== operation.generation ||
			session.current.url !== operation.url ||
			session.replacing ||
			session.candidate ||
			session.pendingCommands.size !== 0
		) {
			throw new Error('Clear State operation is stale or no longer safe.');
		}
	}

	function requestedClearStateOperation(
		session: PreviewSession,
		value: unknown
	) {
		if (
			!isRecord(value) ||
			!validNonnegativeInteger(value.generation) ||
			!validString(value.operationId, 128)
		) {
			throw new Error('Clear State operation is invalid.');
		}

		const operation = session.clearState;

		if (
			!operation ||
			operation.generation !== value.generation ||
			operation.id !== value.operationId
		) {
			throw new Error('Clear State operation is stale or unsolicited.');
		}

		assertClearStateOperation(session, operation);
		return operation;
	}

	async function beginClearState(
		event: PreviewIpcEvent,
		generation: unknown
	): Promise<NativeStoryPreviewClearStateOperation> {
		const session = sessionForPreview(event);

		if (
			!validNonnegativeInteger(generation) ||
			generation !== session.current.descriptor.generation
		) {
			throw new Error('Clear State belongs to a stale preview generation.');
		}
		if (session.current.descriptor.target === 'proof') {
			throw new Error('Clear State is unavailable in Proof previews.');
		}
		if (
			session.clearState ||
			session.replacing ||
			session.candidate ||
			session.pendingCommands.size !== 0
		) {
			throw new Error('The story preview is busy.');
		}

		const operation: PreviewClearStateOperation = {
			abort: deferred<void>(),
			generation,
			id: dependencies.randomId(),
			url: session.current.url
		};

		session.clearState = operation;
		operation.timeout = setTimeout(() => {
			finalizeClearStateOperation(
				session,
				operation,
				new Error('Clear State operation lease expired.')
			);
		}, clearStateLeaseTimeoutMs);
		operation.timeout.unref?.();
		try {
			await Promise.race([
				dependencies.waitForFrameDetach(
					session.window.webContents,
					operation.url,
					storyPreviewClearStateTimeoutMs
				),
				operation.abort.promise
			]);
			assertClearStateOperation(session, operation);
			const cleanup = dependencies.registerStateCleanup(
				operation.url,
				operation.id
			);

			operation.cleanupUrl = cleanup.url;
			return {
				generation: operation.generation,
				operationId: operation.id,
				url: cleanup.url
			};
		} catch (error) {
			finalizeClearStateOperation(
				session,
				operation,
				error instanceof Error ? error : new Error(String(error))
			);
			throw error;
		}
	}

	async function completeClearState(event: PreviewIpcEvent, value: unknown) {
		const session = sessionForPreview(event);
		const operation = requestedClearStateOperation(session, value);

		if (!operation.cleanupUrl) {
			throw new Error('Clear State cleanup page is unavailable.');
		}

		try {
			await clearStoryPreviewOriginData(
				session.window.webContents.session,
				operation.url,
				() => assertClearStateOperation(session, operation)
			);
			assertClearStateOperation(session, operation);
		} finally {
			finalizeClearStateOperation(
				session,
				operation,
				new Error('Clear State operation completed.')
			);
		}
	}

	function cancelClearState(event: PreviewIpcEvent, value: unknown) {
		const session = sessionForPreview(event);
		const operation = requestedClearStateOperation(session, value);

		finalizeClearStateOperation(
			session,
			operation,
			new Error('Clear State operation cancelled.')
		);
	}

	function command(
		event: PreviewIpcEvent,
		value: unknown
	): NativeStoryPreviewCommandResult {
		const session = sessionForPreview(event);
		let validated: ReturnType<typeof validateCommand>;

		try {
			validated = validateCommand(value, session);
		} catch (error) {
			const candidate = isRecord(value)
				? {
						generation: Number.isSafeInteger(value.generation)
							? (value.generation as number)
							: session.current.descriptor.generation,
						requestId: validString(value.requestId, 128)
							? value.requestId
							: 'invalid-request',
						type: [
							'revealGraph',
							'revealSource',
							'testCurrent',
							'testFromStart'
						].includes(value.type as string)
							? (value.type as NativeStoryPreviewCommand['type'])
							: 'revealSource'
					}
				: {
						generation: session.current.descriptor.generation,
						requestId: 'invalid-request',
						type: 'revealSource' as const
					};

			return commandError(
				candidate,
				error instanceof Error ? error.message : 'Story preview command failed.'
			);
		}

		const duplicateRequest = [...session.pendingCommands.values()].some(
			pending => pending.requestId === validated.command.requestId
		);
		if (session.clearState) {
			return commandError(
				validated.command,
				'The story preview is clearing its state.'
			);
		}

		if (duplicateRequest) {
			return commandError(
				validated.command,
				'This story preview command is already running.'
			);
		}
		if (session.pendingCommands.size >= maxStoryPreviewPendingCommands) {
			return commandError(
				validated.command,
				'Too many story preview commands are already running.'
			);
		}

		const envelope: NativeStoryPreviewOwnerCommand = {
			command: validated.command,
			dispatchId: randomUUID(),
			passageId: validated.passageId,
			sessionId: session.id,
			storyId: session.current.descriptor.storyId
		};

		const key = commandKey(envelope);
		try {
			const pending = {
				accepted: false,
				deadline: Date.now() + ownerCommandLeaseTimeoutMs,
				dispatchId: envelope.dispatchId,
				generation: validated.command.generation,
				requestId: validated.command.requestId,
				timeout: undefined as ReturnType<typeof setTimeout> | undefined,
				type: validated.command.type
			};
			pending.timeout = setTimeout(() => {
				expireOwnerCommand(session, key, pending);
			}, ownerCommandLeaseTimeoutMs);
			pending.timeout.unref?.();
			session.pendingCommands.set(key, pending);
			session.owner.send(storyPreviewIpcChannels.ownerCommand, envelope);
		} catch (error) {
			const pending = session.pendingCommands.get(key);
			if (pending?.timeout) clearTimeout(pending.timeout);
			session.pendingCommands.delete(key);
			return commandError(
				validated.command,
				error instanceof Error ? error.message : 'Story preview command failed.'
			);
		}

		return {
			command: validated.command.type,
			generation: validated.command.generation,
			requestId: validated.command.requestId,
			status: 'busy'
		};
	}

	function copyText(event: PreviewIpcEvent, value: unknown): void {
		sessionForPreview(event);
		if (
			typeof value !== 'string' ||
			value.length === 0 ||
			Buffer.byteLength(value, 'utf8') > 4 * 1024 * 1024
		) {
			throw new Error('Runtime log text is invalid.');
		}
		dependencies.writeClipboardText(value);
	}

	function completeCommand(
		owner: WebContents,
		sessionId: string,
		value: unknown
	) {
		const session = assertOwner(owner, sessionId);

		if (
			!isRecord(value) ||
			!validNonnegativeInteger(value.generation) ||
			!['revealGraph', 'revealSource', 'testCurrent', 'testFromStart'].includes(
				value.command as string
			) ||
			!['accepted', 'error', 'success'].includes(value.status as string)
		) {
			throw new Error('Story preview command result is invalid.');
		}

		if (!validString(value.requestId, 128)) {
			throw new Error('Story preview command result request is invalid.');
		}
		const requestId = value.requestId as string;
		if (!validString(value.dispatchId, 128)) {
			throw new Error('Story preview command result dispatch is invalid.');
		}
		const dispatchId = value.dispatchId as string;
		const commandType = value.command as NativeStoryPreviewCommand['type'];
		const generation = value.generation as number;
		const key = commandKey({dispatchId});
		const pending = session.pendingCommands.get(key);

		if (
			!pending ||
			pending.dispatchId !== dispatchId ||
			pending.generation !== generation ||
			pending.requestId !== requestId ||
			pending.type !== commandType
		) {
			throw new Error('Story preview command result is stale or unsolicited.');
		}
		if (!isOwnerCommandLive(session, key, pending)) {
			throw new Error('Story preview command result has expired.');
		}

		let result: NativeStoryPreviewCommandResult;

		if (value.status === 'accepted') {
			if (commandType !== 'revealGraph' && commandType !== 'revealSource') {
				throw new Error('Only reveal commands can be accepted.');
			}
			if (pending.accepted) {
				throw new Error('Story preview reveal was already accepted.');
			}
			pending.accepted = true;
			if (pending.timeout) clearTimeout(pending.timeout);
			pending.deadline = Date.now() + ownerCommandLeaseTimeoutMs;
			pending.timeout = setTimeout(() => {
				expireOwnerCommand(session, key, pending);
			}, ownerCommandLeaseTimeoutMs);
			pending.timeout.unref?.();
			if (shouldFocusOwnerWindow()) {
				dependencies.focusOwner(session.owner);
			}
			return pending.deadline;
		}
		if (
			(commandType === 'revealGraph' || commandType === 'revealSource') &&
			value.status === 'success' &&
			!pending.accepted
		) {
			throw new Error(
				'Story preview reveal completed before owner acceptance.'
			);
		}

		if (value.status === 'error') {
			if (!validString(value.message, 4096) || value.operation !== 'command') {
				throw new Error('Story preview command error is invalid.');
			}
			result = {
				command: commandType,
				generation,
				requestId,
				message: value.message,
				operation: 'command',
				status: 'error'
			};
		} else {
			result = {
				command: commandType,
				generation,
				requestId,
				status: 'success'
			};
		}

		if (pending.timeout) clearTimeout(pending.timeout);
		session.pendingCommands.delete(key);
		session.window.webContents.send(
			storyPreviewIpcChannels.commandResult,
			result
		);
	}

	function updateAppearance(
		owner: WebContents,
		appearance: NativeStoryPreviewAppearance
	) {
		if (!validAppearance(appearance)) {
			throw new Error('Story preview appearance is invalid.');
		}
		if (!owner || owner.isDestroyed()) {
			return 0;
		}

		const state = ensureOwnerState(owner);

		state.appearance = {...appearance};
		for (const session of state.sessions) {
			const cloned = {...appearance};

			session.current.descriptor.appearance = cloned;
			const currentUpdate: NativeStoryPreviewAppearanceUpdate = {
				appearance: cloned,
				generation: session.current.descriptor.generation
			};

			session.window.webContents.send(
				storyPreviewIpcChannels.appearance,
				currentUpdate
			);
			if (session.candidate) {
				session.candidate.descriptor.appearance = {...appearance};
				session.window.webContents.send(storyPreviewIpcChannels.appearance, {
					appearance: {...appearance},
					generation: session.candidate.descriptor.generation
				} satisfies NativeStoryPreviewAppearanceUpdate);
			}
		}

		return state.sessions.size;
	}

	function registerPreviewIpc(ipc: Pick<IpcMain, 'handle' | 'on'>) {
		if (ipcInitialized) {
			return;
		}

		ipcInitialized = true;
		const previewIpc = previewIpcRegistrar(ipc, dependencies.previewEntryUrl());

		previewIpc.handle(storyPreviewIpcChannels.getInitialState, initialState);
		previewIpc.handle(storyPreviewIpcChannels.beginClearState, beginClearState);
		previewIpc.handle(
			storyPreviewIpcChannels.cancelClearState,
			cancelClearState
		);
		previewIpc.handle(
			storyPreviewIpcChannels.completeClearState,
			completeClearState
		);
		previewIpc.on(storyPreviewIpcChannels.ready, ready);
		previewIpc.handle(storyPreviewIpcChannels.frameLoaded, frameLoaded);
		previewIpc.handle(storyPreviewIpcChannels.command, command);
		previewIpc.handle(storyPreviewIpcChannels.copyText, copyText);
	}

	async function shutdown() {
		if (shuttingDown) {
			return;
		}

		shuttingDown = true;
		await Promise.all(
			[...sessionsById.values()].map(session =>
				closeSession(
					session,
					true,
					new Error('The application is shutting down.')
				)
			)
		);
		for (const [owner, state] of owners) {
			state.appearance = undefined;
			removeOwnerStateIfEmpty(owner);
		}
	}

	return {
		close,
		completeCommand,
		get activeSessionCount() {
			return sessionsById.size;
		},
		open,
		registerPreviewIpc,
		replace,
		shutdown,
		updateAppearance
	};
}

export const storyPreviewWindowManager = createStoryPreviewWindowManager();
let applicationManagerInitialized = false;

/**
 * Registers only preview-side IPC. Application launch/replace handlers should
 * call `storyPreviewWindowManager` from their existing trusted IPC registrar.
 */
export function initStoryPreviewWindowManager() {
	if (applicationManagerInitialized) {
		return storyPreviewWindowManager;
	}

	applicationManagerInitialized = true;
	storyPreviewWindowManager.registerPreviewIpc(ipcMain);
	app.on('before-quit', () => {
		void storyPreviewWindowManager.shutdown();
	});
	return storyPreviewWindowManager;
}
