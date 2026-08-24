import {
	STORY_PREVIEW_COMMAND_CAPABILITIES,
	STORY_PREVIEW_COMMAND_PROTOCOL_VERSION,
	STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS,
	STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
	STORY_PREVIEW_DEBUGGER_TRUNCATION_REASONS,
	STORY_PREVIEW_RESTART_ADAPTER_REGISTRATIONS,
	STORY_PREVIEW_RESTART_RESULT_STATUSES,
	admissionAllowsReadAdapter,
	isStoryPreviewDebuggerAdapterId,
	readAdapterForAdmission,
	readAdapterForObservedFormat,
	storyPreviewDebuggerAdapter,
	storyPreviewRestartHandler
} from './story-preview-debugger-protocol';
import type {
	StoryPreviewCommandCapability,
	StoryPreviewDebuggerAdapterDescriptor,
	StoryPreviewDebuggerAdapterId,
	StoryPreviewDebuggerCapability,
	StoryPreviewDebuggerTruncationReason,
	StoryPreviewRestartResultStatus
} from './story-preview-debugger-protocol';
import {
	NO_PREVIEW_FORMAT_ADMISSION,
	canonicalPreviewFormatAdmission,
	previewFormatAdmissionForHtml,
	type PreviewFormatAdmission
} from './story-preview-format';
import {harloweStateProfileForAdapter} from './story-preview-harlowe';
import {
	sugarCubeCompatibilityForAdapter,
	sugarCubeReadProfileForAdapter,
	sugarCubeRestartProfileForAdapter
} from './story-preview-sugarcube';

export type {PreviewFormatAdmission} from './story-preview-format';

export const STORY_PREVIEW_BRIDGE_SOURCE = 'twine.rs.preview.bridge';
export const STORY_PREVIEW_COMMAND_SOURCE = 'twine.rs.preview.host-command';

export const STORY_PREVIEW_RUNTIME_LOG_LIMIT = 12;
const maxRuntimeTimestamp = 8_640_000_000_000_000;

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
	bootstrapChallengeLength: 64,
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
	commandRequestIdLength: 128,
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
	/** Original runtime ID retained for display; `id` remains descriptor-resolved. */
	rawId?: string;
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

/**
 * Produces the host-owned clipboard representation of the bounded runtime
 * console. Entries intentionally retain their existing newest-first order.
 */
export function serializeStoryPreviewRuntimeLog(
	logs: StoryPreviewRuntimeLogEntry[]
): string {
	if (!Array.isArray(logs) || logs.length > STORY_PREVIEW_RUNTIME_LOG_LIMIT) {
		throw new TypeError('Invalid runtime log buffer.');
	}

	return logs
		.map(log => {
			if (
				!log ||
				typeof log.time !== 'number' ||
				!Number.isFinite(log.time) ||
				log.time < 0 ||
				log.time > maxRuntimeTimestamp ||
				typeof log.message !== 'string' ||
				log.message.length > STORY_PREVIEW_BRIDGE_LIMITS.totalLogTextLength
			) {
				throw new TypeError('Invalid runtime log entry.');
			}
			const level =
				log.level === 'log'
					? 'LOG'
					: log.level === 'info'
						? 'INFO'
						: log.level === 'warn'
							? 'WARNING'
							: log.level === 'error'
								? 'ERROR'
								: undefined;

			if (!level) {
				throw new TypeError('Invalid runtime log level.');
			}

			return `[${new Date(log.time).toISOString()}] ${level}: ${JSON.stringify(log.message)}`;
		})
		.join('\n');
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
	commands?: {
		adapterId: StoryPreviewDebuggerAdapterId;
		capabilities: StoryPreviewCommandCapability[];
		protocolVersion: typeof STORY_PREVIEW_COMMAND_PROTOCOL_VERSION;
	};
	hello?: StoryPreviewDebuggerHello;
	snapshot?: StoryPreviewDebuggerSnapshot;
}

export type StoryPreviewViewportPreset = 'desktop' | 'fit' | 'phone' | 'tablet';

export interface StoryPreviewBridgeMessage {
	args?: string[];
	command?: 'restart';
	commandCapabilities?: StoryPreviewCommandCapability[];
	currentPassage?: StoryPreviewRuntimePassage;
	level?: StoryPreviewRuntimeLogEntry['level'];
	message?: string;
	sessionId: string;
	source: typeof STORY_PREVIEW_BRIDGE_SOURCE;
	time?: number;
	adapterId?: StoryPreviewDebuggerAdapterId;
	bootstrapChallenge?: string;
	capabilities?: StoryPreviewDebuggerCapability[];
	format?: string;
	formatVersion?: string;
	protocolVersion?: typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION;
	requestId?: string;
	reliability?: StoryPreviewDebuggerAdapterDescriptor['reliability'];
	sections?: StoryPreviewDebuggerSections;
	storyVariables?: StoryPreviewDebuggerVariable[];
	temporaryVariables?: StoryPreviewDebuggerVariable[];
	type:
		| 'console'
		| 'debugger-bootstrap-arm'
		| 'debugger-bootstrap-ready'
		| 'debugger-command-hello'
		| 'debugger-command-result'
		| 'debugger-hello'
		| 'debugger-snapshot'
		| 'runtime-error'
		| 'state';
	visitedPassages?: StoryPreviewRuntimePassage[];
	viewport?: StoryPreviewRuntimeViewport;
	status?: StoryPreviewRestartResultStatus;
}

interface CanonicalStoryPreviewBridgeMessageBase {
	sessionId: string;
	source: typeof STORY_PREVIEW_BRIDGE_SOURCE;
	time?: number;
}

/** A fully copied and admission-authorized message safe for reducer input. */
export type CanonicalStoryPreviewBridgeMessage =
	| (CanonicalStoryPreviewBridgeMessageBase & {
			adapterId: 'harlowe-3.3.9';
			bootstrapChallenge: string;
			protocolVersion: typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION;
			type: 'debugger-bootstrap-ready';
	  })
	| (CanonicalStoryPreviewBridgeMessageBase & {
			adapterId: 'harlowe-3.3.9';
			protocolVersion: typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION;
			type: 'debugger-bootstrap-arm';
	  })
	| (CanonicalStoryPreviewBridgeMessageBase & {
			args: string[];
			level: StoryPreviewRuntimeLogEntry['level'];
			type: 'console';
	  })
	| (CanonicalStoryPreviewBridgeMessageBase & {
			level: StoryPreviewRuntimeLogEntry['level'];
			message: string;
			type: 'runtime-error';
	  })
	| (CanonicalStoryPreviewBridgeMessageBase & {
			currentPassage?: StoryPreviewRuntimePassage;
			type: 'state';
			viewport?: StoryPreviewRuntimeViewport;
	  })
	| (CanonicalStoryPreviewBridgeMessageBase & {
			adapterId: StoryPreviewDebuggerAdapterId;
			capabilities: StoryPreviewDebuggerCapability[];
			format: string;
			formatVersion: string;
			protocolVersion: typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION;
			reliability: StoryPreviewDebuggerAdapterDescriptor['reliability'];
			type: 'debugger-hello';
	  })
	| (CanonicalStoryPreviewBridgeMessageBase & {
			adapterId: StoryPreviewDebuggerAdapterId;
			commandCapabilities: StoryPreviewCommandCapability[];
			protocolVersion: typeof STORY_PREVIEW_COMMAND_PROTOCOL_VERSION;
			type: 'debugger-command-hello';
	  })
	| (CanonicalStoryPreviewBridgeMessageBase & {
			adapterId: StoryPreviewDebuggerAdapterId;
			command: 'restart';
			protocolVersion: typeof STORY_PREVIEW_COMMAND_PROTOCOL_VERSION;
			requestId: string;
			status: StoryPreviewRestartResultStatus;
			type: 'debugger-command-result';
	  })
	| (CanonicalStoryPreviewBridgeMessageBase & {
			adapterId: StoryPreviewDebuggerAdapterId;
			currentPassage?: StoryPreviewRuntimePassage;
			protocolVersion: typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION;
			sections: StoryPreviewDebuggerSections;
			storyVariables?: StoryPreviewDebuggerVariable[];
			temporaryVariables?: StoryPreviewDebuggerVariable[];
			type: 'debugger-snapshot';
			visitedPassages?: StoryPreviewRuntimePassage[];
	  });

export interface PreviewBridgeContext {
	admission: PreviewFormatAdmission;
	bridgeSessionId: string;
	generation: number;
	harloweBootstrapChallenge?: string;
	sugarCubeRestartEligible: boolean;
}

export interface StoryPreviewRestartCommandRequest {
	adapterId: StoryPreviewDebuggerAdapterId;
	command: 'restart';
	protocolVersion: typeof STORY_PREVIEW_COMMAND_PROTOCOL_VERSION;
	requestId: string;
	sessionId: string;
	source: typeof STORY_PREVIEW_COMMAND_SOURCE;
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
			message: CanonicalStoryPreviewBridgeMessage;
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
	>,
	context: PreviewBridgeContext
): StoryPreviewDebuggerHello | undefined {
	if (
		value.protocolVersion !== STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION ||
		typeof value.format !== 'string' ||
		typeof value.formatVersion !== 'string'
	) {
		return undefined;
	}

	const expected =
		readAdapterForAdmission(context.admission) ??
		readAdapterForObservedFormat(value.format, value.formatVersion);

	if (!expected) {
		return undefined;
	}
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

function debuggerSectionsFromUnknown(
	value: unknown,
	expected: readonly StoryPreviewDebuggerCapability[]
): StoryPreviewDebuggerSections | undefined {
	if (!isRecord(value)) {
		return undefined;
	}

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
	data: unknown,
	context: PreviewBridgeContext
): CanonicalStoryPreviewBridgeMessage | undefined {
	if (!isRecord(data) || data.source !== STORY_PREVIEW_BRIDGE_SOURCE) {
		return undefined;
	}
	const admission = canonicalPreviewFormatAdmission(context.admission);

	if (!admission || context.bridgeSessionId !== data.sessionId) {
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
				  data.time >= 0 &&
				  data.time <= maxRuntimeTimestamp
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

			totalTextLength += argument.length + (args.length ? 1 : 0);

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
		const hello = canonicalDebuggerHello(
			{
				adapterId: data.adapterId as StoryPreviewDebuggerAdapterId | undefined,
				capabilities: data.capabilities as
					StoryPreviewDebuggerCapability[] | undefined,
				format,
				formatVersion,
				protocolVersion: data.protocolVersion as
					typeof STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION | undefined,
				reliability: data.reliability as
					StoryPreviewDebuggerAdapterDescriptor['reliability'] | undefined
			},
			{...context, admission}
		);
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

	if (
		data.type === 'debugger-bootstrap-arm' ||
		data.type === 'debugger-bootstrap-ready'
	) {
		const expectedChallenge = context.harloweBootstrapChallenge;
		const bootstrapChallenge =
			data.type === 'debugger-bootstrap-ready'
				? boundedString(
						data.bootstrapChallenge,
						STORY_PREVIEW_BRIDGE_LIMITS.bootstrapChallengeLength
					)
				: undefined;
		if (
			admission.kind !== 'builtin-sha256' ||
			admission.format !== 'Harlowe' ||
			data.adapterId !== admission.adapterId ||
			data.protocolVersion !== STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION ||
			typeof expectedChallenge !== 'string' ||
			!/^[0-9a-f]{64}$/.test(expectedChallenge) ||
			(data.type === 'debugger-bootstrap-ready' &&
				(bootstrapChallenge !== expectedChallenge ||
					!/^[0-9a-f]{64}$/.test(bootstrapChallenge)))
		) {
			return undefined;
		}

		if (data.type === 'debugger-bootstrap-ready') {
			return {
				adapterId: 'harlowe-3.3.9',
				bootstrapChallenge: bootstrapChallenge!,
				protocolVersion: STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
				sessionId,
				source: STORY_PREVIEW_BRIDGE_SOURCE,
				time,
				type: 'debugger-bootstrap-ready'
			};
		}

		return {
			adapterId: 'harlowe-3.3.9',
			protocolVersion: STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION,
			sessionId,
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time,
			type: 'debugger-bootstrap-arm'
		};
	}

	if (data.type === 'debugger-command-hello') {
		const compatibility = sugarCubeCompatibilityForAdapter(data.adapterId);
		const adapterAuthorized = compatibility
			? admission.kind === 'builtin-sha256' &&
				admission.format === 'SugarCube' &&
				admission.adapterId === data.adapterId &&
				context.sugarCubeRestartEligible === true
			: data.adapterId === 'harlowe-3.3.9'
				? admission.kind === 'none' ||
					(admission.kind === 'builtin-sha256' &&
						admission.format === 'Harlowe' &&
						admission.adapterId === data.adapterId)
				: admission.kind === 'none';

		if (
			data.protocolVersion !== STORY_PREVIEW_COMMAND_PROTOCOL_VERSION ||
			!isStoryPreviewDebuggerAdapterId(data.adapterId) ||
			!storyPreviewRestartHandler(data.adapterId) ||
			!adapterAuthorized ||
			!Array.isArray(data.commandCapabilities) ||
			data.commandCapabilities.length !==
				STORY_PREVIEW_COMMAND_CAPABILITIES.length ||
			data.commandCapabilities.some(
				(capability, index) =>
					capability !== STORY_PREVIEW_COMMAND_CAPABILITIES[index]
			)
		) {
			return undefined;
		}

		return {
			adapterId: data.adapterId,
			commandCapabilities: [...STORY_PREVIEW_COMMAND_CAPABILITIES],
			protocolVersion: STORY_PREVIEW_COMMAND_PROTOCOL_VERSION,
			sessionId,
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			time,
			type: 'debugger-command-hello'
		};
	}

	if (data.type === 'debugger-command-result') {
		const requestId = boundedString(
			data.requestId,
			STORY_PREVIEW_BRIDGE_LIMITS.commandRequestIdLength
		);

		const compatibility = sugarCubeCompatibilityForAdapter(data.adapterId);
		const adapterAuthorized = compatibility
			? admission.kind === 'builtin-sha256' &&
				admission.format === 'SugarCube' &&
				admission.adapterId === data.adapterId &&
				context.sugarCubeRestartEligible === true
			: data.adapterId === 'harlowe-3.3.9'
				? admission.kind === 'none' ||
					(admission.kind === 'builtin-sha256' &&
						admission.format === 'Harlowe' &&
						admission.adapterId === data.adapterId)
				: admission.kind === 'none';

		if (
			data.protocolVersion !== STORY_PREVIEW_COMMAND_PROTOCOL_VERSION ||
			data.command !== 'restart' ||
			!requestId ||
			!isStoryPreviewDebuggerAdapterId(data.adapterId) ||
			!storyPreviewRestartHandler(data.adapterId) ||
			!adapterAuthorized ||
			!STORY_PREVIEW_RESTART_RESULT_STATUSES.includes(
				data.status as StoryPreviewRestartResultStatus
			)
		) {
			return undefined;
		}

		return {
			adapterId: data.adapterId,
			command: 'restart',
			protocolVersion: STORY_PREVIEW_COMMAND_PROTOCOL_VERSION,
			requestId,
			sessionId,
			source: STORY_PREVIEW_BRIDGE_SOURCE,
			status: data.status as StoryPreviewRestartResultStatus,
			time,
			type: 'debugger-command-result'
		};
	}

	if (data.type === 'debugger-snapshot') {
		const exactAdapter = readAdapterForAdmission(admission);
		const adapter = exactAdapter
			? exactAdapter.id === data.adapterId
				? exactAdapter
				: undefined
			: admissionAllowsReadAdapter(admission, data.adapterId)
				? data.adapterId === 'generic'
					? {
							capabilities: ['currentPassage'] as const,
							format: '',
							formatVersion: '',
							id: 'generic' as const,
							reliability: 'best-effort' as const
						}
					: storyPreviewDebuggerAdapter(data.adapterId)
				: undefined;

		if (
			data.protocolVersion !== STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION ||
			!isStoryPreviewDebuggerAdapterId(data.adapterId) ||
			!adapter
		) {
			return undefined;
		}
		const adapterId = data.adapterId;
		const capabilities = adapter.capabilities;
		const sections = debuggerSectionsFromUnknown(data.sections, capabilities);
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
	data: unknown,
	context: PreviewBridgeContext
): data is CanonicalStoryPreviewBridgeMessage {
	return normalizeStoryPreviewBridgeMessage(data, context) !== undefined;
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
	enableHarloweSessionStorageFallback: boolean,
	admission: PreviewFormatAdmission,
	enableSugarCubeRestart: boolean
) {
	const admittedAdapter = readAdapterForAdmission(admission);
	const harloweStateProfile =
		admission.kind === 'builtin-sha256' && admission.format === 'Harlowe'
			? harloweStateProfileForAdapter(admission.adapterId)
			: undefined;
	const sugarCubeReadProfile =
		admission.kind === 'builtin-sha256'
			? sugarCubeReadProfileForAdapter(admission.adapterId)
			: undefined;
	const sugarCubeRestartProfile =
		admission.kind === 'builtin-sha256'
			? sugarCubeRestartProfileForAdapter(admission.adapterId)
			: undefined;

	return `
<script>
${STORY_PREVIEW_VIEW_TRANSITION_GUARD_SOURCE}
(function () {
	var SOURCE = ${JSON.stringify(STORY_PREVIEW_BRIDGE_SOURCE)};
	var COMMAND_SOURCE = ${JSON.stringify(STORY_PREVIEW_COMMAND_SOURCE)};
	var SESSION = ${JSON.stringify(sessionId)};
	var ENABLE_HARLOWE_SESSION_STORAGE_FALLBACK = ${JSON.stringify(
		enableHarloweSessionStorageFallback
	)};
	var MAX_ARGUMENTS = ${STORY_PREVIEW_BRIDGE_LIMITS.logArgumentCount};
	var MAX_ARGUMENT_LENGTH = ${STORY_PREVIEW_BRIDGE_LIMITS.logArgumentLength};
	var MAX_MESSAGE_LENGTH = ${STORY_PREVIEW_BRIDGE_LIMITS.logMessageLength};
	var DEBUGGER_PROTOCOL_VERSION = ${STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION};
	var COMMAND_PROTOCOL_VERSION = ${STORY_PREVIEW_COMMAND_PROTOCOL_VERSION};
	var DEBUGGER_ADAPTER_REGISTRATIONS = ${JSON.stringify(
		STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS
	)};
	var RESTART_ADAPTER_REGISTRATIONS = ${JSON.stringify(
		STORY_PREVIEW_RESTART_ADAPTER_REGISTRATIONS
	)};
	var FIXED_READ_ADAPTER = ${JSON.stringify(admittedAdapter)};
	var ENABLE_SUGARCUBE_RESTART = ${JSON.stringify(enableSugarCubeRestart)};
	var DEBUGGER_VARIABLE_LIMIT = ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerVariableCount};
	var DEBUGGER_HISTORY_LIMIT = ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerVisitedPassageCount};
	var DEBUGGER_PREVIEW_LIMIT = ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerPreviewLength};
	var DEBUGGER_TOTAL_TEXT_LIMIT = ${STORY_PREVIEW_BRIDGE_LIMITS.debuggerTotalTextLength};
	var DEBUGGER_STRING_LIMIT = 512;
	var MAX_FORMAT_SESSION_LENGTH = 1024 * 1024;
	var STARTUP_STATE_CAPTURE_DELAYS = [250, 500, 1000, 2000, 4000];
	var harloweSessionStorage;
	var harloweSessionStorageIsFallback = false;
	var pendingState = 0;
	var pendingStartupState = 0;
	var startupStateCaptureIndex = 0;
	var selectedDebuggerAdapter;
	var harloweState;
	var harlowePassageGetter;
	var harloweBootstrapConsumed = false;
	var restartCommandBusy = false;
	// A null value means Chapbook emitted a trail update which could not be copied
	// safely. Keep that distinct from startup, when no trail event has arrived.
	var chapbookCurrentPassage;
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
	var debuggerAddEventListener = EventTarget.prototype.addEventListener;
	var debuggerDispatchEvent = EventTarget.prototype.dispatchEvent;
	var debuggerStopImmediatePropagation = Event.prototype.stopImmediatePropagation;
	var debuggerMessageEventPortsDescriptor = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'ports');
	var debuggerMessageEventPorts = debuggerMessageEventPortsDescriptor
		? debuggerMessageEventPortsDescriptor.get
		: undefined;
	var debuggerMessagePort = typeof MessagePort === 'function' ? MessagePort : undefined;
	var debuggerMessagePortAddEventListener = debuggerMessagePort
		? debuggerMessagePort.prototype.addEventListener
		: undefined;
	var debuggerMessagePortPostMessage = debuggerMessagePort
		? debuggerMessagePort.prototype.postMessage
		: undefined;
	var debuggerMessagePortStart = debuggerMessagePort
		? debuggerMessagePort.prototype.start
		: undefined;
	var debuggerCustomEvent = window.CustomEvent;
	var debuggerHistory = window.history;
	var debuggerHistoryReplaceStateDescriptor = Object.getOwnPropertyDescriptor(History.prototype, 'replaceState');
	var debuggerHistoryReplaceState = debuggerHistoryReplaceStateDescriptor
		? debuggerHistoryReplaceStateDescriptor.value
		: debuggerHistory.replaceState;
	var debuggerLocation = window.location;
	var debuggerLocationHref = function () { return debuggerLocation.href; };
	var debuggerStringIndexOf = String.prototype.indexOf;
	var debuggerStringSlice = String.prototype.slice;
	var debuggerStorageGetItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'getItem').value;
	var debuggerStorageRemoveItem = Object.getOwnPropertyDescriptor(Storage.prototype, 'removeItem').value;
	var debuggerDateGetTime = Date.prototype.getTime;
	var debuggerRegExpSource = Object.getOwnPropertyDescriptor(RegExp.prototype, 'source').get;
	var debuggerRegExpTest = RegExp.prototype.test;
	var debuggerCustomEventDetail = Object.getOwnPropertyDescriptor(window.CustomEvent.prototype, 'detail').get;
	var DEBUGGER_SUGARCUBE_STATE_ACCESSORS = ${JSON.stringify(
		sugarCubeReadProfile ?? {}
	)};
	var DEBUGGER_HARLOWE_STATE_PROFILE = ${JSON.stringify(
		harloweStateProfile ?? {}
	)};
	var SUGARCUBE_RESET_SOURCE = ${JSON.stringify(
		sugarCubeRestartProfile?.resetSource ?? ''
	)};
	var SUGARCUBE_ENGINE_RESTART_SOURCE = ${JSON.stringify(
		sugarCubeRestartProfile?.engineRestartSource ?? ''
	)};
	var CHAPBOOK_RESET_SOURCE = ${JSON.stringify(
		'function bt(){function n(e,t){Object.keys(e).forEach(r=>{const i=t===""?r:`${t}.${r}`;if(typeof e[r]=="object"&&!Array.isArray(e[r]))n(e[r],i);else{const s=e[r];delete e[r],Wi(window,t),window.dispatchEvent(new CustomEvent("state-change",{detail:{name:i,value:p(i),previous:s}}))}})}n(ce,""),window.dispatchEvent(new CustomEvent("state-reset")),p("config.state.autosave")&&yt()}'
	)};
	var CHAPBOOK_SAVE_SOURCE = ${JSON.stringify(
		'function yt(){Q("Saving to local storage: "+JSON.stringify(xe())),window.localStorage.setItem(te,JSON.stringify(xe())),Q("Save complete")}'
	)};
	var restartFrameNamePrefix = 'twine-rs-restart:' + SESSION + ':';
	var harloweBootstrapAttested = false;
	var harloweBootstrapReadyChallenge;
	var harloweReadinessPort;
	var harloweReadinessChallenge;
	var harloweReadinessChallengePattern = /^[0-9a-f]{64}$/;
	var sugarCubeRestartRemount = false;
	try {
		sugarCubeRestartRemount =
			ENABLE_SUGARCUBE_RESTART &&
			typeof window.name === 'string' &&
			debuggerReflectApply(debuggerStringSlice, window.name, [0, restartFrameNamePrefix.length]) === restartFrameNamePrefix &&
			window.name.length > restartFrameNamePrefix.length &&
			window.name.length <= restartFrameNamePrefix.length + ${STORY_PREVIEW_BRIDGE_LIMITS.commandRequestIdLength};
		if (sugarCubeRestartRemount) window.name = '';
	} catch (error) {}

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

		Object.freeze(storage);
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
			harloweSessionStorageIsFallback = true;
		} catch (error) {}
	}

	installHarloweSessionStorageFallback();

	function sugarCubeStart(engine, config) {
		var start = ownDebuggerData(engine, 'start');
		if (typeof start !== 'function') {
			throw new Error('SugarCube startup is unavailable.');
		}
		if (!sugarCubeRestartRemount) {
			return debuggerReflectApply(start, engine, []);
		}

		var saves = ownDebuggerData(config, 'saves');
		if (!saves || (typeof saves !== 'object' && typeof saves !== 'function')) {
			throw new Error('SugarCube autoload configuration is unavailable.');
		}
		var configuredAutoload = saves.autoload;
		saves.autoload = null;
		try {
			return debuggerReflectApply(start, engine, []);
		} finally {
			saves.autoload = configuredAutoload;
		}
	}

	if (ENABLE_SUGARCUBE_RESTART) {
		try {
			Object.defineProperty(window, '__twineRsPreviewSugarCubeStart', {
				configurable: false,
				enumerable: false,
				value: sugarCubeStart,
				writable: false
			});
		} catch (error) {}
	}

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
		if (FIXED_READ_ADAPTER) return FIXED_READ_ADAPTER;
		var storyData = document.querySelector('tw-storydata');
		var format = storyData ? storyData.getAttribute('format') || '' : '';
		var formatVersion = storyData ? storyData.getAttribute('format-version') || '' : '';
		var ids = debuggerObjectKeys(DEBUGGER_ADAPTER_REGISTRATIONS);
		for (var index = 0; index < ids.length; index++) {
			var adapter = DEBUGGER_ADAPTER_REGISTRATIONS[ids[index]];
			if (adapter.format === 'SugarCube') continue;
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

	function isChapbook231Runtime() {
		var storyData = document.querySelector('tw-storydata');
		return Boolean(
			storyData &&
			storyData.getAttribute('format') === 'Chapbook' &&
			storyData.getAttribute('format-version') === '2.3.1'
		);
	}

	function captureChapbookPassage(event) {
		if (!isChapbook231Runtime()) return;

		var detail;
		try {
			detail = debuggerReflectApply(debuggerCustomEventDetail, event, []);
		} catch (error) {
			return;
		}

		if (!detail || typeof detail !== 'object') return;
		if (ownDebuggerData(detail, 'name') !== 'trail') return;

		var current;
		try {
			var trail = ownDebuggerData(detail, 'value');
			var length = debuggerIsArray(trail)
				? ownDebuggerData(trail, 'length')
				: undefined;
			current =
				typeof length === 'number' && debuggerIsFinite(length) && length > 0
					? ownDebuggerData(trail, debuggerString(debuggerFloor(length) - 1))
					: undefined;
		} catch (error) {}

		chapbookCurrentPassage =
			typeof current === 'string' &&
			current.length > 0 &&
			current.length <= ${STORY_PREVIEW_BRIDGE_LIMITS.passageFieldLength}
				? current
				: null;
		queueState();
	}

	// The bridge runs in the document head, before Chapbook initializes. Listen
	// immediately so the startup trail assignment is captured as well.
	window.addEventListener('state-change', captureChapbookPassage);

	function auditedSugarCubeStateData(state, key) {
		try {
			var expectedSource = DEBUGGER_SUGARCUBE_STATE_ACCESSORS[key];
			var descriptor = debuggerGetOwnPropertyDescriptor(state, key);
			if (
				!expectedSource ||
					!debuggerIsFrozen(state) ||
					!descriptor ||
					descriptor.configurable ||
					descriptor.enumerable ||
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

	function acceptHarloweState(state) {
		if (harloweBootstrapConsumed) return;
		harloweBootstrapConsumed = true;

		try {
			if (
				!FIXED_READ_ADAPTER ||
				FIXED_READ_ADAPTER.captureHandler !== 'harlowe-state' ||
				!state ||
				(typeof state !== 'object' && typeof state !== 'function') ||
				DEBUGGER_HARLOWE_STATE_PROFILE.stateFrozen !== true ||
				!debuggerIsFrozen(state)
			) {
				return;
			}

			var passageProfile = ownDebuggerData(
				DEBUGGER_HARLOWE_STATE_PROFILE,
				'passage'
			);
			var onProfile = ownDebuggerData(DEBUGGER_HARLOWE_STATE_PROFILE, 'on');
			var passageDescriptor = debuggerGetOwnPropertyDescriptor(state, 'passage');
			var onDescriptor = debuggerGetOwnPropertyDescriptor(state, 'on');
			if (
				!passageProfile ||
				!onProfile ||
				!passageDescriptor ||
				passageDescriptor.configurable !== passageProfile.configurable ||
				passageDescriptor.enumerable !== passageProfile.enumerable ||
				typeof passageDescriptor.get !== 'function' ||
				passageDescriptor.set !== undefined ||
				debuggerReflectApply(
					debuggerFunctionToString,
					passageDescriptor.get,
					[]
				) !== passageProfile.getterSource ||
				!onDescriptor ||
				!debuggerReflectApply(debuggerHasOwn, onDescriptor, ['value']) ||
				onDescriptor.configurable !== onProfile.configurable ||
				onDescriptor.enumerable !== onProfile.enumerable ||
				onDescriptor.writable !== onProfile.writable ||
				typeof onDescriptor.value !== 'function' ||
				debuggerReflectApply(
					debuggerFunctionToString,
					onDescriptor.value,
					[]
				) !== onProfile.source
			) {
				return;
			}

			var events = ownDebuggerData(
				ownDebuggerData(DEBUGGER_HARLOWE_STATE_PROFILE, 'events'),
				'capture'
			);
			if (!debuggerIsArray(events)) return;
			for (var eventIndex = 0; eventIndex < events.length; eventIndex++) {
				var eventName = ownDebuggerData(events, debuggerString(eventIndex));
				if (typeof eventName !== 'string') return;
				debuggerReflectApply(onDescriptor.value, state, [
					eventName,
					function () {
						try { queueState(); } catch (error) {}
					}
				]);
			}

			harloweState = state;
			harlowePassageGetter = passageDescriptor.get;
			harloweBootstrapAttested = true;
			postHarloweBootstrapReady();
			queueState();
		} catch (error) {
			harloweState = undefined;
			harlowePassageGetter = undefined;
		}
	}

	function postHarloweBootstrapReady() {
		if (
			!harloweBootstrapAttested ||
			!harloweReadinessPort ||
			!debuggerMessagePortPostMessage ||
			typeof harloweReadinessChallenge !== 'string' ||
			harloweBootstrapReadyChallenge === harloweReadinessChallenge
		) {
			return;
		}
		harloweBootstrapReadyChallenge = harloweReadinessChallenge;
		try {
			debuggerReflectApply(debuggerMessagePortPostMessage, harloweReadinessPort, [{
				adapterId: FIXED_READ_ADAPTER.id,
				bootstrapChallenge: harloweReadinessChallenge,
				protocolVersion: DEBUGGER_PROTOCOL_VERSION,
				sessionId: SESSION,
				source: SOURCE,
				time: Date.now(),
				type: 'debugger-bootstrap-ready'
			}]);
		} catch (error) {}
	}

	function acceptHarloweReadinessChallenge(event) {
		try {
			var data = event.data;
			if (
				!data ||
				typeof data !== 'object' ||
				ownDebuggerData(data, 'source') !== COMMAND_SOURCE ||
				ownDebuggerData(data, 'sessionId') !== SESSION ||
				ownDebuggerData(data, 'type') !== 'debugger-bootstrap-challenge' ||
				ownDebuggerData(data, 'adapterId') !== FIXED_READ_ADAPTER.id ||
				ownDebuggerData(data, 'protocolVersion') !== DEBUGGER_PROTOCOL_VERSION
			) {
				return;
			}
			var challenge = ownDebuggerData(data, 'bootstrapChallenge');
			if (
				typeof challenge !== 'string' ||
				challenge.length !== ${STORY_PREVIEW_BRIDGE_LIMITS.bootstrapChallengeLength} ||
				!debuggerReflectApply(debuggerRegExpTest, harloweReadinessChallengePattern, [challenge])
			) {
				return;
			}
			if (harloweReadinessChallenge === challenge) return;
			harloweReadinessChallenge = challenge;
			postHarloweBootstrapReady();
		} catch (error) {}
	}

	function acceptHarloweReadinessPort(event) {
		try {
			var data = event.data;
			if (
				!debuggerMessageEventPorts ||
				!debuggerMessagePortAddEventListener ||
				!debuggerMessagePortStart ||
				event.source !== parent ||
				!data ||
				typeof data !== 'object' ||
				ownDebuggerData(data, 'source') !== COMMAND_SOURCE ||
				ownDebuggerData(data, 'sessionId') !== SESSION ||
				ownDebuggerData(data, 'type') !== 'debugger-bootstrap-port' ||
				ownDebuggerData(data, 'adapterId') !== FIXED_READ_ADAPTER.id ||
				ownDebuggerData(data, 'protocolVersion') !== DEBUGGER_PROTOCOL_VERSION
			) {
				return;
			}
			debuggerReflectApply(debuggerStopImmediatePropagation, event, []);
			if (harloweReadinessPort) return;
			var ports = debuggerReflectApply(debuggerMessageEventPorts, event, []);
			var port = ports && ports.length === 1 ? ports[0] : undefined;

			if (!port) return;
			harloweReadinessPort = port;
			debuggerReflectApply(debuggerMessagePortAddEventListener, port, [
				'message',
				acceptHarloweReadinessChallenge
			]);
			debuggerReflectApply(debuggerMessagePortStart, port, []);
		} catch (error) {}
	}

	if (FIXED_READ_ADAPTER && FIXED_READ_ADAPTER.captureHandler === 'harlowe-state') {
		try {
			Object.defineProperty(window, '__twineRsPreviewHarloweBootstrap', {
				configurable: false,
				enumerable: false,
				value: acceptHarloweState,
				writable: false
			});
			window.addEventListener('message', acceptHarloweReadinessPort, true);
			post('debugger-bootstrap-arm', {
				adapterId: FIXED_READ_ADAPTER.id,
				protocolVersion: DEBUGGER_PROTOCOL_VERSION
			});
		} catch (error) {}
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
		'harlowe-state': captureCurrentOnly,
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

	function verifiedOwnFunction(object, key, expectedSource) {
		if (!object || (typeof object !== 'object' && typeof object !== 'function')) {
			return;
		}
		var descriptor = debuggerGetOwnPropertyDescriptor(object, key);
		if (
			!descriptor ||
			!debuggerReflectApply(debuggerHasOwn, descriptor, ['value']) ||
			typeof descriptor.value !== 'function'
		) {
			return;
		}
		try {
			if (
				expectedSource &&
				debuggerReflectApply(debuggerFunctionToString, descriptor.value, []) !== expectedSource
			) {
				return;
			}
		} catch (error) {
			return;
		}
		return descriptor.value;
	}

	function verifiedFrozenOwnFunction(object, key, expectedSource) {
		if (!object || !debuggerIsFrozen(object) || !expectedSource) return;
		var descriptor = debuggerGetOwnPropertyDescriptor(object, key);
		if (
			!descriptor ||
			!debuggerReflectApply(debuggerHasOwn, descriptor, ['value']) ||
			descriptor.configurable ||
			descriptor.enumerable ||
			descriptor.writable ||
			typeof descriptor.value !== 'function'
		) {
			return;
		}
		try {
			if (
				debuggerReflectApply(debuggerFunctionToString, descriptor.value, []) !==
				expectedSource
			) {
				return;
			}
		} catch (error) {
			return;
		}
		return descriptor.value;
	}

	function restartSugarCube() {
		if (!ENABLE_SUGARCUBE_RESTART) return 'unavailable';
		var sugarCube = ownDebuggerData(window, 'SugarCube');
		var state = ownDebuggerData(sugarCube, 'State');
		var engine = ownDebuggerData(sugarCube, 'Engine');
		var reset = verifiedFrozenOwnFunction(
			state,
			'reset',
			SUGARCUBE_RESET_SOURCE
		);
		var restartCanary = verifiedFrozenOwnFunction(
			engine,
			'restart',
			SUGARCUBE_ENGINE_RESTART_SOURCE
		);
		if (!reset || !restartCanary) return 'unavailable';

		var mutationStarted = false;
		try {
			mutationStarted = true;
			debuggerReflectApply(reset, state, []);
			var restartEvent = new debuggerCustomEvent(':enginerestart', {
				bubbles: true,
				cancelable: true,
				composed: false,
				detail: null
			});
			debuggerReflectApply(debuggerDispatchEvent, document, [restartEvent]);
			return 'applied';
		} catch (error) {
			return mutationStarted ? 'indeterminate' : 'failed';
		}
	}

	function restartSnowman() {
		if (typeof debuggerHistoryReplaceState !== 'function') return 'unavailable';
		var mutationStarted = false;
		try {
			var href = debuggerReflectApply(debuggerLocationHref, undefined, []);
			var hashIndex = debuggerReflectApply(debuggerStringIndexOf, href, ['#']);
			if (hashIndex >= 0) {
				// A new srcDoc browsing context cannot inherit the old document hash.
				// History.replaceState is forbidden for about:srcdoc, so let the host
				// remount perform the exact same scrub there.
				if (
					debuggerReflectApply(debuggerStringSlice, href, [0, hashIndex]) ===
					'about:srcdoc'
				) return 'applied';
				mutationStarted = true;
				debuggerReflectApply(debuggerHistoryReplaceState, debuggerHistory, [
					null,
					'',
					debuggerReflectApply(debuggerStringSlice, href, [0, hashIndex])
				]);
			}
			return 'applied';
		} catch (error) {
			return mutationStarted ? 'indeterminate' : 'failed';
		}
	}

	function restartChapbook() {
		var engine = ownDebuggerData(window, 'engine');
		var state = ownDebuggerData(engine, 'state');
		if (!state || !debuggerIsFrozen(state)) return 'unavailable';
		var reset = verifiedOwnFunction(state, 'reset', CHAPBOOK_RESET_SOURCE);
		var save = verifiedOwnFunction(state, 'saveToStorage', CHAPBOOK_SAVE_SOURCE);
		if (!reset || !save) return 'unavailable';

		var mutationStarted = false;
		try {
			mutationStarted = true;
			debuggerReflectApply(reset, state, []);
			debuggerReflectApply(save, state, []);
			return 'applied';
		} catch (error) {
			return mutationStarted ? 'indeterminate' : 'failed';
		}
	}

	function restartHarlowe() {
		var storage;
		try {
			storage = harloweSessionStorage || window.sessionStorage;
		} catch (error) {
			return 'failed';
		}
		if (!storage) return 'unavailable';

		var mutationStarted = false;
		try {
			mutationStarted = true;
			if (storage === harloweSessionStorage && harloweSessionStorageIsFallback) {
				storage.removeItem('Saved Session');
				if (storage.getItem('Saved Session') !== null) return 'indeterminate';
			} else {
				debuggerReflectApply(debuggerStorageRemoveItem, storage, ['Saved Session']);
				if (
					debuggerReflectApply(debuggerStorageGetItem, storage, ['Saved Session']) !== null
				) return 'indeterminate';
			}
			return 'applied';
		} catch (error) {
			return mutationStarted ? 'indeterminate' : 'failed';
		}
	}

	var RESTART_HANDLERS = {
		chapbook: restartChapbook,
		harlowe: restartHarlowe,
		snowman: restartSnowman,
		sugarcube: restartSugarCube
	};

	function handleRestartCommand(event) {
		if (event.isTrusted !== true || event.source !== parent) return;
		var data = event.data;
		if (
			!data ||
			typeof data !== 'object' ||
			data.source !== COMMAND_SOURCE ||
			data.sessionId !== SESSION ||
			data.command !== 'restart' ||
			data.protocolVersion !== COMMAND_PROTOCOL_VERSION ||
			!selectedDebuggerAdapter ||
			data.adapterId !== selectedDebuggerAdapter.id ||
			typeof data.requestId !== 'string' ||
			data.requestId.length === 0 ||
			data.requestId.length > ${STORY_PREVIEW_BRIDGE_LIMITS.commandRequestIdLength} ||
			restartCommandBusy
		) {
			return;
		}

		var handlerName = ownDebuggerData(
			RESTART_ADAPTER_REGISTRATIONS,
			selectedDebuggerAdapter.id
		);
		var handler = ownDebuggerData(RESTART_HANDLERS, handlerName);
		if (
			typeof handler !== 'function' ||
			(handlerName === 'sugarcube' && !ENABLE_SUGARCUBE_RESTART)
		) {
			post('debugger-command-result', {
				adapterId: selectedDebuggerAdapter.id,
				command: 'restart',
				protocolVersion: COMMAND_PROTOCOL_VERSION,
				requestId: data.requestId,
				status: 'unavailable'
			});
			return;
		}

		restartCommandBusy = true;
		var status = 'failed';
		try {
			status = debuggerReflectApply(handler, undefined, []);
		} catch (error) {}
		post('debugger-command-result', {
			adapterId: selectedDebuggerAdapter.id,
			command: 'restart',
			protocolVersion: COMMAND_PROTOCOL_VERSION,
			requestId: data.requestId,
			status: status
		});
		restartCommandBusy = false;
	}

	window.addEventListener('message', handleRestartCommand);

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
		if (isChapbook231Runtime()) {
			if (chapbookCurrentPassage) {
				return {name: chapbookCurrentPassage, source: 'Chapbook state-change'};
			}
			if (chapbookCurrentPassage === null) return undefined;
		}

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

	function readExactSugarCubeDebuggerPassage() {
		var sugarCube = ownDebuggerData(window, 'SugarCube');
		var state = sugarCube && ownDebuggerData(sugarCube, 'State');
		var passage = state && auditedSugarCubeStateData(state, 'passage');
		var name = firstValue([passage]);

		return name ? {name: name, source: 'SugarCube State'} : undefined;
	}

	function readExactHarloweDebuggerPassage() {
		if (!harloweState || typeof harlowePassageGetter !== 'function') {
			return undefined;
		}

		try {
			var passage = debuggerReflectApply(
				harlowePassageGetter,
				harloweState,
				[]
			);
			return typeof passage === 'string' && passage.length > 0
				? {name: passage, source: 'Harlowe State'}
				: undefined;
		} catch (error) {
			return undefined;
		}
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
		var adapter = selectedDebuggerAdapter || debuggerAdapter();
		var debuggerCurrentPassage =
			FIXED_READ_ADAPTER && adapter.captureHandler === 'sugarcube'
				? readExactSugarCubeDebuggerPassage()
				: FIXED_READ_ADAPTER && adapter.captureHandler === 'harlowe-state'
					? readExactHarloweDebuggerPassage()
				: currentPassage;

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
			adapter,
			debuggerCurrentPassage
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
		var restartHandler = ownDebuggerData(
			RESTART_ADAPTER_REGISTRATIONS,
			selectedDebuggerAdapter.id
		);
		if (
			typeof restartHandler === 'string' &&
			(restartHandler !== 'sugarcube' || ENABLE_SUGARCUBE_RESTART)
		) {
			post('debugger-command-hello', {
				adapterId: selectedDebuggerAdapter.id,
				commandCapabilities: ['restart'],
				protocolVersion: COMMAND_PROTOCOL_VERSION
			});
		}
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

function exactOccurrenceCount(source: string, fragment: string) {
	let count = 0;
	let offset = 0;

	while ((offset = source.indexOf(fragment, offset)) !== -1) {
		count += 1;
		offset += fragment.length;
	}

	return count;
}

function htmlTagEnd(html: string, start: number) {
	let quote = '';

	for (let index = start; index < html.length; index += 1) {
		const character = html[index];

		if (quote) {
			if (character === quote) {
				quote = '';
			}
		} else if (character === '"' || character === "'") {
			quote = character;
		} else if (character === '>') {
			return index;
		}
	}

	return -1;
}

function rawClosingTag(
	html: string,
	lowerHtml: string,
	tag: string,
	from: number
) {
	const needle = `</${tag}`;
	let start = lowerHtml.indexOf(needle, from);

	while (start !== -1) {
		const delimiter = lowerHtml[start + needle.length];

		if (delimiter === '>' || /\s/.test(delimiter ?? '')) {
			const end = htmlTagEnd(html, start + needle.length);

			return end === -1 ? undefined : {end, start};
		}
		start = lowerHtml.indexOf(needle, start + needle.length);
	}

	return undefined;
}

function rawStartTagAttribute(opening: string, wantedName: string) {
	const tag = /^<([a-z][a-z0-9:-]*)/i.exec(opening);

	if (!tag) {
		return undefined;
	}
	let cursor = tag[0].length;
	const values: Array<string | undefined> = [];

	while (cursor < opening.length) {
		while (/\s/.test(opening[cursor] ?? '')) {
			cursor += 1;
		}
		if (opening[cursor] === '>' || opening[cursor] === '/') {
			break;
		}
		const nameStart = cursor;

		while (cursor < opening.length && !/[\s"'<>/=]/.test(opening[cursor])) {
			cursor += 1;
		}
		if (cursor === nameStart) {
			return undefined;
		}
		const name = opening.slice(nameStart, cursor).toLowerCase();

		while (/\s/.test(opening[cursor] ?? '')) {
			cursor += 1;
		}
		let value: string | undefined;

		if (opening[cursor] === '=') {
			cursor += 1;
			while (/\s/.test(opening[cursor] ?? '')) {
				cursor += 1;
			}
			const quote = opening[cursor];

			if (quote === '"' || quote === "'") {
				const valueStart = ++cursor;

				while (cursor < opening.length && opening[cursor] !== quote) {
					cursor += 1;
				}
				if (opening[cursor] !== quote) {
					return undefined;
				}
				value = opening.slice(valueStart, cursor);
				cursor += 1;
			} else {
				const valueStart = cursor;

				while (cursor < opening.length && !/[\s"'`=<>]/.test(opening[cursor])) {
					cursor += 1;
				}
				if (cursor === valueStart) {
					return undefined;
				}
				value = opening.slice(valueStart, cursor);
			}
		}

		if (name === wantedName) {
			values.push(value);
		}
	}

	return values.length === 1 ? values[0] : undefined;
}

const HARLOWE_DEBUGGER_BOOTSTRAP_ID = 'twine-rs-harlowe-debugger-bootstrap';

interface PreviewHtmlScriptStructure {
	closeEnd: number;
	closeStart: number;
	id?: string;
	openEnd: number;
	parentStart?: number;
	role?: string;
	start: number;
	type?: string;
}

interface PreviewHtmlRoleElementStructure {
	start: number;
	tag: string;
}

interface HarlowePreviewHtmlStructure {
	authorScript: PreviewHtmlScriptStructure;
	bootstrapScript?: PreviewHtmlScriptStructure;
	storyDataStart: number;
}

function rawHarlowePreviewHtmlStructure(
	html: string,
	phase: 'post' | 'pre'
): HarlowePreviewHtmlStructure | undefined {
	const lowerHtml = html.toLowerCase();
	const rawTextTags = [
		'iframe',
		'noembed',
		'noframes',
		'noscript',
		'script',
		'style',
		'textarea',
		'title',
		'xmp'
	];
	const voidTags = [
		'area',
		'base',
		'br',
		'col',
		'embed',
		'hr',
		'img',
		'input',
		'link',
		'meta',
		'param',
		'source',
		'track',
		'wbr'
	];
	const suppressedStoryDataTags = [
		'math',
		'noscript',
		'select',
		'svg',
		'template'
	];
	const stack: Array<{start: number; tag: string}> = [];
	const roleElements: PreviewHtmlRoleElementStructure[] = [];
	const scripts: PreviewHtmlScriptStructure[] = [];
	let cursor = 0;
	let storyDataStart: number | undefined;

	while (cursor < html.length) {
		const start = html.indexOf('<', cursor);

		if (start === -1) break;
		if (lowerHtml.startsWith('<!--', start)) {
			const commentEnd = lowerHtml.indexOf('-->', start + 4);

			if (commentEnd === -1) return undefined;
			cursor = commentEnd + 3;
			continue;
		}
		if (lowerHtml.startsWith('<!doctype', start)) {
			const end = htmlTagEnd(html, start + 9);

			if (
				end === -1 ||
				!/^<!doctype\s+html\s*>$/i.test(html.slice(start, end + 1))
			) {
				return undefined;
			}
			cursor = end + 1;
			continue;
		}
		const match = /^<(\/)?([a-z][a-z0-9:-]*)(?=\s|\/?>)/i.exec(
			html.slice(start)
		);

		if (!match) return undefined;
		const closing = match[1] === '/';
		const tag = match[2].toLowerCase();
		const openEnd = htmlTagEnd(html, start + match[0].length);

		if (openEnd === -1) return undefined;
		if (closing) {
			if (stack.at(-1)?.tag !== tag) return undefined;
			stack.pop();
			cursor = openEnd + 1;
			continue;
		}
		if (tag === 'plaintext' || tag === 'frameset') return undefined;
		const opening = html.slice(start, openEnd + 1);
		const suppressedByTemplate = stack.some(item => item.tag === 'template');
		const suppressedStoryData = stack.some(item =>
			suppressedStoryDataTags.includes(item.tag)
		);
		const selfClosing = /\/\s*>$/.test(html.slice(start, openEnd + 1));

		if (
			!suppressedByTemplate &&
			rawStartTagAttribute(opening, 'role') === 'script'
		) {
			roleElements.push({start, tag});
		}

		if (rawTextTags.includes(tag)) {
			const close = rawClosingTag(html, lowerHtml, tag, openEnd + 1);

			if (!close) return undefined;
			if (tag === 'script' && !suppressedByTemplate) {
				scripts.push({
					closeEnd: close.end,
					closeStart: close.start,
					id: rawStartTagAttribute(opening, 'id'),
					openEnd,
					parentStart: stack.at(-1)?.start,
					role: rawStartTagAttribute(opening, 'role'),
					start,
					type: rawStartTagAttribute(opening, 'type')
				});
			}
			cursor = close.end + 1;
			continue;
		}
		if (tag === 'tw-storydata' && !suppressedStoryData) {
			if (storyDataStart !== undefined) return undefined;
			storyDataStart = start;
		}
		if (!selfClosing && !voidTags.includes(tag)) {
			stack.push({start, tag});
		}
		cursor = openEnd + 1;
	}

	if (stack.length > 0 || storyDataStart === undefined) return undefined;
	const authorScripts = scripts.filter(
		script =>
			script.id === 'twine-user-script' &&
			script.role === 'script' &&
			script.type === 'text/twine-javascript' &&
			script.parentStart === storyDataStart
	);
	const bootstrapScripts = scripts.filter(
		script => script.id === HARLOWE_DEBUGGER_BOOTSTRAP_ID
	);

	if (authorScripts.length !== 1) return undefined;
	const authorScript = authorScripts[0];
	if (phase === 'pre') {
		return roleElements.length === 1 &&
			roleElements[0].tag === 'script' &&
			roleElements[0].start === authorScript.start &&
			bootstrapScripts.length === 0
			? {authorScript, storyDataStart}
			: undefined;
	}

	if (bootstrapScripts.length !== 1 || roleElements.length !== 2) {
		return undefined;
	}
	const bootstrapScript = bootstrapScripts[0];

	return bootstrapScript.role === 'script' &&
		bootstrapScript.type === 'text/twine-javascript' &&
		bootstrapScript.parentStart === storyDataStart &&
		roleElements[0].tag === 'script' &&
		roleElements[0].start === bootstrapScript.start &&
		roleElements[1].tag === 'script' &&
		roleElements[1].start === authorScript.start &&
		bootstrapScript.closeEnd + 1 === authorScript.start
		? {authorScript, bootstrapScript, storyDataStart}
		: undefined;
}

function harlowePreviewHtmlStructure(html: string, phase: 'post' | 'pre') {
	const raw = rawHarlowePreviewHtmlStructure(html, phase);

	if (!raw) return undefined;
	try {
		const Parser = globalThis.DOMParser;

		if (typeof Parser !== 'function') return raw;
		const document = new Parser().parseFromString(html, 'text/html');
		const storyData = Array.from(
			document.querySelectorAll('tw-storydata')
		).filter(
			element =>
				element.namespaceURI === 'http://www.w3.org/1999/xhtml' &&
				!element.closest('math, noscript, select, svg, template')
		);

		if (storyData.length !== 1) return undefined;
		const authorScripts = Array.from(
			document.querySelectorAll(
				'script#twine-user-script[role="script"][type="text/twine-javascript"]'
			)
		).filter(element => element.parentElement === storyData[0]);
		const roleElements = Array.from(
			document.querySelectorAll('[role="script"]')
		).filter(element => !element.parentElement?.closest('noscript, template'));
		const bootstrapScripts = Array.from(
			document.querySelectorAll(`script#${HARLOWE_DEBUGGER_BOOTSTRAP_ID}`)
		).filter(element => !element.parentElement?.closest('noscript, template'));

		if (authorScripts.length !== 1) return undefined;
		if (phase === 'pre') {
			return roleElements.length === 1 &&
				roleElements[0] === authorScripts[0] &&
				bootstrapScripts.length === 0
				? raw
				: undefined;
		}

		return bootstrapScripts.length === 1 &&
			roleElements.length === 2 &&
			roleElements[0] === bootstrapScripts[0] &&
			roleElements[1] === authorScripts[0] &&
			bootstrapScripts[0].parentElement === storyData[0] &&
			authorScripts[0].previousElementSibling === bootstrapScripts[0]
			? raw
			: undefined;
	} catch {
		return undefined;
	}
}

function harloweBootstrapScript(moduleName: string) {
	return `<script id="${HARLOWE_DEBUGGER_BOOTSTRAP_ID}" type="text/twine-javascript" role="script">(function(){var state;try{state=require(${JSON.stringify(
		moduleName
	)});}catch(error){}try{window.__twineRsPreviewHarloweBootstrap(state);}catch(error){}}());</script>`;
}

function instrumentHarloweBootstrap(
	html: string,
	admission: PreviewFormatAdmission
) {
	if (admission.kind !== 'builtin-sha256' || admission.format !== 'Harlowe') {
		return {enabled: false, html};
	}
	const profile = harloweStateProfileForAdapter(admission.adapterId);

	if (!profile) return {enabled: false, html};
	const structure = harlowePreviewHtmlStructure(html, 'pre');

	if (!structure) return {enabled: false, html};
	const staged =
		html.slice(0, structure.authorScript.start) +
		harloweBootstrapScript(profile.moduleName) +
		html.slice(structure.authorScript.start);

	return harlowePreviewHtmlStructure(staged, 'post')
		? {enabled: true, html: staged}
		: {enabled: false, html};
}

function rawSugarCubeEngineRegion(html: string) {
	const lowerHtml = html.toLowerCase();
	const regions: Array<{contentEnd: number; contentStart: number}> = [];
	let cursor = 0;

	while (cursor < html.length) {
		const start = html.indexOf('<', cursor);

		if (start === -1) {
			break;
		}
		if (lowerHtml.startsWith('<!--', start)) {
			const commentEnd = lowerHtml.indexOf('-->', start + 4);

			cursor = commentEnd === -1 ? html.length : commentEnd + 3;
			continue;
		}

		const tagMatch = /^<([a-z][a-z0-9:-]*)(?=\s|\/?>)/i.exec(html.slice(start));

		if (!tagMatch) {
			cursor = start + 1;
			continue;
		}
		const tag = tagMatch[1].toLowerCase();
		const openEnd = htmlTagEnd(html, start + tagMatch[0].length);

		if (openEnd === -1) {
			return undefined;
		}
		if (tag === 'script') {
			const closing = rawClosingTag(html, lowerHtml, tag, openEnd + 1);

			if (!closing) {
				return undefined;
			}
			const opening = html.slice(start, openEnd + 1);

			if (rawStartTagAttribute(opening, 'id') === 'script-sugarcube') {
				regions.push({contentEnd: closing.start, contentStart: openEnd + 1});
			}
			cursor = closing.end + 1;
			continue;
		}
		if (['style', 'textarea', 'title', 'xmp'].includes(tag)) {
			const closing = rawClosingTag(html, lowerHtml, tag, openEnd + 1);

			cursor = closing ? closing.end + 1 : html.length;
			continue;
		}
		cursor = openEnd + 1;
	}

	return regions.length === 1 ? regions[0] : undefined;
}

function instrumentSugarCubeRestart(
	html: string,
	admission: PreviewFormatAdmission
) {
	if (admission.kind !== 'builtin-sha256') {
		return {enabled: false, html};
	}
	const profile = sugarCubeRestartProfileForAdapter(admission.adapterId);

	if (!profile) {
		return {enabled: false, html};
	}

	try {
		const region = rawSugarCubeEngineRegion(html);
		const engineSource = region
			? html.slice(region.contentStart, region.contentEnd)
			: '';

		if (
			!engineSource ||
			!region ||
			exactOccurrenceCount(engineSource, profile.startupFragment) !== 1 ||
			exactOccurrenceCount(engineSource, profile.engineRestartSource) !== 1
		) {
			return {enabled: false, html};
		}
		const instrumentedEngineSource = engineSource.replace(
			profile.startupFragment,
			profile.startupReplacement
		);

		return {
			enabled: true,
			html:
				html.slice(0, region.contentStart) +
				instrumentedEngineSource +
				html.slice(region.contentEnd)
		};
	} catch {
		return {enabled: false, html};
	}
}

function insertPreviewBridge(source: string, script: string) {
	if (/<head(\s[^>]*)?>/i.test(source)) {
		return source.replace(/<head(\s[^>]*)?>/i, match => `${match}${script}`);
	}
	if (/<html(\s[^>]*)?>/i.test(source)) {
		return source.replace(/<html(\s[^>]*)?>/i, match => `${match}${script}`);
	}

	return `${script}${source}`;
}

export interface InstrumentedPreviewHtml {
	admission: PreviewFormatAdmission;
	html: string;
	sugarCubeRestartEligible: boolean;
}

export function instrumentPreviewHtml(
	html: string,
	sessionId: string,
	options: {
		admission?: PreviewFormatAdmission;
		enableHarloweSessionStorageFallback?: boolean;
	} = {}
): InstrumentedPreviewHtml {
	const canonicalAdmission =
		canonicalPreviewFormatAdmission(options.admission) ??
		NO_PREVIEW_FORMAT_ADMISSION;
	const admitted = previewFormatAdmissionForHtml(canonicalAdmission, html);
	const harlowe = instrumentHarloweBootstrap(html, admitted);
	const admission =
		admitted.kind === 'builtin-sha256' && admitted.format === 'Harlowe'
			? harlowe.enabled
				? admitted
				: NO_PREVIEW_FORMAT_ADMISSION
			: admitted;
	const exactSource = harlowe.enabled ? harlowe.html : html;
	const sugarCube = instrumentSugarCubeRestart(exactSource, admission);
	const source = sugarCube.html;
	const script = bridgeScript(
		sessionId,
		options.enableHarloweSessionStorageFallback === true &&
			isHarlowePreviewHtml(source),
		admission,
		sugarCube.enabled
	);
	const instrumentedHtml = insertPreviewBridge(source, script);

	if (
		admission.kind === 'builtin-sha256' &&
		admission.format === 'Harlowe' &&
		!harlowePreviewHtmlStructure(instrumentedHtml, 'post')
	) {
		const fallbackScript = bridgeScript(
			sessionId,
			options.enableHarloweSessionStorageFallback === true &&
				isHarlowePreviewHtml(html),
			NO_PREVIEW_FORMAT_ADMISSION,
			false
		);

		return {
			admission: NO_PREVIEW_FORMAT_ADMISSION,
			html: insertPreviewBridge(html, fallbackScript),
			sugarCubeRestartEligible: false
		};
	}

	return {
		admission,
		html: instrumentedHtml,
		sugarCubeRestartEligible: sugarCube.enabled
	};
}

export function resolveRuntimePassage(
	raw: StoryPreviewRuntimePassage | undefined,
	passages: StoryPreviewPassageRef[] | StoryPreviewPassageLookup
): StoryPreviewRuntimePassage | undefined {
	if (!raw) {
		return undefined;
	}

	const rawName = raw.rawName ?? raw.name;
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
		rawId: id,
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
		if (model.debugger.hello) {
			return model;
		}
		const hello: StoryPreviewDebuggerHello = {
			capabilities: message.capabilities,
			format: message.format,
			formatVersion: message.formatVersion,
			id: message.adapterId,
			protocolVersion: message.protocolVersion,
			reliability: message.reliability
		};
		return {
			...model,
			debugger: {
				hello
			}
		};
	}

	if (message.type === 'debugger-command-hello') {
		const hello = model.debugger.hello;

		if (
			model.debugger.commands ||
			!hello ||
			hello.id !== message.adapterId ||
			message.protocolVersion !== STORY_PREVIEW_COMMAND_PROTOCOL_VERSION ||
			message.commandCapabilities.length !== 1 ||
			message.commandCapabilities[0] !== 'restart'
		) {
			return model;
		}

		return {
			...model,
			debugger: {
				...model.debugger,
				commands: {
					adapterId: message.adapterId,
					capabilities: ['restart'],
					protocolVersion: STORY_PREVIEW_COMMAND_PROTOCOL_VERSION
				}
			}
		};
	}

	if (message.type === 'debugger-command-result') {
		return model;
	}
	if (
		message.type === 'debugger-bootstrap-arm' ||
		message.type === 'debugger-bootstrap-ready'
	) {
		return model;
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
		const sections = message.sections;
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
					adapterId: message.adapterId,
					currentPassage: resolveRuntimePassage(
						message.currentPassage,
						passages
					),
					protocolVersion: message.protocolVersion,
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
