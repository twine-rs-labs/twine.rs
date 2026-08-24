import {
	SUGARCUBE_COMPATIBILITY,
	type ExactSugarCubeAdapterId
} from './story-preview-sugarcube';

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
	'current-only' | 'snowman' | 'sugarcube';

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
