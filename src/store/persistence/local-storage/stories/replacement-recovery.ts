import type {StoryWithDocuments} from '../../../stories';
import {
	deletePassageById,
	doUpdateTransaction,
	savePassage,
	saveStory
} from './save';
import {readStorageManifest} from './storage';

const localReplacementRecoveryKey =
	'twine-rs-local-project-replacement-recovery';

interface LocalReplacementRecoveryEntry {
	original: StoryWithDocuments;
	provisionalFingerprint?: string;
	storyId: string;
}

interface LocalReplacementRecoveryJournal {
	entries: LocalReplacementRecoveryEntry[];
	operationId: string;
	phase: 'prepared' | 'sealed';
	version: 3;
}

interface RevisionLocalReplacementRecoveryJournal {
	preparedManifestRevision: string;
	sealedManifestRevision?: string;
	stories: StoryWithDocuments[];
	version: 2;
}

interface LegacyLocalReplacementRecoveryJournal {
	stories: StoryWithDocuments[];
	version: 1;
}

type StoredLocalReplacementRecoveryJournal =
	| LegacyLocalReplacementRecoveryJournal
	| RevisionLocalReplacementRecoveryJournal
	| LocalReplacementRecoveryJournal;

interface LoadedRecoveryJournal {
	journal: LocalReplacementRecoveryJournal;
	legacy: boolean;
}

type RecoveryJournalRead =
	| {kind: 'invalid'; message: string}
	| {kind: 'none'}
	| {kind: 'unavailable'; message: string}
	| {kind: 'valid'; value: StoredLocalReplacementRecoveryJournal};

export type LocalReplacementRecoveryIssueState =
	| 'cleanup'
	| 'conflict'
	| 'invalid'
	| 'legacy'
	| 'prepared'
	| 'retry'
	| 'unavailable';

export interface LocalReplacementRecoveryIssue {
	canKeepCurrent: boolean;
	canRestoreOriginal: boolean;
	message: string;
	state: LocalReplacementRecoveryIssueState;
	storyId?: string;
	storyName: string;
}

export interface LocalReplacementRecoveryReport {
	error?: string;
	issues: LocalReplacementRecoveryIssue[];
}

export type LocalReplacementRecoveryDecision =
	'keep-current' | 'restore-original';

function isStorySnapshot(value: unknown): value is StoryWithDocuments {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const story = value as Partial<StoryWithDocuments>;

	if (typeof story.id !== 'string' || !Array.isArray(story.passages)) {
		return false;
	}
	const passageIds = new Set<string>();

	for (const passage of story.passages) {
		if (
			typeof passage?.id !== 'string' ||
			typeof passage.story !== 'string' ||
			passage.story !== story.id ||
			typeof passage.text !== 'string' ||
			passageIds.has(passage.id)
		) {
			return false;
		}
		passageIds.add(passage.id);
	}
	return true;
}

function isLegacyJournal(
	value: Partial<StoredLocalReplacementRecoveryJournal>
): value is
	| LegacyLocalReplacementRecoveryJournal
	| RevisionLocalReplacementRecoveryJournal {
	return (
		(value.version === 1 ||
			(value.version === 2 &&
				typeof value.preparedManifestRevision === 'string' &&
				(value.sealedManifestRevision === undefined ||
					typeof value.sealedManifestRevision === 'string'))) &&
		Array.isArray(value.stories) &&
		value.stories.length > 0 &&
		value.stories.every(isStorySnapshot)
	);
}

function isRecoveryJournal(
	value: unknown
): value is StoredLocalReplacementRecoveryJournal {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<StoredLocalReplacementRecoveryJournal>;

	if (isLegacyJournal(candidate)) {
		return true;
	}
	if (
		candidate.version !== 3 ||
		typeof candidate.operationId !== 'string' ||
		(candidate.phase !== 'prepared' && candidate.phase !== 'sealed') ||
		!Array.isArray(candidate.entries) ||
		candidate.entries.length === 0
	) {
		return false;
	}
	const storyIds = new Set<string>();

	return candidate.entries.every(entry => {
		if (
			!entry ||
			typeof entry !== 'object' ||
			typeof entry.storyId !== 'string' ||
			storyIds.has(entry.storyId) ||
			!isStorySnapshot(entry.original) ||
			entry.original.id !== entry.storyId ||
			(entry.provisionalFingerprint !== undefined &&
				typeof entry.provisionalFingerprint !== 'string') ||
			(candidate.phase === 'sealed' &&
				typeof entry.provisionalFingerprint !== 'string')
		) {
			return false;
		}
		storyIds.add(entry.storyId);
		return true;
	});
}

function readRecoveryJournal(): RecoveryJournalRead {
	let serialized: string | null;

	try {
		serialized = window.localStorage.getItem(localReplacementRecoveryKey);
	} catch (error) {
		return {
			kind: 'unavailable',
			message: `Browser storage is unavailable: ${(error as Error).message}`
		};
	}

	if (!serialized) {
		return {kind: 'none'};
	}
	let value: unknown;

	try {
		value = JSON.parse(serialized);
	} catch {
		return {
			kind: 'invalid',
			message: 'The pending local project recovery record is not valid JSON.'
		};
	}
	if (!isRecoveryJournal(value)) {
		return {
			kind: 'invalid',
			message: 'The pending local project recovery record has an invalid shape.'
		};
	}
	return {kind: 'valid', value};
}

function normalizeJournal(
	journal: StoredLocalReplacementRecoveryJournal
): LoadedRecoveryJournal {
	if (journal.version === 3) {
		return {journal, legacy: false};
	}
	return {
		journal: {
			entries: journal.stories.map(original => ({
				original,
				storyId: original.id
			})),
			operationId: `legacy-v${journal.version}`,
			phase: 'prepared',
			version: 3
		},
		legacy: true
	};
}

function canonicalValue(value: unknown): unknown {
	if (value instanceof Date) {
		return value.toISOString();
	}
	if (Array.isArray(value)) {
		return value.map(canonicalValue);
	}
	if (value && typeof value === 'object') {
		const result: Record<string, unknown> = {};

		for (const key of Object.keys(value).sort()) {
			const child = (value as Record<string, unknown>)[key];

			if (child !== undefined) {
				result[key] = canonicalValue(child);
			}
		}
		return result;
	}
	return value;
}

function storyFingerprint(story: StoryWithDocuments | undefined) {
	if (!story) {
		return JSON.stringify({missing: true});
	}
	return JSON.stringify(
		canonicalValue({
			...story,
			passages: [...story.passages].sort((left, right) =>
				left.id.localeCompare(right.id)
			)
		})
	);
}

function readCurrentStory(storyId: string) {
	const manifest = readStorageManifest();
	const storyReference = manifest.stories.find(
		reference => reference.id === storyId
	);

	if (!storyReference) {
		return {atomic: manifest.revision !== 'legacy', story: undefined};
	}
	const serializedStory = window.localStorage.getItem(storyReference.key);

	if (!serializedStory) {
		throw new Error(`Stored project ${storyId} is missing its story record.`);
	}
	let story: unknown;

	try {
		story = JSON.parse(serializedStory);
	} catch {
		throw new Error(`Stored project ${storyId} has invalid story metadata.`);
	}
	const passages: unknown[] = [];

	for (const reference of manifest.passages.filter(
		reference => reference.storyId === storyId
	)) {
		const serializedPassage = window.localStorage.getItem(reference.key);

		if (!serializedPassage) {
			throw new Error(
				`Stored project ${storyId} is missing passage ${reference.id}.`
			);
		}
		try {
			passages.push(JSON.parse(serializedPassage));
		} catch {
			throw new Error(
				`Stored project ${storyId} has invalid passage ${reference.id}.`
			);
		}
	}
	const snapshot = {...(story as object), passages};

	if (!isStorySnapshot(snapshot) || snapshot.id !== storyId) {
		throw new Error(
			`Stored project ${storyId} has an invalid logical snapshot.`
		);
	}
	return {atomic: manifest.revision !== 'legacy', story: snapshot};
}

function restoreOriginalStory(original: StoryWithDocuments) {
	const previousManifest = readStorageManifest();
	const passageIds = new Set(original.passages.map(passage => passage.id));

	doUpdateTransaction(transaction => {
		saveStory(transaction, original);
		for (const reference of previousManifest.passages) {
			if (reference.storyId === original.id && !passageIds.has(reference.id)) {
				deletePassageById(transaction, original.id, reference.id);
			}
		}
		for (const passage of original.passages) {
			savePassage(transaction, passage);
		}
	});
}

function persistJournal(
	journal: LocalReplacementRecoveryJournal,
	entries: LocalReplacementRecoveryEntry[]
) {
	if (entries.length === 0) {
		window.localStorage.removeItem(localReplacementRecoveryKey);
		return;
	}
	window.localStorage.setItem(
		localReplacementRecoveryKey,
		JSON.stringify({...journal, entries})
	);
}

function issueForEntry(
	entry: LocalReplacementRecoveryEntry,
	journal: LocalReplacementRecoveryJournal,
	legacy: boolean
): LocalReplacementRecoveryIssue {
	try {
		const current = readCurrentStory(entry.storyId);
		const currentFingerprint = storyFingerprint(current.story);
		const originalFingerprint = storyFingerprint(entry.original);

		if (currentFingerprint === originalFingerprint) {
			return {
				canKeepCurrent: false,
				canRestoreOriginal: false,
				message:
					'The original project is restored; recovery cleanup can retry.',
				state: 'cleanup',
				storyId: entry.storyId,
				storyName: entry.original.name
			};
		}
		if (
			!legacy &&
			journal.phase === 'sealed' &&
			current.atomic &&
			currentFingerprint === entry.provisionalFingerprint
		) {
			return {
				canKeepCurrent: false,
				canRestoreOriginal: false,
				message:
					'The failed replacement is ready for an automatic recovery retry.',
				state: 'retry',
				storyId: entry.storyId,
				storyName: entry.original.name
			};
		}
		const state: LocalReplacementRecoveryIssueState = legacy
			? 'legacy'
			: journal.phase === 'prepared'
				? 'prepared'
				: 'conflict';

		return {
			canKeepCurrent: true,
			canRestoreOriginal: true,
			message:
				state === 'conflict'
					? 'This project changed after the failed import. Choose which version to keep.'
					: state === 'legacy'
						? 'This recovery record predates safe automatic comparison. Choose which version to keep.'
						: 'Recovery was not sealed before project storage changed. Choose which version to keep.',
			state,
			storyId: entry.storyId,
			storyName: entry.original.name
		};
	} catch (error) {
		return {
			canKeepCurrent: true,
			canRestoreOriginal: true,
			message: `The stored project could not be compared safely: ${(error as Error).message}`,
			state: legacy ? 'legacy' : 'conflict',
			storyId: entry.storyId,
			storyName: entry.original.name
		};
	}
}

export function inspectLocalReplacementRecovery(): LocalReplacementRecoveryReport {
	const result = readRecoveryJournal();

	if (result.kind === 'none') {
		return {issues: []};
	}
	if (result.kind === 'invalid') {
		return {
			issues: [
				{
					canKeepCurrent: true,
					canRestoreOriginal: false,
					message: result.message,
					state: 'invalid',
					storyName: 'Invalid recovery record'
				}
			]
		};
	}
	if (result.kind === 'unavailable') {
		return {
			issues: [
				{
					canKeepCurrent: false,
					canRestoreOriginal: false,
					message: result.message,
					state: 'unavailable',
					storyName: 'Browser storage unavailable'
				}
			]
		};
	}
	const {journal, legacy} = normalizeJournal(result.value);

	return {
		issues: journal.entries.map(entry => issueForEntry(entry, journal, legacy))
	};
}

/**
 * Durably records each local project's original contents before replacement.
 * Recovery remains application lifecycle state because it runs before any Rust
 * project session is admitted.
 */
export function prepareLocalReplacementRecovery(stories: StoryWithDocuments[]) {
	if (stories.length === 0) {
		return;
	}
	const existing = readRecoveryJournal();

	if (existing.kind !== 'none') {
		throw new Error(
			existing.kind === 'unavailable'
				? existing.message
				: 'A previous local project replacement still needs recovery. Reload Twine to review it before importing again.'
		);
	}
	const storyIds = new Set<string>();

	for (const story of stories) {
		if (!isStorySnapshot(story) || storyIds.has(story.id)) {
			throw new Error(
				'Local project recovery requires unique, complete projects.'
			);
		}
		storyIds.add(story.id);
	}
	const operationId = `${Date.now().toString(36)}-${Math.random()
		.toString(36)
		.slice(2)}`;

	window.localStorage.setItem(
		localReplacementRecoveryKey,
		JSON.stringify({
			entries: stories.map(original => ({original, storyId: original.id})),
			operationId,
			phase: 'prepared',
			version: 3
		} satisfies LocalReplacementRecoveryJournal)
	);
}

/** Captures the exact provisional contents of each still-unrecovered project. */
export function sealLocalReplacementRecovery() {
	const result = readRecoveryJournal();

	if (result.kind !== 'valid') {
		throw new Error(
			result.kind === 'invalid' || result.kind === 'unavailable'
				? result.message
				: 'No pending local project recovery record exists.'
		);
	}
	if (result.value.version !== 3) {
		throw new Error(
			'The pending local project recovery record cannot be sealed safely.'
		);
	}
	const entries: LocalReplacementRecoveryEntry[] = [];

	for (const entry of result.value.entries) {
		const current = readCurrentStory(entry.storyId);
		const currentFingerprint = storyFingerprint(current.story);

		if (currentFingerprint === storyFingerprint(entry.original)) {
			continue;
		}
		if (!current.atomic) {
			throw new Error(
				`Project ${entry.storyId} does not have an atomic storage snapshot.`
			);
		}
		entries.push({...entry, provisionalFingerprint: currentFingerprint});
	}
	persistJournal({...result.value, phase: 'sealed'}, entries);
}

export function clearLocalReplacementRecovery() {
	window.localStorage.removeItem(localReplacementRecoveryKey);
}

export function hasLocalReplacementRecovery() {
	return window.localStorage.getItem(localReplacementRecoveryKey) !== null;
}

export function localReplacementRecoveryStatus() {
	const result = readRecoveryJournal();

	if (result.kind === 'none') {
		return 'none' as const;
	}
	if (result.kind === 'invalid') {
		return 'invalid' as const;
	}
	if (result.kind === 'unavailable') {
		return 'unavailable' as const;
	}
	if (result.value.version !== 3) {
		return 'legacy' as const;
	}
	return result.value.phase;
}

/**
 * Safely resolves every entry whose current contents are known. Entries are
 * persisted independently so crashes and partial failures are idempotent.
 */
export function recoverLocalReplacementJournal(): LocalReplacementRecoveryReport {
	const result = readRecoveryJournal();

	if (result.kind !== 'valid') {
		return inspectLocalReplacementRecovery();
	}
	const loaded = normalizeJournal(result.value);
	let entries = [...loaded.journal.entries];
	const errors: string[] = [];

	for (const entry of [...entries]) {
		const issue = issueForEntry(entry, loaded.journal, loaded.legacy);

		if (issue.state !== 'cleanup' && issue.state !== 'retry') {
			continue;
		}
		try {
			if (issue.state === 'retry') {
				restoreOriginalStory(entry.original);
			}
			const nextEntries = entries.filter(
				candidate => candidate.storyId !== entry.storyId
			);

			persistJournal(loaded.journal, nextEntries);
			entries = nextEntries;
		} catch (error) {
			errors.push(
				`Could not recover ${entry.original.name}: ${(error as Error).message}`
			);
		}
	}
	const report = inspectLocalReplacementRecovery();

	return errors.length > 0 ? {...report, error: errors.join('\n')} : report;
}

export function resolveLocalReplacementRecovery(
	storyId: string,
	decision: LocalReplacementRecoveryDecision
) {
	const result = readRecoveryJournal();

	if (result.kind !== 'valid') {
		throw new Error(
			result.kind === 'invalid' || result.kind === 'unavailable'
				? result.message
				: 'No pending local project recovery record exists.'
		);
	}
	const {journal} = normalizeJournal(result.value);
	const entry = journal.entries.find(
		candidate => candidate.storyId === storyId
	);

	if (!entry) {
		throw new Error(`No recovery entry exists for project ${storyId}.`);
	}
	if (decision === 'restore-original') {
		restoreOriginalStory(entry.original);
	}
	persistJournal(
		journal,
		journal.entries.filter(candidate => candidate.storyId !== storyId)
	);
	return recoverLocalReplacementJournal();
}

export function discardInvalidLocalReplacementRecovery() {
	const result = readRecoveryJournal();

	if (result.kind !== 'invalid') {
		throw new Error('The local project recovery record is not invalid.');
	}
	window.localStorage.removeItem(localReplacementRecoveryKey);
	return inspectLocalReplacementRecovery();
}
