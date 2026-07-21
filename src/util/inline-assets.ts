import type {CoreAssetInventoryEntry} from '../core/bindings/CoreAssetInventoryEntry';
import type {CoreAssetReference} from '../core/bindings/CoreAssetReference';
import type {StoryWithDocuments as Story} from '../store/stories';

export type AssetMode = 'external' | 'inline-referenced';

export interface InlineAssetPayload {
	bytes: ArrayBuffer | ArrayBufferView;
	mediaType: string;
	path: string;
}

export interface InlineAssetFailure {
	path: string;
	reason: string;
	type?: 'unavailable' | 'unsupported';
}

export interface AssetEmbeddingIssue {
	path: string;
	reason: string;
}

export interface AssetEmbeddingReport {
	assetInliningComplete: boolean;
	externalAssetCount: number;
	inlinedAssetCount: number;
	inlinedEncodedBytes: number;
	inlinedReferenceCount: number;
	inlinedSourceBytes: number;
	unresolvedAssets: AssetEmbeddingIssue[];
	unsupportedAssets: AssetEmbeddingIssue[];
}

export interface InlineReferencedAssetsOptions {
	assetInventory: CoreAssetInventoryEntry[];
	failures?: InlineAssetFailure[];
	payloads: InlineAssetPayload[];
	policy?: {
		maxFileEncodedBytes: number;
		maxFileCount: number;
		maxTotalEncodedBytes: number;
	};
	story: Story;
}

type EmbeddableReference = CoreAssetReference & {
	context?: string;
	fragment?: string | null;
	original?: string;
	query?: string | null;
};

type SourceDocument = {
	get(): string;
	set(value: string): void;
};

const supportedMediaTypes = new Set([
	'image/png',
	'image/jpeg',
	'image/gif',
	'image/svg+xml',
	'image/webp',
	'audio/mpeg',
	'audio/mp4',
	'audio/ogg',
	'audio/wav',
	'video/mp4',
	'video/webm'
]);

function pathKey(path: string) {
	return path.replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

function payloadBytes(payload: InlineAssetPayload) {
	if (payload.bytes instanceof ArrayBuffer) {
		return new Uint8Array(payload.bytes);
	}

	return new Uint8Array(
		payload.bytes.buffer,
		payload.bytes.byteOffset,
		payload.bytes.byteLength
	);
}

function base64(bytes: Uint8Array) {
	let binary = '';
	const chunkSize = 0x8000;

	for (let offset = 0; offset < bytes.length; offset += chunkSize) {
		binary += String.fromCharCode(
			...bytes.subarray(offset, offset + chunkSize)
		);
	}

	return btoa(binary);
}

function dataUrl(payload: InlineAssetPayload) {
	return `data:${payload.mediaType};base64,${base64(payloadBytes(payload))}`;
}

function issueKey(issue: AssetEmbeddingIssue) {
	return `${pathKey(issue.path)}\u0000${issue.reason}`;
}

function addIssue(
	issues: AssetEmbeddingIssue[],
	seen: Set<string>,
	path: string,
	reason: string
) {
	const issue = {path, reason};
	const key = issueKey(issue);

	if (!seen.has(key)) {
		seen.add(key);
		issues.push(issue);
	}
}

function emptyReport(): AssetEmbeddingReport {
	return {
		assetInliningComplete: true,
		externalAssetCount: 0,
		inlinedAssetCount: 0,
		inlinedEncodedBytes: 0,
		inlinedReferenceCount: 0,
		inlinedSourceBytes: 0,
		unresolvedAssets: [],
		unsupportedAssets: []
	};
}

export function externalAssetEmbeddingReport(
	assetInventory: CoreAssetInventoryEntry[] = []
): AssetEmbeddingReport {
	const referenced = assetInventory.filter(asset => asset.referenceCount > 0);

	return {
		...emptyReport(),
		assetInliningComplete: referenced.length === 0,
		externalAssetCount: referenced.length
	};
}

function sourceDocuments(story: Story) {
	const documents = new Map<string, SourceDocument>();

	for (const passage of story.passages) {
		documents.set(passage.id, {
			get: () => passage.text,
			set: value => {
				passage.text = value;
			}
		});
	}

	documents.set(`${story.id}:script`, {
		get: () => story.script,
		set: value => {
			story.script = value;
		}
	});
	documents.set(`${story.id}:stylesheet`, {
		get: () => story.stylesheet,
		set: value => {
			story.stylesheet = value;
		}
	});

	return documents;
}

function documentForReference(
	documents: Map<string, SourceDocument>,
	reference: EmbeddableReference,
	story: Story
) {
	if (reference.passageId) {
		return documents.get(reference.passageId);
	}

	const direct = documents.get(reference.sourceId);

	if (direct) {
		return direct;
	}

	if (/stylesheet/i.test(reference.sourceName)) {
		return documents.get(`${story.id}:stylesheet`);
	}

	if (/javascript|script/i.test(reference.sourceName)) {
		return documents.get(`${story.id}:script`);
	}
}

function cloneStory(story: Story): Story {
	return {
		...story,
		passages: story.passages.map(passage => ({...passage})),
		tagColors: {...story.tagColors},
		tags: [...story.tags]
	};
}

export function inlineReferencedAssets({
	assetInventory,
	failures = [],
	payloads,
	policy = {
		maxFileEncodedBytes: Number.POSITIVE_INFINITY,
		maxFileCount: Number.POSITIVE_INFINITY,
		maxTotalEncodedBytes: Number.POSITIVE_INFINITY
	},
	story
}: InlineReferencedAssetsOptions): {
	report: AssetEmbeddingReport;
	story: Story;
} {
	const transformedStory = cloneStory(story);
	const documents = sourceDocuments(transformedStory);
	const report = emptyReport();
	const unresolvedSeen = new Set<string>();
	const unsupportedSeen = new Set<string>();
	const payloadByPath = new Map(
		payloads.map(payload => [pathKey(payload.path), payload])
	);
	const failureByPath = new Map(
		failures.map(failure => [pathKey(failure.path), failure])
	);
	const embeddedPaths = new Set<string>();
	const embeddedSourceBytes = new Map<string, number>();
	const externalPaths = new Set<string>();
	const replacements = new Map<
		SourceDocument,
		Array<{
			end: number;
			path: string;
			replacement: string;
			start: number;
		}>
	>();
	let scheduledEncodedBytes = 0;
	let scheduledFileCount = 0;

	for (const asset of assetInventory.filter(
		asset => asset.referenceCount > 0
	)) {
		const key = pathKey(asset.path);
		const payload = payloadByPath.get(key);
		const failure = failureByPath.get(key);

		if (failure?.type === 'unsupported') {
			addIssue(
				report.unsupportedAssets,
				unsupportedSeen,
				asset.path,
				failure.reason
			);
			externalPaths.add(key);
			continue;
		}

		if (!payload) {
			addIssue(
				report.unresolvedAssets,
				unresolvedSeen,
				asset.path,
				failure?.reason ??
					(asset.missing
						? 'Referenced project asset is missing.'
						: 'No desktop payload was available for this asset.')
			);
			externalPaths.add(key);
			continue;
		}

		if (!supportedMediaTypes.has(payload.mediaType)) {
			addIssue(
				report.unsupportedAssets,
				unsupportedSeen,
				asset.path,
				`Media type ${payload.mediaType || '(unknown)'} is not supported for embedding.`
			);
			externalPaths.add(key);
			continue;
		}

		if (asset.references.length === 0) {
			addIssue(
				report.unresolvedAssets,
				unresolvedSeen,
				asset.path,
				'Indexed source ranges are unavailable for this referenced asset.'
			);
			externalPaths.add(key);
			continue;
		}

		const replacement = dataUrl(payload);
		let scheduledReference = false;

		if (scheduledFileCount >= policy.maxFileCount) {
			addIssue(
				report.unresolvedAssets,
				unresolvedSeen,
				asset.path,
				`Embedding would exceed the ${policy.maxFileCount}-file limit.`
			);
			externalPaths.add(key);
			continue;
		}

		if (replacement.length > policy.maxFileEncodedBytes) {
			addIssue(
				report.unresolvedAssets,
				unresolvedSeen,
				asset.path,
				'Encoded media exceeds the per-file embedding limit.'
			);
			externalPaths.add(key);
			continue;
		}

		for (const reference of asset.references as EmbeddableReference[]) {
			if (reference.fragment) {
				addIssue(
					report.unresolvedAssets,
					unresolvedSeen,
					asset.path,
					'References with URL fragments remain external.'
				);
				externalPaths.add(key);
				continue;
			}

			const document = documentForReference(
				documents,
				reference,
				transformedStory
			);
			const original = reference.original ?? '';

			if (!document) {
				addIssue(
					report.unresolvedAssets,
					unresolvedSeen,
					asset.path,
					`Source document "${reference.sourceName}" is unavailable.`
				);
				externalPaths.add(key);
				continue;
			}

			if (
				reference.start < 0 ||
				reference.end < reference.start ||
				reference.end > document.get().length ||
				(original &&
					document.get().slice(reference.start, reference.end) !== original)
			) {
				addIssue(
					report.unresolvedAssets,
					unresolvedSeen,
					asset.path,
					`Indexed source range no longer matches "${original || asset.path}".`
				);
				externalPaths.add(key);
				continue;
			}

			const documentReplacements = replacements.get(document) ?? [];
			const overlapsScheduledRange = documentReplacements.some(
				replacementRange =>
					reference.start < replacementRange.end &&
					reference.end > replacementRange.start
			);

			if (overlapsScheduledRange) {
				addIssue(
					report.unresolvedAssets,
					unresolvedSeen,
					asset.path,
					'Overlapping indexed source ranges cannot be embedded safely.'
				);
				externalPaths.add(key);
				continue;
			}

			if (
				scheduledEncodedBytes + replacement.length >
				policy.maxTotalEncodedBytes
			) {
				addIssue(
					report.unresolvedAssets,
					unresolvedSeen,
					asset.path,
					'Encoded media would exceed the total embedding limit.'
				);
				externalPaths.add(key);
				continue;
			}

			documentReplacements.push({
				end: reference.end,
				path: asset.path,
				replacement,
				start: reference.start
			});
			replacements.set(document, documentReplacements);
			scheduledReference = true;
			scheduledEncodedBytes += replacement.length;
		}

		if (scheduledReference) {
			scheduledFileCount++;
			embeddedSourceBytes.set(key, payloadBytes(payload).byteLength);
		}
	}

	for (const [document, documentReplacements] of replacements) {
		let source = document.get();
		let rightBoundary = source.length;

		for (const replacement of documentReplacements.sort(
			(left, right) => right.start - left.start || right.end - left.end
		)) {
			if (replacement.end > rightBoundary) {
				addIssue(
					report.unresolvedAssets,
					unresolvedSeen,
					replacement.path,
					'Overlapping indexed source ranges cannot be embedded safely.'
				);
				externalPaths.add(pathKey(replacement.path));
				continue;
			}

			source =
				source.slice(0, replacement.start) +
				replacement.replacement +
				source.slice(replacement.end);
			rightBoundary = replacement.start;
			embeddedPaths.add(pathKey(replacement.path));
			report.inlinedEncodedBytes += new TextEncoder().encode(
				replacement.replacement
			).byteLength;
			report.inlinedReferenceCount++;
		}

		document.set(source);
	}

	for (const issue of [
		...report.unresolvedAssets,
		...report.unsupportedAssets
	]) {
		externalPaths.add(pathKey(issue.path));
	}

	report.inlinedAssetCount = embeddedPaths.size;
	report.inlinedSourceBytes = [...embeddedPaths].reduce(
		(total, path) => total + (embeddedSourceBytes.get(path) ?? 0),
		0
	);
	report.externalAssetCount = externalPaths.size;
	report.unresolvedAssets.sort((left, right) =>
		issueKey(left).localeCompare(issueKey(right))
	);
	report.unsupportedAssets.sort((left, right) =>
		issueKey(left).localeCompare(issueKey(right))
	);
	report.assetInliningComplete =
		report.externalAssetCount === 0 &&
		report.unresolvedAssets.length === 0 &&
		report.unsupportedAssets.length === 0;

	return {report, story: transformedStory};
}
