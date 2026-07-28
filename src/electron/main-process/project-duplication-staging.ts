export const duplicateStagingMarkerFilename =
	'.twine-rs-project-duplicate-stage.json';
export const duplicateStagingPrefix = '.twine-rs-duplicate-';

const duplicateStagingKind = 'twine-rs-project-duplicate-staging';
const duplicateStagingNamePattern =
	/^(\.)?\.twine-rs-duplicate-([A-Za-z0-9]{6})(?:\.(save|retired)-\d+)?$/;
const duplicateStagingVersion = 1;

export interface DuplicateStagingLease {
	createdAt: number;
	pid: number;
}

export function duplicateStagingMarker(
	createdAt = Date.now(),
	pid = process.pid
) {
	return `${JSON.stringify({
		createdAt,
		kind: duplicateStagingKind,
		pid,
		version: duplicateStagingVersion
	})}\n`;
}

export function duplicateStagingIdentity(directoryName: string) {
	const match = duplicateStagingNamePattern.exec(directoryName);

	if (
		!match?.[2] ||
		(match[1] === '.' && match[3] !== 'save') ||
		(match[1] !== '.' && match[3] === 'save')
	) {
		return undefined;
	}
	return match[2];
}

export function duplicateStagingLease(marker: string) {
	try {
		const parsed = JSON.parse(marker) as Record<string, unknown>;
		const keys = Object.keys(parsed).sort();

		if (
			keys.join(',') !== 'createdAt,kind,pid,version' ||
			parsed.kind !== duplicateStagingKind ||
			parsed.version !== duplicateStagingVersion ||
			typeof parsed.createdAt !== 'number' ||
			!Number.isFinite(parsed.createdAt) ||
			parsed.createdAt < 0 ||
			typeof parsed.pid !== 'number' ||
			!Number.isSafeInteger(parsed.pid) ||
			parsed.pid <= 0
		) {
			return undefined;
		}
		return {
			createdAt: parsed.createdAt,
			pid: parsed.pid
		} satisfies DuplicateStagingLease;
	} catch {
		return undefined;
	}
}
