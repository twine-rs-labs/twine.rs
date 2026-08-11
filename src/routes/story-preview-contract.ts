import {
	STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS,
	STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
	STORY_PREVIEW_DEBUGGER_TRUNCATION_REASONS,
	isStoryPreviewDebuggerAdapterId,
	selectStoryPreviewDebuggerAdapter,
	storyPreviewDebuggerAdapter
} from './story-preview-debugger-protocol';
import type {
	StoryPreviewDebuggerAdapterDescriptor,
	StoryPreviewDebuggerAdapterId,
	StoryPreviewDebuggerCapability,
	StoryPreviewDebuggerTruncationReason
} from './story-preview-debugger-protocol';

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
	debuggerFormatLength: 128,
	debuggerFormatVersionLength: 64,
	debuggerVariableNameLength: 256,
	debuggerVariableTypeLength: 64,
	debuggerPreviewLength: 2048,
	debuggerVariableCount: 100,
	debuggerVisitedPassageCount: 200,
	debuggerTotalTextLength: 32768,
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

export interface StoryPreviewDebuggerVariable {
	name: string;
	preview: string;
	type: string;
}

export interface StoryPreviewDebuggerHello extends StoryPreviewDebuggerAdapterDescriptor {
	protocolVersion: typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION;
}

export type StoryPreviewDebuggerSectionStatus =
	| {state: 'complete'}
	| {
			reasons: StoryPreviewDebuggerTruncationReason[];
			state: 'truncated';
	  }
	| {state: 'unavailable'};

export type StoryPreviewDebuggerSections = Partial<
	Record<StoryPreviewDebuggerCapability, StoryPreviewDebuggerSectionStatus>
>;

export interface StoryPreviewDebuggerSnapshot {
	adapterId: StoryPreviewDebuggerAdapterId;
	currentPassage?: StoryPreviewRuntimePassage;
	protocolVersion: typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION;
	sections: StoryPreviewDebuggerSections;
	storyVariables?: StoryPreviewDebuggerVariable[];
	temporaryVariables?: StoryPreviewDebuggerVariable[];
	visitedPassages?: StoryPreviewRuntimePassage[];
}

export interface StoryPreviewRuntimeDebuggerState {
	hello?: StoryPreviewDebuggerHello;
	snapshot?: StoryPreviewDebuggerSnapshot;
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
	adapterId?: StoryPreviewDebuggerAdapterId;
	capabilities?: StoryPreviewDebuggerCapability[];
	format?: string;
	formatVersion?: string;
	protocolVersion?: typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION;
	reliability?: StoryPreviewDebuggerAdapterDescriptor['reliability'];
	sections?: StoryPreviewDebuggerSections;
	storyVariables?: StoryPreviewDebuggerVariable[];
	temporaryVariables?: StoryPreviewDebuggerVariable[];
	type:
		| 'console'
		| 'debugger-hello'
		| 'debugger-snapshot'
		| 'runtime-error'
		| 'state';
	visitedPassages?: StoryPreviewRuntimePassage[];
	viewport?: StoryPreviewRuntimeViewport;
}

export interface StoryPreviewRuntimeModel {
	debugger: StoryPreviewRuntimeDebuggerState;
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

function debuggerCapabilitiesFromUnknown(
	value: unknown,
	expected: readonly StoryPreviewDebuggerCapability[]
): StoryPreviewDebuggerCapability[] | undefined {
	if (
		!Array.isArray(value) ||
		value.length !== expected.length ||
		value.some((capability, index) => capability !== expected[index])
	) {
		return undefined;
	}

	return [...value] as StoryPreviewDebuggerCapability[];
}

function canonicalDebuggerHello(
	value: Pick<
		StoryPreviewBridgeMessage,
		| 'adapterId'
		| 'capabilities'
		| 'format'
		| 'formatVersion'
		| 'protocolVersion'
		| 'reliability'
	>
): StoryPreviewDebuggerHello | undefined {
	if (
		value.protocolVersion !== STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION ||
		typeof value.format !== 'string' ||
		typeof value.formatVersion !== 'string'
	) {
		return undefined;
	}

	const expected = selectStoryPreviewDebuggerAdapter(
		value.format,
		value.formatVersion
	);
	const capabilities = debuggerCapabilitiesFromUnknown(
		value.capabilities,
		expected.capabilities
	);

	if (
		value.adapterId !== expected.id ||
		value.reliability !== expected.reliability ||
		!capabilities
	) {
		return undefined;
	}

	return {
		...expected,
		capabilities,
		protocolVersion: STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION
	};
}

function debuggerSectionStatusFromUnknown(
	value: unknown
): StoryPreviewDebuggerSectionStatus | undefined {
	if (!isRecord(value)) {
		return undefined;
	}
	if (value.state === 'complete' || value.state === 'unavailable') {
		return value.reasons === undefined ? {state: value.state} : undefined;
	}
	if (
		value.state !== 'truncated' ||
		!Array.isArray(value.reasons) ||
		value.reasons.length === 0 ||
		value.reasons.length > STORY_PREVIEW_DEBUGGER_TRUNCATION_REASONS.length
	) {
		return undefined;
	}

	let previousIndex = -1;
	const reasons: StoryPreviewDebuggerTruncationReason[] = [];
	for (const reason of value.reasons) {
		const index = STORY_PREVIEW_DEBUGGER_TRUNCATION_REASONS.indexOf(
			reason as StoryPreviewDebuggerTruncationReason
		);
		if (index <= previousIndex) {
			return undefined;
		}
		previousIndex = index;
		reasons.push(reason as StoryPreviewDebuggerTruncationReason);
	}

	return {reasons, state: 'truncated'};
}

function debuggerCapabilitiesForAdapter(
	adapterId: StoryPreviewDebuggerAdapterId
): readonly StoryPreviewDebuggerCapability[] {
	return (
		storyPreviewDebuggerAdapter(adapterId)?.capabilities ?? ['currentPassage']
	);
}

function debuggerSectionsFromUnknown(
	value: unknown,
	adapterId: StoryPreviewDebuggerAdapterId
): StoryPreviewDebuggerSections | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

	const expected = debuggerCapabilitiesForAdapter(adapterId);
	const keys = Object.keys(value);
	if (
		keys.length !== expected.length ||
		keys.some(key => !expected.includes(key as StoryPreviewDebuggerCapability))
	) {
		return undefined;
	}

	const sections: StoryPreviewDebuggerSections = {};
	for (const capability of expected) {
		const status = debuggerSectionStatusFromUnknown(value[capability]);
		if (!status) {
			return undefined;
		}
		sections[capability] = status;
	}
	return sections;
}

function debuggerVariablesFromUnknown(
	value: unknown
): StoryPreviewDebuggerVariable[] | undefined | null {
	if (value === undefined) {
		return undefined;
	}
	if (
		!Array.isArray(value) ||
		value.length > STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableCount
	) {
		return null;
	}

	let totalTextLength = 0;
	const variables: StoryPreviewDebuggerVariable[] = [];
	for (const item of value) {
		if (!isRecord(item)) {
			return null;
		}
		const name = boundedString(
			item.name,
			STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableNameLength
		);
		const type = boundedString(
			item.type,
			STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableTypeLength
		);
		const preview = boundedString(
			item.preview,
			STORY_PREVIEW_BRIDGE_LIMITS.debuggerPreviewLength
		);
		if (!name || !type || preview === undefined) {
			return null;
		}
		totalTextLength += name.length + type.length + preview.length;
		if (totalTextLength > STORY_PREVIEW_BRIDGE_LIMITS.debuggerTotalTextLength) {
			return null;
		}
		variables.push({name, preview, type});
	}
	return variables;
}

function debuggerVariableTextLength(
	variables: StoryPreviewDebuggerVariable[] | undefined
) {
	return (
		variables?.reduce(
			(total, variable) =>
				total +
				variable.name.length +
				variable.type.length +
				variable.preview.length,
			0
		) ?? 0
	);
}

function debuggerPassagesFromUnknown(
	value: unknown
): StoryPreviewRuntimePassage[] | undefined | null {
	if (value === undefined) {
		return undefined;
	}
	if (
		!Array.isArray(value) ||
		value.length > STORY_PREVIEW_BRIDGE_LIMITS.debuggerVisitedPassageCount
	) {
		return null;
	}
	const passages: StoryPreviewRuntimePassage[] = [];
	for (const item of value) {
		const passage = runtimePassageFromUnknown(item);
		if (!passage || (!passage.id && !passage.localId && !passage.name)) {
			return null;
		}
		passages.push(passage);
	}
	return passages;
}

function debuggerSinglePassageTextLength(
	passage: StoryPreviewRuntimePassage | undefined
) {
	if (!passage) {
		return 0;
	}

	return (
		(passage.id?.length ?? 0) +
		(passage.localId?.length ?? 0) +
		(passage.name?.length ?? 0) +
		(passage.rawName?.length ?? 0) +
		(passage.source?.length ?? 0)
	);
}

function debuggerPassagesTextLength(
	passages: StoryPreviewRuntimePassage[] | undefined
) {
	return (
		passages?.reduce(
			(total, passage) => total + debuggerSinglePassageTextLength(passage),
			0
		) ?? 0
	);
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

	if (data.type === 'debugger-hello') {
		const format =
			data.format === undefined
				? ''
				: boundedString(
						data.format,
						STORY_PREVIEW_BRIDGE_LIMITS.debuggerFormatLength
					);
		const formatVersion =
			data.formatVersion === undefined
				? ''
				: boundedString(
						data.formatVersion,
						STORY_PREVIEW_BRIDGE_LIMITS.debuggerFormatVersionLength
					);
		if (format === undefined || formatVersion === undefined) {
			return undefined;
		}
		const hello = canonicalDebuggerHello({
			adapterId: data.adapterId as StoryPreviewDebuggerAdapterId | undefined,
			capabilities: data.capabilities as
				StoryPreviewDebuggerCapability[] | undefined,
			format,
			formatVersion,
			protocolVersion: data.protocolVersion as
				typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION | undefined,
			reliability: data.reliability as
				StoryPreviewDebuggerAdapterDescriptor['reliability'] | undefined
		});
		if (!hello) {
			return undefined;
		}

		return {
			adapterId: hello.id,
			capabilities: [...hello.capabilities],
			format: hello.format,
			formatVersion: hello.formatVersion,
			protocolVersion: hello.protocolVersion,
			reliability: hello.reliability,
			sessionId,
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time,
			type: 'debugger-hello'
		};
	}

	if (data.type === 'debugger-snapshot') {
		if (
			data.protocolVersion !== STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION ||
			!isStoryPreviewDebuggerAdapterId(data.adapterId)
		) {
			return undefined;
		}
		const adapterId = data.adapterId;
		const capabilities = debuggerCapabilitiesForAdapter(adapterId);
		const sections = debuggerSectionsFromUnknown(data.sections, adapterId);
		const currentPassage = runtimePassageFromUnknown(data.currentPassage);
		const storyVariables = debuggerVariablesFromUnknown(data.storyVariables);
		const temporaryVariables = debuggerVariablesFromUnknown(
			data.temporaryVariables
		);
		const visitedPassages = debuggerPassagesFromUnknown(data.visitedPassages);
		if (
			!sections ||
			currentPassage === null ||
			storyVariables === null ||
			temporaryVariables === null ||
			visitedPassages === null ||
			debuggerSinglePassageTextLength(currentPassage) +
				debuggerVariableTextLength(storyVariables) +
				debuggerVariableTextLength(temporaryVariables) +
				debuggerPassagesTextLength(visitedPassages) >
				STORY_PREVIEW_BRIDGE_LIMITS.debuggerTotalTextLength
		) {
			return undefined;
		}

		const payloads: Partial<Record<StoryPreviewDebuggerCapability, unknown>> = {
			currentPassage,
			storyVariables,
			temporaryVariables,
			visitedPassages
		};
		for (const capability of capabilities) {
			const status = sections[capability]!;
			const hasPayload = payloads[capability] !== undefined;
			if (
				(status.state === 'unavailable' && hasPayload) ||
				(status.state !== 'unavailable' && !hasPayload)
			) {
				return undefined;
			}
		}
		for (const capability of [
			'storyVariables',
			'temporaryVariables',
			'visitedPassages'
		] as const) {
			if (
				!capabilities.includes(capability) &&
				payloads[capability] !== undefined
			) {
				return undefined;
			}
		}
		if (
			currentPassage &&
			!currentPassage.id &&
			!currentPassage.localId &&
			!currentPassage.name
		) {
			return undefined;
		}
		return {
			adapterId,
			currentPassage,
			protocolVersion: STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
			sections,
			sessionId,
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			storyVariables,
			temporaryVariables,
			time,
			type: 'debugger-snapshot',
			visitedPassages
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
	var DEBUGGER_PROTOCOL_VERSION = ${STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION};
	var DEBUGGER_ADAPTER_REGISTRATIONS = ${JSON.stringify(
		STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS
	)};
	var DEBUGGER_VARIABLE_LIMIT = ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableCount};
	var DEBUGGER_HISTORY_LIMIT = ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerVisitedPassageCount};
	var DEBUGGER_PREVIEW_LIMIT = ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerPreviewLength};
	var DEBUGGER_TOTAL_TEXT_LIMIT = ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerTotalTextLength};
	var DEBUGGER_STRING_LIMIT = 512;
	var MAX_FORMAT_SESSION_LENGTH = 1024 * 1024;
	var STARTUP_STATE_CAPTURE_DELAYS = [250, 500, 1000, 2000, 4000];
	var harloweSessionStorage;
	var pendingState = 0;
	var pendingStartupState = 0;
	var startupStateCaptureIndex = 0;
	var selectedDebuggerAdapter;
	var debuggerFloor = Math.floor;
	var debuggerGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
	var debuggerIsFrozen = Object.isFrozen;
	var debuggerIsFinite = Number.isFinite;
	var debuggerJsonStringify = JSON.stringify;
	var debuggerObjectKeys = Object.keys;
	var debuggerIsArray = Array.isArray;
	var debuggerIndexOf = Array.prototype.indexOf;
	var debuggerHasOwn = Object.prototype.hasOwnProperty;
	var debuggerMapHas = Map.prototype.has;
	var debuggerSetHas = Set.prototype.has;
	var debuggerString = String;
	var debuggerFunctionToString = Function.prototype.toString;
	var debuggerReflectApply = Reflect.apply;
	var debuggerDateGetTime = Date.prototype.getTime;
	var debuggerRegExpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get;
	var DEBUGGER_SUGARCUBE_STATE_ACCESSORS = {
		history: 'function(){return _history}',
		passage: 'function(){return _active.title}',
		temporary: 'function(){return _temporary}',
		variables: 'function(){return _active.variables}'
	};

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

	function debuggerAdapter() {
		var storyData = document.querySelector('tw-storydata');
		var format = storyData ? storyData.getAttribute('format') || '' : '';
		var formatVersion = storyData ? storyData.getAttribute('format-version') || '' : '';
		var ids = debuggerObjectKeys(DEBUGGER_ADAPTER_REGISTRATIONS);
		for (var index = 0; index < ids.length; index++) {
			var adapter = DEBUGGER_ADAPTER_REGISTRATIONS[ids[index]];
			if (adapter.format === format && adapter.formatVersion === formatVersion) {
				return adapter;
			}
		}
		return {
			capabilities: ['currentPassage'],
			captureHandler: 'current-only',
			format: bounded(format, ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerFormatLength}),
			formatVersion: bounded(formatVersion, ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerFormatVersionLength}),
			id: 'generic',
			reliability: 'best-effort'
		};
	}

	function addDebuggerReason(reasons, reason) {
		if (debuggerReflectApply(debuggerIndexOf, reasons, [reason]) === -1) {
			reasons.push(reason);
		}
	}

	function debuggerSectionStatus(reasons) {
		var canonical = ['field-limit', 'item-limit', 'text-budget', 'uninspectable'];
		var ordered = [];
		for (var index = 0; index < canonical.length; index++) {
			if (
				debuggerReflectApply(debuggerIndexOf, reasons, [canonical[index]]) !== -1
			) {
				ordered.push(canonical[index]);
			}
		}
		return ordered.length > 0
			? {reasons: ordered, state: 'truncated'}
			: {state: 'complete'};
	}

	function boundedDebuggerText(value, limit, reasons) {
		var result = debuggerString(value);
		if (result.length > limit) {
			addDebuggerReason(reasons, 'field-limit');
			return result.slice(0, limit);
		}
		return result;
	}

	function safePreview(value, reasons) {
		var kind = typeof value;
		if (value === null) return 'null';
		if (kind === 'string') {
			return boundedDebuggerText(
				debuggerJsonStringify(
					boundedDebuggerText(value, DEBUGGER_STRING_LIMIT, reasons)
				),
				DEBUGGER_PREVIEW_LIMIT,
				reasons
			);
		}
		if (kind === 'number' || kind === 'boolean' || kind === 'undefined') return debuggerString(value);
		if (kind === 'bigint') return '[bigint]';
		if (kind === 'symbol') return '[symbol]';
		if (kind === 'function') return '[function]';
		try { return '[Date ' + debuggerString(debuggerReflectApply(debuggerDateGetTime, value, [])) + ']'; } catch (error) {}
		try { return '[RegExp ' + boundedDebuggerText(debuggerReflectApply(debuggerRegExpSource, value, []), DEBUGGER_STRING_LIMIT, reasons) + ']'; } catch (error) {}
		try { debuggerReflectApply(debuggerMapHas, value, [value]); return '[Map]'; } catch (error) {}
		try { debuggerReflectApply(debuggerSetHas, value, [value]); return '[Set]'; } catch (error) {}
		try { if (debuggerIsArray(value)) return '[Array]'; } catch (error) {}
		return boundedDebuggerText('[object]', DEBUGGER_PREVIEW_LIMIT, reasons);
	}

	function debuggerPassage(passage, reasons) {
		var result = {};
		var keys = ['id', 'localId', 'name', 'rawName'];
		if (!passage || typeof passage !== 'object') return undefined;
		for (var index = 0; index < keys.length; index++) {
			var field = ownDebuggerData(passage, keys[index], reasons);
			if (typeof field === 'string' || typeof field === 'number') {
				result[keys[index]] = boundedDebuggerText(field, ${STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength}, reasons);
			}
		}
		var source = ownDebuggerData(passage, 'source', reasons);
		if (typeof source === 'string' || typeof source === 'number') {
			result.source = boundedDebuggerText(source, ${STORY_PREVIEW_BRIDGE_LIMITS.sourceLength}, reasons);
		}
		return result.id || result.localId || result.name ? result : undefined;
	}

	function debuggerPassageTextLength(passage) {
		var keys = ['id', 'localId', 'name', 'rawName', 'source'];
		var length = 0;
		if (!passage || typeof passage !== 'object') return length;
		for (var index = 0; index < keys.length; index++) {
			var field = ownDebuggerData(passage, keys[index]);
			if (typeof field === 'string') length += field.length;
		}
		return length;
	}

	function takeDebuggerText(budget, length) {
		if (length > budget.remaining) return false;
		budget.remaining -= length;
		return true;
	}

	function debuggerVariables(value, budget) {
		var variables = [];
		var reasons = [];
		var visited = 0;
		try {
			if (!value || (typeof value !== 'object' && typeof value !== 'function')) return undefined;
			for (var key in value) {
				if (visited >= DEBUGGER_VARIABLE_LIMIT) {
					addDebuggerReason(reasons, 'item-limit');
					break;
				}
				visited += 1;
				var descriptor = debuggerGetOwnPropertyDescriptor(value, key);
				if (!descriptor) continue;
				if (!debuggerReflectApply(debuggerHasOwn, descriptor, ['value'])) {
					addDebuggerReason(reasons, 'uninspectable');
					continue;
				}
				var name = boundedDebuggerText(key, ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableNameLength}, reasons);
				var variable = {name: name, type: typeof descriptor.value, preview: safePreview(descriptor.value, reasons)};
				if (!takeDebuggerText(budget, variable.name.length + variable.type.length + variable.preview.length)) {
					addDebuggerReason(reasons, 'text-budget');
					continue;
				}
				variables.push(variable);
			}
		} catch (error) {
			addDebuggerReason(reasons, 'uninspectable');
		}
		return {items: variables, status: debuggerSectionStatus(reasons)};
	}

	function debuggerPassages(values, primitiveIdentity, budget) {
		var passages = [];
		var reasons = [];
		try {
			if (!debuggerIsArray(values)) return undefined;
			var length = ownDebuggerData(values, 'length', reasons);
			if (typeof length !== 'number' || !debuggerIsFinite(length) || length < 0) return undefined;
			length = debuggerFloor(length);
			var start = length > DEBUGGER_HISTORY_LIMIT ? length - DEBUGGER_HISTORY_LIMIT : 0;
			if (start > 0) addDebuggerReason(reasons, 'item-limit');
			for (var index = length - 1; index >= start; index--) {
				var descriptor = debuggerGetOwnPropertyDescriptor(values, debuggerString(index));
				if (!descriptor) continue;
				if (!debuggerReflectApply(debuggerHasOwn, descriptor, ['value'])) {
					addDebuggerReason(reasons, 'uninspectable');
					continue;
				}
				var value = descriptor.value;
				var passage;
				if (typeof value === 'string' || typeof value === 'number') {
					var identity = boundedDebuggerText(value, ${STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength}, reasons);
					passage = primitiveIdentity === 'localId'
						? {localId: identity, source: 'debugger history'}
						: {name: identity, source: 'debugger history'};
				}
				else if (value && typeof value === 'object') {
					var localId = ownDebuggerData(value, 'localId', reasons);
					if (localId === undefined) localId = ownDebuggerData(value, 'id', reasons);
					var name = ownDebuggerData(value, 'name', reasons) || ownDebuggerData(value, 'title', reasons) || ownDebuggerData(value, 'passage', reasons);
					passage = {source: 'debugger history'};
					if (typeof localId === 'string' || typeof localId === 'number') passage.localId = boundedDebuggerText(localId, ${STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength}, reasons);
					if (typeof name === 'string') passage.name = boundedDebuggerText(name, ${STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength}, reasons);
				}
				if (!passage || (!passage.localId && !passage.name)) continue;
				if (!takeDebuggerText(budget, debuggerPassageTextLength(passage))) {
					addDebuggerReason(reasons, 'text-budget');
					continue;
				}
				passages.push(passage);
			}
		} catch (error) {
			addDebuggerReason(reasons, 'uninspectable');
		}
		var chronological = [];
		for (var outputIndex = passages.length - 1; outputIndex >= 0; outputIndex--) {
			chronological.push(passages[outputIndex]);
		}
		return {items: chronological, status: debuggerSectionStatus(reasons)};
	}

	function ownDebuggerData(value, key, reasons) {
		try {
			var descriptor = debuggerGetOwnPropertyDescriptor(value, key);
			if (!descriptor) return undefined;
			if (debuggerReflectApply(debuggerHasOwn, descriptor, ['value'])) {
				return descriptor.value;
			}
			if (reasons) addDebuggerReason(reasons, 'uninspectable');
			return undefined;
		} catch (error) {
			if (reasons) addDebuggerReason(reasons, 'uninspectable');
			return undefined;
		}
	}

	function auditedSugarCubeStateData(state, key) {
		try {
			var expectedSource = DEBUGGER_SUGARCUBE_STATE_ACCESSORS[key];
			var descriptor = debuggerGetOwnPropertyDescriptor(state, key);
			if (
				!expectedSource ||
				!debuggerIsFrozen(state) ||
				!descriptor ||
				descriptor.configurable ||
				typeof descriptor.get !== 'function' ||
				descriptor.set !== undefined ||
				debuggerReflectApply(debuggerFunctionToString, descriptor.get, []) !== expectedSource
			) {
				return undefined;
			}
			return debuggerReflectApply(descriptor.get, state, []);
		} catch (error) {
			return undefined;
		}
	}

	function debuggerCollectionBudgets(adapter, remaining) {
		var canonical = ['storyVariables', 'temporaryVariables', 'visitedPassages'];
		var active = [];
		var budgets = {};
		for (var index = 0; index < canonical.length; index++) {
			if (
				debuggerReflectApply(debuggerIndexOf, adapter.capabilities, [
					canonical[index]
				]) !== -1
			) {
				active.push(canonical[index]);
			}
		}
		if (active.length === 0) return budgets;
		var share = debuggerFloor(remaining / active.length);
		var remainder = remaining % active.length;
		for (var budgetIndex = 0; budgetIndex < active.length; budgetIndex++) {
			budgets[active[budgetIndex]] = {
				remaining: share + (budgetIndex < remainder ? 1 : 0)
			};
		}
		return budgets;
	}

	function applyDebuggerCollection(snapshot, sections, capability, result) {
		if (!result) {
			sections[capability] = {state: 'unavailable'};
			return;
		}
		sections[capability] = result.status;
		snapshot[capability] = result.items;
	}

	function captureCurrentOnly() {}

	function captureSugarCube(snapshot, sections, budgets) {
		var sugarCube = ownDebuggerData(window, 'SugarCube');
		var state = sugarCube && ownDebuggerData(sugarCube, 'State');
		if (!state) return;
		applyDebuggerCollection(
			snapshot,
			sections,
			'storyVariables',
			debuggerVariables(
				auditedSugarCubeStateData(state, 'variables'),
				budgets.storyVariables
			)
		);
		applyDebuggerCollection(
			snapshot,
			sections,
			'temporaryVariables',
			debuggerVariables(
				auditedSugarCubeStateData(state, 'temporary'),
				budgets.temporaryVariables
			)
		);
		applyDebuggerCollection(
			snapshot,
			sections,
			'visitedPassages',
			debuggerPassages(
				auditedSugarCubeStateData(state, 'history'),
				undefined,
				budgets.visitedPassages
			)
		);
	}

	function captureSnowman(snapshot, sections, budgets) {
		var story = ownDebuggerData(window, 'story');
		if (!story) return;
		applyDebuggerCollection(
			snapshot,
			sections,
			'storyVariables',
			debuggerVariables(ownDebuggerData(story, 'state'), budgets.storyVariables)
		);
		applyDebuggerCollection(
			snapshot,
			sections,
			'visitedPassages',
			debuggerPassages(ownDebuggerData(story, 'history'), 'localId', budgets.visitedPassages)
		);
	}

	var DEBUGGER_CAPTURE_HANDLERS = {
		'current-only': captureCurrentOnly,
		snowman: captureSnowman,
		sugarcube: captureSugarCube
	};

	function captureDebuggerSnapshot(adapter, currentPassage) {
		try {
			var currentReasons = [];
			var boundedCurrentPassage = debuggerPassage(currentPassage, currentReasons);
			var sections = {
				currentPassage: boundedCurrentPassage
					? debuggerSectionStatus(currentReasons)
					: {state: 'unavailable'}
			};
			var snapshot = {
				adapterId: adapter.id,
				protocolVersion: DEBUGGER_PROTOCOL_VERSION,
				sections: sections
			};
			if (boundedCurrentPassage) snapshot.currentPassage = boundedCurrentPassage;
			var remaining = DEBUGGER_TOTAL_TEXT_LIMIT - debuggerPassageTextLength(boundedCurrentPassage);
			var budgets = debuggerCollectionBudgets(adapter, remaining > 0 ? remaining : 0);
			var handler = DEBUGGER_CAPTURE_HANDLERS[adapter.captureHandler];
			if (typeof handler === 'function') handler(snapshot, sections, budgets);
			for (var index = 0; index < adapter.capabilities.length; index++) {
				var capability = adapter.capabilities[index];
				if (!sections[capability]) sections[capability] = {state: 'unavailable'};
			}
			post('debugger-snapshot', snapshot);
		} catch (error) {}
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
			if (
				(typeof values[index] === 'string' || typeof values[index] === 'number') &&
				debuggerString(values[index]).length > 0
			) {
				return debuggerString(values[index]);
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

			if (!debuggerIsArray(timeline) || timeline.length === 0) {
				return undefined;
			}

			var current = timeline[timeline.length - 1];
			var name =
				typeof current === 'string'
					? current
					: current && typeof current === 'object' && !debuggerIsArray(current)
						? ownDebuggerData(current, 'passage')
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
		var passage = ownDebuggerData(window, 'passage');
		if (passage && typeof passage === 'object') {
			var passageResult = {
				localId: firstValue([
					ownDebuggerData(passage, 'id'),
					ownDebuggerData(passage, 'pid')
				]),
				name: firstValue([
					ownDebuggerData(passage, 'name'),
					ownDebuggerData(passage, 'title')
				]),
				source: 'runtime'
			};
			if (passageResult.localId || passageResult.name) return passageResult;
		}

		var upperState = ownDebuggerData(window, 'State');
		var upperStatePassage = upperState && ownDebuggerData(upperState, 'passage');
		var upperStateName = firstValue([upperStatePassage]);
		if (upperStateName) return {name: upperStateName, source: 'runtime'};

		var lowerState = ownDebuggerData(window, 'state');
		var lowerStatePassage = lowerState && ownDebuggerData(lowerState, 'passage');
		var lowerStateName = firstValue([lowerStatePassage]);
		if (lowerStateName) return {name: lowerStateName, source: 'runtime'};

		var sugarCube = ownDebuggerData(window, 'SugarCube');
		var sugarCubeState = sugarCube && ownDebuggerData(sugarCube, 'State');
		var sugarCubePassage =
			sugarCubeState && auditedSugarCubeStateData(sugarCubeState, 'passage');
		var sugarCubeName = firstValue([sugarCubePassage]);
		if (sugarCubeName) {
			return {name: sugarCubeName, source: 'SugarCube State'};
		}

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
		captureDebuggerSnapshot(
			selectedDebuggerAdapter || debuggerAdapter(),
			currentPassage
		);

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
		selectedDebuggerAdapter = debuggerAdapter();
		post('debugger-hello', {
			adapterId: selectedDebuggerAdapter.id,
			capabilities: selectedDebuggerAdapter.capabilities,
			format: selectedDebuggerAdapter.format,
			formatVersion: selectedDebuggerAdapter.formatVersion,
			protocolVersion: DEBUGGER_PROTOCOL_VERSION,
			reliability: selectedDebuggerAdapter.reliability
		});
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
		debugger: {},
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

	if (message.type === 'debugger-hello') {
		const hello = canonicalDebuggerHello(message);
		if (model.debugger.hello || !hello) {
			return model;
		}
		return {
			...model,
			debugger: {
				hello
			}
		};
	}

	if (message.type === 'debugger-snapshot') {
		const hello = model.debugger.hello;
		if (
			!hello ||
			hello.protocolVersion !== message.protocolVersion ||
			hello.id !== message.adapterId
		) {
			return model;
		}
		const sections = debuggerSectionsFromUnknown(
			message.sections,
			message.adapterId
		);
		if (!sections) {
			return model;
		}
		const capabilities = hello.capabilities;
		if (
			(message.currentPassage !== undefined &&
				!capabilities.includes('currentPassage')) ||
			(message.storyVariables !== undefined &&
				!capabilities.includes('storyVariables')) ||
			(message.temporaryVariables !== undefined &&
				!capabilities.includes('temporaryVariables')) ||
			(message.visitedPassages !== undefined &&
				!capabilities.includes('visitedPassages'))
		) {
			return model;
		}
		return {
			...model,
			debugger: {
				...model.debugger,
				snapshot: {
					adapterId: message.adapterId!,
					currentPassage: resolveRuntimePassage(
						message.currentPassage,
						passages
					),
					protocolVersion: message.protocolVersion!,
					sections,
					storyVariables: message.storyVariables,
					temporaryVariables: message.temporaryVariables,
					visitedPassages: message.visitedPassages
						?.map(passage => resolveRuntimePassage(passage, passages))
						.filter(
							(passage): passage is StoryPreviewRuntimePassage =>
								passage !== undefined
						)
				}
			}
		};
	}

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
