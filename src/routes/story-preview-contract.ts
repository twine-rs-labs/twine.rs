export const STORY_PREVIEW_BRIDGE_SOURCE = 'twine.rs.preview.bridge';

export const STORY_PREVIEW_RUNTIME_LOG_LIMIT = 12;

export const STORY_PREVIEW_VIEW_TRANSITION_GUARD_SOURCE = `
(function () {
	var originalStartViewTransition = document.startViewTransition;

	if (typeof originalStartViewTransition !== 'function') {
		return;
	}

	function nonfatalReadinessError(error) {
		if (!error || typeof error !== 'object') {
			return false;
		}

		return (
			(error.name === 'AbortError' &&
				error.message === 'Transition was skipped') ||
			(error.name === 'InvalidStateError' &&
				error.message ===
					'Transition was aborted because of invalid state') ||
			(error.name === 'TimeoutError' &&
				error.message ===
					'Transition was aborted because of timeout in DOM update')
		);
	}

	document.startViewTransition = function () {
		var transition = originalStartViewTransition.apply(document, arguments);

		// ViewTransition.ready rejects when an animation cannot start even
		// though the DOM update still completes. Observe that rejection so a
		// format which ignores animation readiness does not turn a skipped
		// enhancement into an unhandled runtime error.
		if (
			transition &&
			transition.ready &&
			typeof transition.ready.catch === 'function'
		) {
			transition.ready.catch(function (error) {
				if (!nonfatalReadinessError(error)) {
					throw error;
				}
			});
		}

		return transition;
	};
})();`;

export const STORY_PREVIEW_BRIDGE_LIMITS = Object.freeze({
	hashLength: 2048,
	logArgumentCount: 16,
	logArgumentLength: 2048,
	logMessageLength: 8192,
	passageFieldLength: 1024,
	sessionIdLength: 256,
	sourceLength: 256,
	totalLogTextLength: 32768,
	viewportDimension: 100000,
	viewportOffset: 10000000
});

export interface StoryPreviewPassageRef {
	id: string;
	localId: string;
	name: string;
}

export interface StoryPreviewRuntimePassage {
	id?: string;
	localId?: string;
	name?: string;
	rawName?: string;
	source?: string;
}

export interface StoryPreviewRuntimeViewport {
	hash?: string;
	height: number;
	scrollX?: number;
	scrollY?: number;
	width: number;
}

export interface StoryPreviewRuntimeState {
	currentPassage?: StoryPreviewRuntimePassage;
	lastSeenAt?: number;
	status: 'idle' | 'observed' | 'waiting';
	viewport?: StoryPreviewRuntimeViewport;
}

export interface StoryPreviewRuntimeLogEntry {
	id: string;
	level: 'error' | 'info' | 'log' | 'warn';
	message: string;
	time: number;
}

export type StoryPreviewViewportPreset = 'desktop' | 'fit' | 'phone' | 'tablet';

export interface StoryPreviewBridgeMessage {
	args?: string[];
	currentPassage?: StoryPreviewRuntimePassage;
	level?: StoryPreviewRuntimeLogEntry['level'];
	message?: string;
	sessionId: string;
	source: typeof STORY_PREVIEW_BRIDGE_SOURCE;
	time?: number;
	type: 'console' | 'runtime-error' | 'state';
	viewport?: StoryPreviewRuntimeViewport;
}

export interface StoryPreviewRuntimeModel {
	logs: StoryPreviewRuntimeLogEntry[];
	nextLogId: number;
	runtime: StoryPreviewRuntimeState;
}

export interface StoryPreviewPassageLookup {
	byId: ReadonlyMap<string, StoryPreviewPassageRef>;
	byLocalId: ReadonlyMap<string, StoryPreviewPassageRef>;
	byName: ReadonlyMap<string, StoryPreviewPassageRef>;
}

export type StoryPreviewRuntimeAction =
	| {
			hasContent: boolean;
			type: 'reset';
	  }
	| {
			model: StoryPreviewRuntimeModel;
			type: 'replace';
	  }
	| {
			message: StoryPreviewBridgeMessage;
			now: number;
			passages: StoryPreviewPassageLookup;
			type: 'message';
	  };

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function boundedString(value: unknown, limit: number) {
	return typeof value === 'string' && value.length <= limit ? value : undefined;
}

function optionalBoundedString(
	value: unknown,
	limit: number
): string | undefined | null {
	if (value === undefined) {
		return undefined;
	}

	return boundedString(value, limit) ?? null;
}

function optionalFiniteNumber(
	value: unknown,
	absoluteLimit: number
): number | undefined | null {
	if (value === undefined) {
		return undefined;
	}

	return typeof value === 'number' &&
		Number.isFinite(value) &&
		Math.abs(value) <= absoluteLimit
		? value
		: null;
}

function runtimePassageFromUnknown(
	value: unknown
): StoryPreviewRuntimePassage | undefined | null {
	if (value === undefined) {
		return undefined;
	}

	if (!isRecord(value)) {
		return null;
	}

	const id = optionalBoundedString(
		value.id,
		STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength
	);
	const localId = optionalBoundedString(
		value.localId,
		STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength
	);
	const name = optionalBoundedString(
		value.name,
		STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength
	);
	const rawName = optionalBoundedString(
		value.rawName,
		STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength
	);
	const source = optionalBoundedString(
		value.source,
		STORY_PREVIEW_BRIDGE_LIMITS.sourceLength
	);

	if (
		id === null ||
		localId === null ||
		name === null ||
		rawName === null ||
		source === null
	) {
		return null;
	}

	return {id, localId, name, rawName, source};
}

function runtimeViewportFromUnknown(
	value: unknown
): StoryPreviewRuntimeViewport | undefined | null {
	if (value === undefined) {
		return undefined;
	}

	if (!isRecord(value)) {
		return null;
	}

	const hash = optionalBoundedString(
		value.hash,
		STORY_PREVIEW_BRIDGE_LIMITS.hashLength
	);
	const height = optionalFiniteNumber(
		value.height,
		STORY_PREVIEW_BRIDGE_LIMITS.viewportDimension
	);
	const scrollX = optionalFiniteNumber(
		value.scrollX,
		STORY_PREVIEW_BRIDGE_LIMITS.viewportOffset
	);
	const scrollY = optionalFiniteNumber(
		value.scrollY,
		STORY_PREVIEW_BRIDGE_LIMITS.viewportOffset
	);
	const width = optionalFiniteNumber(
		value.width,
		STORY_PREVIEW_BRIDGE_LIMITS.viewportDimension
	);

	if (
		hash === null ||
		height === null ||
		scrollX === null ||
		scrollY === null ||
		width === null ||
		height === undefined ||
		width === undefined ||
		height < 0 ||
		width < 0
	) {
		return null;
	}

	return {hash, height, scrollX, scrollY, width};
}

function runtimeLogLevelFromUnknown(
	value: unknown
): StoryPreviewRuntimeLogEntry['level'] | undefined {
	return value === 'error' ||
		value === 'info' ||
		value === 'log' ||
		value === 'warn'
		? value
		: undefined;
}

/**
 * Copies an untrusted story-frame message into a small, serializable DTO.
 * Malformed or over-limit values are rejected before entering React state.
 */
export function normalizeStoryPreviewBridgeMessage(
	data: unknown
): StoryPreviewBridgeMessage | undefined {
	if (!isRecord(data) || data.source !== STORY_PREVIEW_BRIDGE_SOURCE) {
		return undefined;
	}

	const sessionId = boundedString(
		data.sessionId,
		STORY_PREVIEW_BRIDGE_LIMITS.sessionIdLength
	);
	const time =
		data.time === undefined
			? undefined
			: typeof data.time === 'number' &&
				  Number.isFinite(data.time) &&
				  data.time >= 0
				? data.time
				: null;

	if (!sessionId || time === null) {
		return undefined;
	}

	if (data.type === 'console') {
		const level = runtimeLogLevelFromUnknown(data.level);

		if (
			!level ||
			!Array.isArray(data.args) ||
			data.args.length > STORY_PREVIEW_BRIDGE_LIMITS.logArgumentCount
		) {
			return undefined;
		}

		const args: string[] = [];
		let totalTextLength = 0;

		for (const value of data.args) {
			const argument = boundedString(
				value,
				STORY_PREVIEW_BRIDGE_LIMITS.logArgumentLength
			);

			if (argument === undefined) {
				return undefined;
			}

			totalTextLength += argument.length;

			if (totalTextLength > STORY_PREVIEW_BRIDGE_LIMITS.totalLogTextLength) {
				return undefined;
			}

			args.push(argument);
		}

		return {
			args,
			level,
			sessionId,
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time,
			type: 'console'
		};
	}

	if (data.type === 'runtime-error') {
		const level =
			data.level === undefined
				? 'error'
				: runtimeLogLevelFromUnknown(data.level);
		const message = boundedString(
			data.message,
			STORY_PREVIEW_BRIDGE_LIMITS.logMessageLength
		);

		if (!level || message === undefined) {
			return undefined;
		}

		return {
			level,
			message,
			sessionId,
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time,
			type: 'runtime-error'
		};
	}

	if (data.type === 'state') {
		const currentPassage = runtimePassageFromUnknown(data.currentPassage);
		const viewport = runtimeViewportFromUnknown(data.viewport);

		if (currentPassage === null || viewport === null) {
			return undefined;
		}

		return {
			currentPassage,
			sessionId,
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time,
			type: 'state',
			viewport
		};
	}

	return undefined;
}

export function isBridgeMessage(
	data: unknown
): data is StoryPreviewBridgeMessage {
	return normalizeStoryPreviewBridgeMessage(data) !== undefined;
}

export function storyPreviewPassages(
	story:
		| {
				passages: Array<{id: string; name: string}>;
		  }
		| undefined
): StoryPreviewPassageRef[] {
	return (
		story?.passages.map((passage, index) => ({
			id: passage.id,
			localId: String(index + 1),
			name: passage.name
		})) ?? []
	);
}

export function createStoryPreviewPassageLookup(
	passages: StoryPreviewPassageRef[]
): StoryPreviewPassageLookup {
	const byId = new Map<string, StoryPreviewPassageRef>();
	const byLocalId = new Map<string, StoryPreviewPassageRef>();
	const byName = new Map<string, StoryPreviewPassageRef>();

	for (const passage of passages) {
		if (!byId.has(passage.id)) {
			byId.set(passage.id, passage);
		}
		if (!byLocalId.has(passage.localId)) {
			byLocalId.set(passage.localId, passage);
		}
		if (!byName.has(passage.name)) {
			byName.set(passage.name, passage);
		}
	}

	return {
		byId,
		byLocalId,
		byName
	};
}

function bridgeScript(
	sessionId: string,
	enableHarloweSessionStorageFallback: boolean
) {
	return `
<script>
${STORY_PREVIEW_VIEW_TRANSITION_GUARD_SOURCE}
(function () {
	var SOURCE = ${JSON.stringify(STORY_PREVIEW_BRIDGE_SOURCE)};
	var SESSION = ${JSON.stringify(sessionId)};
	var ENABLE_HARLOWE_SESSION_STORAGE_FALLBACK = ${JSON.stringify(
		enableHarloweSessionStorageFallback
	)};
	var MAX_ARGUMENTS = ${STORY_PREVIEW_BRIDGE_LIMITS.logArgumentCount};
	var MAX_ARGUMENT_LENGTH = ${STORY_PREVIEW_BRIDGE_LIMITS.logArgumentLength};
	var MAX_MESSAGE_LENGTH = ${STORY_PREVIEW_BRIDGE_LIMITS.logMessageLength};
	var MAX_FORMAT_SESSION_LENGTH = 1024 * 1024;
	var STARTUP_STATE_CAPTURE_DELAYS = [250, 500, 1000, 2000, 4000];
	var harloweSessionStorage;
	var pendingState = 0;
	var pendingStartupState = 0;
	var startupStateCaptureIndex = 0;

	function createMemorySessionStorage() {
		var keys = [];
		var values = Object.create(null);
		var storage = {
			clear: function () {
				var hadSavedSession = Object.prototype.hasOwnProperty.call(values, 'Saved Session');
				keys = [];
				values = Object.create(null);

				if (hadSavedSession) {
					queueState();
				}
			},
			getItem: function (key) {
				key = String(key);
				return Object.prototype.hasOwnProperty.call(values, key)
					? values[key]
					: null;
			},
			key: function (index) {
				index = Number(index);
				return Number.isFinite(index) && index >= 0
					? keys[Math.floor(index)] || null
					: null;
			},
			removeItem: function (key) {
				key = String(key);

				if (!Object.prototype.hasOwnProperty.call(values, key)) {
					return;
				}

				delete values[key];
				keys = keys.filter(function (candidate) {
					return candidate !== key;
				});

				if (key === 'Saved Session') {
					queueState();
				}
			},
			setItem: function (key, value) {
				key = String(key);
				value = String(value);

				if (!Object.prototype.hasOwnProperty.call(values, key)) {
					keys.push(key);
				}

				values[key] = value;

				if (key === 'Saved Session') {
					queueState();
				}
			}
		};

		Object.defineProperty(storage, 'length', {
			enumerable: true,
			get: function () {
				return keys.length;
			}
		});

		return storage;
	}

	function installHarloweSessionStorageFallback() {
		if (!ENABLE_HARLOWE_SESSION_STORAGE_FALLBACK) {
			return;
		}

		try {
			var storage = window.sessionStorage;
			var probeKey = '__twine_rs_preview_session_probe__';
			storage.setItem(probeKey, '1');
			storage.removeItem(probeKey);
			harloweSessionStorage = storage;
			return;
		} catch (error) {}

		// Browser srcDoc previews intentionally retain an opaque origin. Give
		// Harlowe a document-lifetime store instead of weakening the iframe
		// sandbox with allow-same-origin.
		var fallback = createMemorySessionStorage();

		try {
			Object.defineProperty(window, 'sessionStorage', {
				configurable: true,
				enumerable: true,
				value: fallback
			});
			harloweSessionStorage = fallback;
		} catch (error) {}
	}

	installHarloweSessionStorageFallback();

	function bounded(value, limit) {
		value = String(value);
		return value.length > limit ? value.slice(0, limit) : value;
	}

	function serialize(value) {
		try {
			if (value instanceof Error) {
				return bounded(value.name + ': ' + value.message, MAX_ARGUMENT_LENGTH);
			}

			if (typeof value === 'string') {
				return bounded(value, MAX_ARGUMENT_LENGTH);
			}

			if (value === undefined) {
				return 'undefined';
			}

			return bounded(JSON.stringify(value), MAX_ARGUMENT_LENGTH);
		} catch (error) {
			return bounded(value, MAX_ARGUMENT_LENGTH);
		}
	}

	function post(type, payload) {
		try {
			parent.postMessage(Object.assign({
				source: SOURCE,
				sessionId: SESSION,
				time: Date.now(),
				type: type
			}, payload || {}), '*');
		} catch (error) {}
	}

	function visible(element) {
		if (!element || element.closest('tw-storydata')) {
			return false;
		}

		var rect = element.getBoundingClientRect();
		var style = getComputedStyle(element);

		return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden';
	}

	function mapPassageElement(pid) {
		var storyData = document.querySelector('tw-storydata');

		if (!storyData || !pid) {
			return null;
		}

		var passages = storyData.querySelectorAll('tw-passagedata');

		for (var index = 0; index < passages.length; index++) {
			if (passages[index].getAttribute('pid') === String(pid)) {
				return passages[index];
			}
		}

		return null;
	}

	function firstValue(values) {
		for (var index = 0; index < values.length; index++) {
			if (values[index] !== undefined && values[index] !== null && String(values[index]).length > 0) {
				return String(values[index]);
			}
		}

		return undefined;
	}

	function passageFromElement(element, source) {
		var localId = firstValue([
			element.getAttribute('pid'),
			element.getAttribute('data-pid'),
			element.getAttribute('data-passage-id')
		]);
		var name = firstValue([
			element.getAttribute('name'),
			element.getAttribute('passage'),
			element.getAttribute('data-passage-name'),
			element.getAttribute('data-passage')
		]);
		var storyDataPassage = localId ? mapPassageElement(localId) : null;

		return {
			localId: localId,
			name: name || (storyDataPassage ? storyDataPassage.getAttribute('name') : undefined),
			source: source
		};
	}

	function passageFromHarloweSession() {
		var storyData = document.querySelector('tw-storydata');
		var format = storyData ? storyData.getAttribute('format') : '';

		if (!/^Harlowe$/i.test(format || '')) {
			return undefined;
		}

		try {
			var storage = harloweSessionStorage || sessionStorage;
			var savedSession = storage.getItem('Saved Session');

			if (!savedSession || savedSession.length > MAX_FORMAT_SESSION_LENGTH) {
				return undefined;
			}

			var timeline = JSON.parse(savedSession);

			if (!Array.isArray(timeline) || timeline.length === 0) {
				return undefined;
			}

			var current = timeline[timeline.length - 1];
			var name =
				typeof current === 'string'
					? current
					: current && typeof current === 'object' && !Array.isArray(current)
						? current.passage
						: undefined;

			if (
				typeof name === 'string' &&
				name.length > 0 &&
				name.length <= ${STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength}
			) {
				return {name: name, source: 'Harlowe session'};
			}
		} catch (error) {}

		return undefined;
	}

	function readRuntimePassage() {
		try {
			if (window.passage) {
				return {
					localId: firstValue([window.passage.id, window.passage.pid]),
					name: firstValue([window.passage.name, window.passage.title]),
					source: 'runtime'
				};
			}
		} catch (error) {}

		try {
			if (window.State && window.State.passage) {
				return {name: String(window.State.passage), source: 'runtime'};
			}
		} catch (error) {}

		try {
			if (window.state && window.state.passage) {
				return {name: String(window.state.passage), source: 'runtime'};
			}
		} catch (error) {}

		try {
			if (
				window.SugarCube &&
				window.SugarCube.State &&
				window.SugarCube.State.passage
			) {
				return {
					name: String(window.SugarCube.State.passage),
					source: 'SugarCube State'
				};
			}
		} catch (error) {}

		var harlowePassage = passageFromHarloweSession();

		if (harlowePassage) {
			return harlowePassage;
		}

		var selects = document.querySelectorAll('select');

		for (var selectIndex = 0; selectIndex < selects.length; selectIndex++) {
			var select = selects[selectIndex];
			var selectedTurn = select.options ? select.options[select.selectedIndex] : null;
			var selectedTurnText = selectedTurn ? selectedTurn.textContent : '';
			var selectedTurnMatch = selectedTurnText ? selectedTurnText.match(/^\\s*\\d+\\s*:\\s*(.+?)\\s*$/) : null;

			if (selectedTurnMatch) {
				return {name: selectedTurnMatch[1], source: 'runtime turn'};
			}
		}

		var selectors = [
			'[data-current-passage]',
			'.passage[data-passage-name]',
			'.passage[data-passage]',
			'[data-passage-name]',
			'tw-passage[name]',
			'tw-passage[passage]',
			'#passages .passage',
			'#passage',
			'tw-passage',
			'.passage'
		];
		var unidentifiedLivePassage = false;

		for (var index = 0; index < selectors.length; index++) {
			var element = document.querySelector(selectors[index]);

			if (element) {
				unidentifiedLivePassage = true;
			}
			if (visible(element)) {
				var passage = passageFromElement(element, selectors[index]);

				if (passage.localId || passage.name) {
					return passage;
				}
			}
		}

		// Once a live passage exists, never misreport the static startnode as its
		// identity. Formats without a stable signal remain safely unknown.
		if (unidentifiedLivePassage) {
			return undefined;
		}

		var storyData = document.querySelector('tw-storydata');
		var startLocalId = storyData ? storyData.getAttribute('startnode') : null;
		var startPassage = mapPassageElement(startLocalId);

		if (startPassage) {
			return passageFromElement(startPassage, 'storydata startnode');
		}

		return undefined;
	}

	function hasStablePassageIdentity(passage) {
		return Boolean(
			passage &&
				(passage.localId || passage.name) &&
				passage.source !== 'storydata startnode'
		);
	}

	function captureState() {
		pendingState = 0;
		var currentPassage = readRuntimePassage();

		if (hasStablePassageIdentity(currentPassage)) {
			clearTimeout(pendingStartupState);
			pendingStartupState = 0;
		}

		post('state', {
			currentPassage: currentPassage,
			viewport: {
				hash: bounded(location.hash, ${STORY_PREVIEW_BRIDGE_LIMITS.hashLength}),
				height: innerHeight,
				scrollX: scrollX,
				scrollY: scrollY,
				width: innerWidth
			}
		});

		return hasStablePassageIdentity(currentPassage);
	}

	function queueState() {
		clearTimeout(pendingState);
		pendingState = setTimeout(captureState, 50);
	}

	function queueStateAfterRuntimeTick() {
		queueState();
		setTimeout(captureState, 250);
	}

	function captureStartupState() {
		pendingStartupState = 0;

		if (
			captureState() ||
			startupStateCaptureIndex >= STARTUP_STATE_CAPTURE_DELAYS.length
		) {
			return;
		}

		pendingStartupState = setTimeout(
			captureStartupState,
			STARTUP_STATE_CAPTURE_DELAYS[startupStateCaptureIndex]
		);
		startupStateCaptureIndex += 1;
	}

	['log', 'info', 'warn', 'error'].forEach(function (level) {
		var original = console[level];

		if (typeof original !== 'function') {
			return;
		}

		console[level] = function () {
			var args = Array.prototype.slice.call(arguments, 0, MAX_ARGUMENTS).map(serialize);
			post('console', {args: args, level: level});
			return original.apply(console, arguments);
		};
	});

	window.addEventListener('error', function (event) {
		post('runtime-error', {
			level: 'error',
			message: bounded(event.message || 'Runtime error', MAX_MESSAGE_LENGTH)
		});
	});

	window.addEventListener('unhandledrejection', function (event) {
		post('runtime-error', {
			level: 'error',
			message: bounded(serialize(event.reason || 'Unhandled rejection'), MAX_MESSAGE_LENGTH)
		});
	});

	function attachObservers() {
		if (document.body) {
			new MutationObserver(queueState).observe(document.body, {
				attributes: true,
				childList: true,
				subtree: true
			});
		}

		document.addEventListener('change', queueState, true);
		document.addEventListener('click', queueStateAfterRuntimeTick, true);
		window.addEventListener('hashchange', queueState);
		window.addEventListener('popstate', queueState);
		window.addEventListener('resize', queueState);
		captureStartupState();
	}

	window.__twineRsPreviewDebug = {captureState: captureState};

	if (document.readyState === 'loading') {
		document.addEventListener('DOMContentLoaded', attachObservers, {once: true});
	} else {
		attachObservers();
	}

	window.addEventListener('load', queueState);
})();
</script>`;
}

function isHarlowePreviewHtml(html: string) {
	return /<tw-storydata\b[^>]*\bformat\s*=\s*(?:(["'])Harlowe\1|Harlowe(?=\s|>))/i.test(
		html
	);
}

export function instrumentPreviewHtml(
	html: string,
	sessionId: string,
	options: {enableHarloweSessionStorageFallback?: boolean} = {}
) {
	const script = bridgeScript(
		sessionId,
		options.enableHarloweSessionStorageFallback === true &&
			isHarlowePreviewHtml(html)
	);

	if (/<head(\s[^>]*)?>/i.test(html)) {
		return html.replace(/<head(\s[^>]*)?>/i, match => `${match}${script}`);
	}

	if (/<html(\s[^>]*)?>/i.test(html)) {
		return html.replace(/<html(\s[^>]*)?>/i, match => `${match}${script}`);
	}

	return `${script}${html}`;
}

export function resolveRuntimePassage(
	raw: StoryPreviewRuntimePassage | undefined,
	passages: StoryPreviewPassageRef[] | StoryPreviewPassageLookup
): StoryPreviewRuntimePassage | undefined {
	if (!raw) {
		return undefined;
	}

	const rawName = raw.name;
	const normalizedName = raw.name?.trim();
	const localId = raw.localId?.trim();
	const id = raw.id?.trim();
	const lookup = Array.isArray(passages)
		? createStoryPreviewPassageLookup(passages)
		: passages;
	const match =
		(id ? lookup.byId.get(id) : undefined) ??
		(localId ? lookup.byLocalId.get(localId) : undefined) ??
		(normalizedName ? lookup.byName.get(normalizedName) : undefined);

	return {
		id: match?.id,
		localId: match?.localId ?? localId,
		name: match?.name ?? normalizedName,
		rawName,
		source: raw.source
	};
}

export function initialStoryPreviewRuntimeModel(
	hasContent: boolean
): StoryPreviewRuntimeModel {
	return {
		logs: [],
		nextLogId: 0,
		runtime: {status: hasContent ? 'waiting' : 'idle'}
	};
}

export function reduceStoryPreviewRuntime(
	model: StoryPreviewRuntimeModel,
	action: StoryPreviewRuntimeAction
): StoryPreviewRuntimeModel {
	if (action.type === 'reset') {
		return initialStoryPreviewRuntimeModel(action.hasContent);
	}
	if (action.type === 'replace') {
		return action.model;
	}

	const {message, now, passages} = action;
	const time = message.time ?? now;

	if (message.type === 'state') {
		return {
			...model,
			runtime: {
				currentPassage: resolveRuntimePassage(message.currentPassage, passages),
				lastSeenAt: time,
				status: 'observed',
				viewport: message.viewport
			}
		};
	}

	const log: StoryPreviewRuntimeLogEntry = {
		id: `${time}:${model.nextLogId}`,
		level: message.level ?? 'error',
		message:
			message.type === 'runtime-error'
				? (message.message ?? 'Runtime error')
				: (message.args?.join(' ') ?? ''),
		time
	};

	return {
		...model,
		logs: [log, ...model.logs].slice(0, STORY_PREVIEW_RUNTIME_LOG_LIMIT),
		nextLogId: model.nextLogId + 1
	};
}
