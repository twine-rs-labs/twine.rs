import type {CoreAssetReference} from './bindings/CoreAssetReference';
import type {CoreAssetInventoryEntry} from './bindings/CoreAssetInventoryEntry';
import type {CoreAssetPublishRule} from './bindings/CoreAssetPublishRule';
import type {CoreAssetSnippet} from './bindings/CoreAssetSnippet';
import type {CoreContentsEntry} from './bindings/CoreContentsEntry';
import type {CoreContentsEntryKind} from './bindings/CoreContentsEntryKind';
import type {CoreDiagnostic} from './bindings/CoreDiagnostic';
import type {CoreDiagnosticSeverity} from './bindings/CoreDiagnosticSeverity';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import {assetSnippet, normalizedAssetPath} from './asset-paths';
import type {Passage, Story} from '../store/stories';

export interface ContentsViewModelEntry {
	asset: CoreAssetInventoryEntry | null;
	core: CoreContentsEntry;
	group: string;
	id: string;
	isNavigable: boolean;
	label: string;
	meta: string | null;
	severity: CoreDiagnosticSeverity | null;
}

export interface ContentsViewModelFilter {
	count: number;
	kind: CoreContentsEntryKind;
	label: string;
	severity: CoreDiagnosticSeverity | null;
}

export interface ContentsViewModel {
	entries: ContentsViewModelEntry[];
	filters: ContentsViewModelFilter[];
	problemCount: number;
	totalCount: number;
}

export interface DiagnosticsViewModelItem {
	core: CoreDiagnostic;
	group: string;
	id: string;
	location: string;
	message: string;
	severity: CoreDiagnosticSeverity;
}

export interface DiagnosticsViewModel {
	errorCount: number;
	infoCount: number;
	items: DiagnosticsViewModelItem[];
	totalCount: number;
	warningCount: number;
}

export interface AssetManagerViewModelEntry {
	exists: boolean | null;
	firstReference: CoreAssetReference | null;
	height: number | null;
	id: string;
	inventory: CoreAssetInventoryEntry;
	kind: string;
	missing: boolean;
	path: string;
	publish: CoreAssetPublishRule;
	referenceCount: number;
	references: CoreAssetReference[];
	sizeBytes: number | null;
	snippet: CoreAssetSnippet;
	sourceNames: string[];
	thumbnailUrl: string | null;
	unused: boolean;
	width: number | null;
}

export interface AssetManagerViewModel {
	entries: AssetManagerViewModelEntry[];
	referenceCount: number;
}

export interface WorkbenchSelection {
	assetReferences: CoreAssetReference[];
	backlinks: PassageLinkFact[];
	brokenLinks: PassageLinkFact[];
	diagnostics: CoreDiagnostic[];
	linkFacts: PassageLinkFact[];
	links: string[];
	passage?: Passage;
	passageNames: string[];
	sourceId?: string;
	wordCount: number;
}

export interface PassageLinkFact {
	broken: boolean;
	self: boolean;
	sourceId: string;
	sourceName: string;
	targetId: string | null;
	targetName: string;
}

const storyLinkFactsCache = new WeakMap<Story, PassageLinkFact[]>();

function contentsGroup(kind: CoreContentsEntryKind) {
	switch (kind) {
		case 'passage':
			return 'Passages';
		case 'group':
		case 'tag':
			return 'Tags';
		case 'variable':
			return 'Variables';
		case 'asset':
			return 'Assets';
		case 'brokenLink':
		case 'diagnostic':
		case 'orphan':
			return 'Diagnostics';
		case 'entryPoint':
		case 'metadata':
		case 'script':
		case 'stylesheet':
			return 'Project';
	}
}

function contentsFilterLabel(kind: CoreContentsEntryKind) {
	switch (kind) {
		case 'asset':
			return 'Assets';
		case 'brokenLink':
			return 'Broken links';
		case 'diagnostic':
			return 'Diagnostics';
		case 'entryPoint':
			return 'Entry points';
		case 'group':
			return 'Groups';
		case 'metadata':
			return 'Metadata';
		case 'orphan':
			return 'Orphans';
		case 'passage':
			return 'Passages';
		case 'script':
			return 'Scripts';
		case 'stylesheet':
			return 'Stylesheets';
		case 'tag':
			return 'Tags';
		case 'variable':
			return 'Variables';
	}
}

function passageNamesFromIndex(index: CoreStoryIndex) {
	return index.files
		.filter(file => file.kind === 'passage')
		.map(file => file.name);
}

export function storyShellIndex(
	story: Story,
	knownAssets: CoreAssetInventoryEntry[] = []
): CoreStoryIndex {
	const files = story.passages.map(passage => ({
		characterCount: 0,
		id: passage.id,
		kind: 'passage' as const,
		lineCount: 1,
		name: passage.name,
		passageId: passage.id,
		tags: passage.tags
	}));
	const tagEntries = Array.from(
		story.passages.reduce((result, passage) => {
			for (const tag of passage.tags) {
				const passageIds = result.get(tag) ?? new Set<string>();

				passageIds.add(passage.id);
				result.set(tag, passageIds);
			}

			return result;
		}, new Map<string, Set<string>>())
	)
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([name, passageIds]) => ({
			color: story.tagColors[name] ?? null,
			count: passageIds.size,
			name,
			passageIds: Array.from(passageIds).sort()
		}));
	const contents: CoreStoryIndex['contents'] = [
		{
			count: story.passages.length,
			detail: story.name,
			id: `metadata:${story.id}`,
			kind: 'metadata',
			label: 'Story metadata',
			passageId: null,
			severity: null,
			sourceId: `${story.id}:metadata`
		},
		{
			count: 1,
			detail: `${story.storyFormat} ${story.storyFormatVersion}`,
			id: `format:${story.id}`,
			kind: 'metadata',
			label: 'Story format',
			passageId: null,
			severity: null,
			sourceId: `${story.id}:metadata`
		},
		...story.passages
			.filter(passage => passage.id === story.startPassage)
			.map(passage => ({
				count: 1,
				detail: passage.name,
				id: `entry:${passage.id}`,
				kind: 'entryPoint' as const,
				label: 'Start passage',
				passageId: passage.id,
				severity: null,
				sourceId: passage.id
			})),
		...files.map(file => ({
			count: file.lineCount,
			detail: `${file.characterCount} characters`,
			id: `source:${file.id}`,
			kind: 'passage' as const,
			label: file.name,
			passageId: file.passageId,
			severity: null,
			sourceId: file.id
		})),
		...tagEntries.map(tag => ({
			count: tag.count,
			detail: tag.color,
			id: `tag:${tag.name}`,
			kind: 'tag' as const,
			label: tag.name,
			passageId: tag.passageIds[0] ?? null,
			severity: null,
			sourceId: tag.passageIds[0] ?? null
		})),
		...knownAssets.map(asset => ({
			count: asset.referenceCount,
			detail: asset.missing ? 'missing' : asset.unused ? 'unused' : asset.kind,
			id: `asset:${asset.path}`,
			kind: 'asset' as const,
			label: asset.path,
			passageId: asset.references[0]?.passageId ?? null,
			severity: asset.missing ? ('error' as const) : null,
			sourceId: asset.references[0]?.sourceId ?? `${story.id}:assets`
		}))
	];

	return {
		assetInventory: knownAssets,
		assets: [],
		contents,
		diagnostics: [],
		files: [
			...files,
			{
				characterCount: story.script.length,
				id: `${story.id}:script`,
				kind: 'script',
				lineCount: 1,
				name: 'Story JavaScript',
				passageId: null,
				tags: []
			},
			{
				characterCount: story.stylesheet.length,
				id: `${story.id}:stylesheet`,
				kind: 'stylesheet',
				lineCount: 1,
				name: 'Story Stylesheet',
				passageId: null,
				tags: []
			}
		],
		graph: {
			brokenLinks: 0,
			emptyPassages: 0,
			links: 0,
			orphanPassages: 0,
			passages: story.passages.length,
			resolvedLinks: 0,
			selfLinks: 0,
			taggedPassages: story.passages.filter(passage => passage.tags.length > 0)
				.length,
			unreachablePassages: 0
		},
		replacePreviews: [],
		searchHits: [],
		storyId: story.id,
		tags: Array.from(
			new Set(story.passages.flatMap(passage => passage.tags))
		).sort(),
		tagEntries,
		symbols: []
	};
}

export function storyLinkFacts(story: Story): PassageLinkFact[] {
	const cached = storyLinkFactsCache.get(story);

	if (cached) {
		return cached;
	}

	const facts: PassageLinkFact[] = [];

	storyLinkFactsCache.set(story, facts);
	return facts;
}

export function diagnosticLocation(story: Story, diagnostic: CoreDiagnostic) {
	const passage = diagnostic.passageId
		? story.passages.find(passage => passage.id === diagnostic.passageId)
		: undefined;
	const sourceName =
		passage?.name ??
		(diagnostic.sourceId.endsWith(':script')
			? 'Story JavaScript'
			: diagnostic.sourceId.endsWith(':stylesheet')
				? 'Story Stylesheet'
				: 'Story metadata');

	return `${sourceName}:${diagnostic.line}`;
}

export function diagnosticGroup(diagnostic: CoreDiagnostic) {
	switch (diagnostic.code) {
		case 'broken-link':
			return 'Broken Links';
		case 'duplicate-passage-name':
			return 'Duplicate Names';
		case 'missing-asset':
		case 'unused-asset':
			return 'Assets';
		case 'missing-start-passage':
			return 'Project Metadata';
		case 'unreachable-passage':
			return 'Unreachable';
		default:
			return 'Format Errors';
	}
}

function assetPublishRule(path: string): CoreAssetPublishRule {
	return {
		copy: true,
		outputPath: path,
		reason: 'Copy asset into published output'
	};
}

function fallbackAssetInventory(
	references: CoreAssetReference[]
): CoreAssetInventoryEntry[] {
	const byPath = new Map<string, CoreAssetReference[]>();

	for (const reference of references) {
		byPath.set(reference.path, [
			...(byPath.get(reference.path) ?? []),
			reference
		]);
	}

	return Array.from(byPath.entries())
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([path, references]) => {
			const kind = references[0]?.kind ?? 'file';

			return {
				durationMs: null,
				exists: null,
				height: null,
				kind,
				missing: false,
				modifiedAt: null,
				normalizedPath: normalizedAssetPath(path),
				path,
				previewUrl: null,
				publish: assetPublishRule(path),
				referenceCount: references.length,
				references,
				sizeBytes: null,
				snippet: assetSnippet(path, kind),
				thumbnailUrl: null,
				unused: false,
				width: null
			};
		});
}

export function contentsViewModel(index: CoreStoryIndex): ContentsViewModel {
	const filtersByKind = new Map<
		CoreContentsEntryKind,
		ContentsViewModelFilter
	>();
	const assetsByPath = new Map(
		index.assetInventory.map(asset => [asset.path, asset])
	);
	const entries = index.contents.map(entry => {
		const existing = filtersByKind.get(entry.kind);
		const severity = entry.severity ?? null;

		filtersByKind.set(entry.kind, {
			count: (existing?.count ?? 0) + 1,
			kind: entry.kind,
			label: contentsFilterLabel(entry.kind),
			severity: existing?.severity ?? severity
		});

		return {
			asset:
				entry.kind === 'asset' ? (assetsByPath.get(entry.label) ?? null) : null,
			core: entry,
			group: contentsGroup(entry.kind),
			id: entry.id,
			isNavigable: !!entry.passageId || !!entry.sourceId,
			label: entry.label,
			meta: entry.detail,
			severity
		};
	});

	return {
		entries,
		filters: Array.from(filtersByKind.values()).sort((left, right) =>
			left.label.localeCompare(right.label)
		),
		problemCount: entries.filter(entry => !!entry.severity).length,
		totalCount: entries.length
	};
}

export function diagnosticsViewModel(
	index: CoreStoryIndex,
	story: Story
): DiagnosticsViewModel {
	const items = index.diagnostics.map((diagnostic, ordinal) => ({
		core: diagnostic,
		group: diagnosticGroup(diagnostic),
		id: `${diagnostic.sourceId}:${diagnostic.code}:${diagnostic.start}:${ordinal}`,
		location: diagnosticLocation(story, diagnostic),
		message: diagnostic.message,
		severity: diagnostic.severity
	}));

	return {
		errorCount: items.filter(item => item.severity === 'error').length,
		infoCount: items.filter(item => item.severity === 'info').length,
		items,
		totalCount: items.length,
		warningCount: items.filter(item => item.severity === 'warning').length
	};
}

export function assetManagerViewModel(
	index: CoreStoryIndex
): AssetManagerViewModel {
	const indexedInventory = index.assetInventory ?? [];
	const inventory =
		indexedInventory.length > 0
			? [...indexedInventory].sort((left, right) =>
					left.path.localeCompare(right.path)
				)
			: fallbackAssetInventory(index.assets);

	return {
		entries: inventory.map(asset => ({
			exists: asset.exists,
			firstReference: asset.references[0] ?? null,
			height: asset.height,
			id: asset.path,
			inventory: asset,
			kind: asset.kind,
			missing: asset.missing,
			path: asset.path,
			publish: asset.publish,
			referenceCount: asset.referenceCount,
			references: asset.references,
			sizeBytes: asset.sizeBytes,
			snippet: asset.snippet,
			sourceNames: Array.from(
				new Set(asset.references.map(reference => reference.sourceName))
			),
			thumbnailUrl: asset.thumbnailUrl,
			unused: asset.unused,
			width: asset.width
		})),
		referenceCount: inventory.reduce(
			(total, asset) => total + asset.referenceCount,
			0
		)
	};
}

export function workbenchSelection(
	story: Story,
	index: CoreStoryIndex,
	selectedPassageId?: string
): WorkbenchSelection {
	const passage =
		story.passages.find(passage => passage.id === selectedPassageId) ??
		story.passages.find(passage => passage.id === story.startPassage) ??
		story.passages[0];
	const sourceId = passage?.id;
	const allLinkFacts = storyLinkFacts(story);
	const linkFacts = sourceId
		? allLinkFacts.filter(fact => fact.sourceId === sourceId)
		: [];

	return {
		assetReferences: sourceId
			? index.assets.filter(asset => asset.sourceId === sourceId)
			: [],
		backlinks: passage
			? allLinkFacts.filter(
					fact =>
						fact.sourceId !== passage.id && fact.targetName === passage.name
				)
			: [],
		brokenLinks: linkFacts.filter(fact => fact.broken),
		diagnostics: sourceId
			? index.diagnostics.filter(diagnostic => diagnostic.sourceId === sourceId)
			: [],
		linkFacts,
		links: linkFacts.map(fact => fact.targetName),
		passage,
		passageNames: passageNamesFromIndex(index),
		sourceId,
		wordCount: 0
	};
}
