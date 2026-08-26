const MAX_ENTRIES = 32;

/** The popup's owner-acceptance interval; owner input is capped to this value. */
export const browserPreviewOwnerAcceptanceTimeoutMs = 1_500;

export const browserPreviewOwnerProtocol = Object.freeze({
	source: 'twine.rs.browser-preview-owner',
	version: 1
});

export interface BrowserPreviewRevealRequest {
	acceptanceDeadline: number;
	mode: 'graph' | 'text';
	passageId: string;
	requestId: string;
	source: typeof browserPreviewOwnerProtocol.source;
	storyId: string;
	token: string;
	type: 'reveal';
	version: typeof browserPreviewOwnerProtocol.version;
}

export interface BrowserPreviewRevealControl {
	requestId: string;
	source: typeof browserPreviewOwnerProtocol.source;
	type: 'cancel' | 'commit';
	version: typeof browserPreviewOwnerProtocol.version;
}

export interface BrowserPreviewRevealResult {
	message?: string;
	source: typeof browserPreviewOwnerProtocol.source;
	status: 'accepted' | 'rejected' | 'success';
	requestId: string;
	type: 'reveal-result';
	version: typeof browserPreviewOwnerProtocol.version;
}

function boundedString(value: unknown, maxLength: number): value is string {
	return (
		typeof value === 'string' && value.length > 0 && value.length <= maxLength
	);
}

export function isBrowserPreviewRevealRequest(
	value: unknown
): value is BrowserPreviewRevealRequest {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const request = value as Partial<BrowserPreviewRevealRequest>;

	return (
		Object.keys(value as object)
			.sort()
			.join(',') ===
			'acceptanceDeadline,mode,passageId,requestId,source,storyId,token,type,version' &&
		request.source === browserPreviewOwnerProtocol.source &&
		request.version === browserPreviewOwnerProtocol.version &&
		request.type === 'reveal' &&
		(request.mode === 'graph' || request.mode === 'text') &&
		boundedString(request.token, 128) &&
		boundedString(request.storyId, 1024) &&
		boundedString(request.passageId, 1024) &&
		boundedString(request.requestId, 128) &&
		Number.isSafeInteger(request.acceptanceDeadline)
	);
}

export function isBrowserPreviewRevealControl(
	value: unknown
): value is BrowserPreviewRevealControl {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const control = value as Partial<BrowserPreviewRevealControl>;
	return (
		Object.keys(value as object)
			.sort()
			.join(',') === 'requestId,source,type,version' &&
		control.source === browserPreviewOwnerProtocol.source &&
		control.version === browserPreviewOwnerProtocol.version &&
		(control.type === 'cancel' || control.type === 'commit') &&
		boundedString(control.requestId, 128)
	);
}

export function isBrowserPreviewRevealResult(
	value: unknown
): value is BrowserPreviewRevealResult {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return false;
	}
	const result = value as Partial<BrowserPreviewRevealResult>;

	return (
		result.source === browserPreviewOwnerProtocol.source &&
		result.version === browserPreviewOwnerProtocol.version &&
		result.type === 'reveal-result' &&
		(result.status === 'accepted' ||
			result.status === 'rejected' ||
			result.status === 'success') &&
		boundedString(result.requestId, 128) &&
		(result.message === undefined || typeof result.message === 'string')
	);
}

export type BrowserPreviewOwnerEntry = {
	preview: WindowProxy;
	storyId: string;
	token: string;
};
const entries = new Map<string, BrowserPreviewOwnerEntry>();

export function registerBrowserPreviewOwner(entry: BrowserPreviewOwnerEntry) {
	for (const [token, current] of entries) {
		if ((current.preview as Window | null)?.closed) entries.delete(token);
	}
	if (entries.size >= MAX_ENTRIES) {
		const first = entries.keys().next().value as string | undefined;
		if (first) entries.delete(first);
	}
	entries.set(entry.token, entry);
}

export function browserPreviewOwner(token: string) {
	const entry = entries.get(token);
	if (entry && (entry.preview as Window | null)?.closed) {
		entries.delete(token);
		return undefined;
	}
	return entry;
}

export function unregisterBrowserPreviewOwner(token: string) {
	entries.delete(token);
}
