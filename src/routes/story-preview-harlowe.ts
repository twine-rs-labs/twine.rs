export const HARLOWE_3_3_9_COMPATIBILITY = {
	adapterId: 'harlowe-3.3.9',
	readProfileId: 'harlowe-read-state-3.3.9',
	sourceSha256:
		'6c1d225bd64d6da6f279aeb29dfc1a8bfd5590f780fec9ec9f7b7825e09c319c',
	url: 'story-formats/harlowe-3.3.9/format.js',
	version: '3.3.9'
} as const;

export type ExactHarloweAdapterId =
	typeof HARLOWE_3_3_9_COMPATIBILITY.adapterId;

/**
 * Executable read profile observed from the canonical bundled Harlowe 3.3.9
 * artifact. Adding or changing a profile requires a new source digest and a
 * real-runtime descriptor probe.
 */
export const HARLOWE_3_3_9_STATE_PROFILE = {
	capabilityDependencies: {
		currentPassage: ['state.passage', 'state.on']
	},
	events: {
		capture: ['forward', 'back', 'load']
	},
	moduleName: 'state',
	on: {
		configurable: false,
		enumerable: true,
		source:
			'function(e,t){if(e in l)return"function"!=typeof t||l[e].includes(t)||l[e].push(t),a;y.impossible("State.on","invalid event name")}',
		writable: false
	},
	passage: {
		configurable: false,
		enumerable: true,
		getterSource: 'get passage(){return d.passage}',
		setter: false
	},
	stateFrozen: true
} as const;

export type HarloweReadProfileId =
	typeof HARLOWE_3_3_9_COMPATIBILITY.readProfileId;

export function harloweStateProfileForAdapter(adapterId: unknown) {
	return adapterId === HARLOWE_3_3_9_COMPATIBILITY.adapterId
		? HARLOWE_3_3_9_STATE_PROFILE
		: undefined;
}
