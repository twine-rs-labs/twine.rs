import {
	SUGARCUBE_COMPATIBILITY,
	type ExactSugarCubeAdapterId
} from './story-preview-sugarcube';
import type {PreviewFormatAdmission} from './story-preview-format';

export const STORY_PREVIEW_DEBUGGER_PROTOCOL_VERSION = 1;
export const STORY_PREVIEW_COMMAND_PROTOCOL_VERSION = 1;

export const STORY_PREVIEW_COMMAND_CAPABILITIES = ['restart'] as const;

export type StoryPreviewCommandCapability =
	(typeof STORY_PREVIEW_COMMAND_CAPABILITIES)[number];

export const STORY_PREVIEW_RESTART_RESULT_STATUSES = [
	'applied',
	'unavailable',
	'failed',
	'indeterminate'
] as const;

export type StoryPreviewRestartResultStatus =
	(typeof STORY_PREVIEW_RESTART_RESULT_STATUSES)[number];

export const STORY_PREVIEW_DEBUGGER_CAPABILITIES = [
	'currentPassage',
	'storyVariables',
	'temporaryVariables',
	'visitedPassages'
] as const;

export type StoryPreviewDebuggerCapability =
	(typeof STORY_PREVIEW_DEBUGGER_CAPABILITIES)[number];

export const STORY_PREVIEW_DEBUGGER_TRUNCATION_REASONS = [
	'field-limit',
	'item-limit',
	'text-budget',
	'uninspectable'
] as const;

export type StoryPreviewDebuggerTruncationReason =
	(typeof STORY_PREVIEW_DEBUGGER_TRUNCATION_REASONS)[number];

export type StoryPreviewDebuggerAdapterId =
	| ExactSugarCubeAdapterId
	| 'snowman-1.5.0'
	| 'snowman-2.1.1'
	| 'chapbook-2.3.1'
	| 'harlowe-3.3.9'
	| 'generic';

export type StoryPreviewDebuggerCaptureHandler =
	'current-only' | 'harlowe-state' | 'snowman' | 'sugarcube';

export type StoryPreviewRestartHandler =
	'chapbook' | 'harlowe' | 'snowman' | 'sugarcube';

export interface StoryPreviewDebuggerAdapterDescriptor {
	capabilities: readonly StoryPreviewDebuggerCapability[];
	format: string;
	formatVersion: string;
	id: StoryPreviewDebuggerAdapterId;
	reliability: 'best-effort' | 'exact-version';
}

export interface StoryPreviewDebuggerAdapterRegistration extends StoryPreviewDebuggerAdapterDescriptor {
	captureHandler: StoryPreviewDebuggerCaptureHandler;
}

export const STORY_PREVIEW_DEBUGGER_CAPTURE_COLLECTIONS = {
	'current-only': [],
	'harlowe-state': [],
	snowman: ['storyVariables', 'visitedPassages'],
	sugarcube: ['storyVariables', 'temporaryVariables', 'visitedPassages']
} as const satisfies Record<
	StoryPreviewDebuggerCaptureHandler,
	readonly Exclude<StoryPreviewDebuggerCapability, 'currentPassage'>[]
>;

function registration(
	captureHandler: StoryPreviewDebuggerCaptureHandler,
	format: string,
	formatVersion: string,
	id: Exclude<StoryPreviewDebuggerAdapterId, 'generic'>,
	reliability: StoryPreviewDebuggerAdapterDescriptor['reliability']
): StoryPreviewDebuggerAdapterRegistration {
	return {
		capabilities: [
			'currentPassage',
			...STORY_PREVIEW_DEBUGGER_CAPTURE_COLLECTIONS[captureHandler]
		],
		captureHandler,
		format,
		formatVersion,
		id,
		reliability
	};
}

export const STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS = {
	...(Object.fromEntries(
		SUGARCUBE_COMPATIBILITY.map(entry => [
			entry.adapterId,
			registration(
				'sugarcube',
				'SugarCube',
				entry.version,
				entry.adapterId,
				'exact-version'
			)
		])
	) as Record<
		ExactSugarCubeAdapterId,
		StoryPreviewDebuggerAdapterRegistration
	>),
	'snowman-1.5.0': registration(
		'snowman',
		'Snowman',
		'1.5.0',
		'snowman-1.5.0',
		'exact-version'
	),
	'snowman-2.1.1': registration(
		'snowman',
		'Snowman',
		'2.1.1',
		'snowman-2.1.1',
		'exact-version'
	),
	'chapbook-2.3.1': registration(
		'current-only',
		'Chapbook',
		'2.3.1',
		'chapbook-2.3.1',
		'best-effort'
	),
	'harlowe-3.3.9': registration(
		'current-only',
		'Harlowe',
		'3.3.9',
		'harlowe-3.3.9',
		'best-effort'
	)
} satisfies Record<
	Exclude<StoryPreviewDebuggerAdapterId, 'generic'>,
	StoryPreviewDebuggerAdapterRegistration
>;

export const HARLOWE_EXACT_DEBUGGER_ADAPTER = registration(
	'harlowe-state',
	'Harlowe',
	'3.3.9',
	'harlowe-3.3.9',
	'exact-version'
);

/**
 * Runtime mutation support is deliberately independent of read reliability.
 * Only these exact bundled tuples may advertise Restart.
 */
export const STORY_PREVIEW_RESTART_ADAPTER_REGISTRATIONS = {
	...(Object.fromEntries(
		SUGARCUBE_COMPATIBILITY.filter(
			entry => entry.restartProfileId !== undefined
		).map(entry => [entry.adapterId, 'sugarcube' as const])
	) as Record<ExactSugarCubeAdapterId, 'sugarcube'>),
	'snowman-1.5.0': 'snowman',
	'snowman-2.1.1': 'snowman',
	'chapbook-2.3.1': 'chapbook',
	'harlowe-3.3.9': 'harlowe'
} as const satisfies Record<
	Exclude<StoryPreviewDebuggerAdapterId, 'generic'>,
	StoryPreviewRestartHandler
>;

export function storyPreviewRestartHandler(
	id: unknown
): StoryPreviewRestartHandler | undefined {
	if (
		typeof id !== 'string' ||
		!Object.prototype.hasOwnProperty.call(
			STORY_PREVIEW_RESTART_ADAPTER_REGISTRATIONS,
			id
		)
	) {
		return undefined;
	}

	return STORY_PREVIEW_RESTART_ADAPTER_REGISTRATIONS[
		id as keyof typeof STORY_PREVIEW_RESTART_ADAPTER_REGISTRATIONS
	];
}

function descriptorFromRegistration(
	registration: StoryPreviewDebuggerAdapterRegistration
): StoryPreviewDebuggerAdapterDescriptor {
	return {
		capabilities: registration.capabilities,
		format: registration.format,
		formatVersion: registration.formatVersion,
		id: registration.id,
		reliability: registration.reliability
	};
}

export function selectStoryPreviewDebuggerAdapter(
	format: string | undefined,
	formatVersion: string | undefined
): StoryPreviewDebuggerAdapterDescriptor {
	for (const adapter of Object.values(
		STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS
	)) {
		if (adapter.format === format && adapter.formatVersion === formatVersion) {
			return descriptorFromRegistration(adapter);
		}
	}

	return {
		capabilities: ['currentPassage'],
		format: format ?? '',
		formatVersion: formatVersion ?? '',
		id: 'generic',
		reliability: 'best-effort'
	};
}

/** Resolves an exact read registration solely from host-owned admission. */
export function readAdapterForAdmission(
	admission: PreviewFormatAdmission
): StoryPreviewDebuggerAdapterRegistration | undefined {
	if (admission.kind !== 'builtin-sha256') {
		return undefined;
	}
	if (admission.format === 'Harlowe') {
		return admission.adapterId === HARLOWE_EXACT_DEBUGGER_ADAPTER.id
			? HARLOWE_EXACT_DEBUGGER_ADAPTER
			: undefined;
	}

	return STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS[admission.adapterId];
}

/**
 * Resolves the non-authoritative fallback profile observed from story markup.
 * SugarCube exact registrations are never reachable through this path.
 */
export function readAdapterForObservedFormat(
	format: string | undefined,
	formatVersion: string | undefined
): StoryPreviewDebuggerAdapterRegistration {
	const selected = selectStoryPreviewDebuggerAdapter(format, formatVersion);

	if (selected.format === 'SugarCube') {
		return {
			capabilities: ['currentPassage'],
			captureHandler: 'current-only',
			format: format ?? '',
			formatVersion: formatVersion ?? '',
			id: 'generic',
			reliability: 'best-effort'
		};
	}

	if (selected.id === 'generic') {
		return {...selected, captureHandler: 'current-only'};
	}

	return STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS[selected.id];
}

export function admissionAllowsReadAdapter(
	admission: PreviewFormatAdmission,
	adapterId: unknown
) {
	const exact = readAdapterForAdmission(admission);

	if (exact) {
		return adapterId === exact.id;
	}
	if (admission.kind !== 'none') {
		return false;
	}

	return (
		adapterId === 'generic' ||
		(typeof adapterId === 'string' &&
			!adapterId.startsWith('sugarcube-') &&
			storyPreviewDebuggerAdapter(adapterId) !== undefined)
	);
}

export function storyPreviewDebuggerAdapter(
	id: unknown
): StoryPreviewDebuggerAdapterDescriptor | undefined {
	if (
		typeof id !== 'string' ||
		id === 'generic' ||
		!Object.prototype.hasOwnProperty.call(
			STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS,
			id
		)
	) {
		return undefined;
	}

	return descriptorFromRegistration(
		STORY_PREVIEW_DEBUGGER_ADAPTER_REGISTRATIONS[
			id as Exclude<StoryPreviewDebuggerAdapterId, 'generic'>
		]
	);
}

export function isStoryPreviewDebuggerAdapterId(
	value: unknown
): value is StoryPreviewDebuggerAdapterId {
	return (
		value === 'generic' || storyPreviewDebuggerAdapter(value) !== undefined
	);
}
