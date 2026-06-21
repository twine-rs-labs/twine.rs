import type {CoreAssetReference} from './bindings/CoreAssetReference';
import type {CoreContentsEntry} from './bindings/CoreContentsEntry';
import type {CoreContentsEntryKind} from './bindings/CoreContentsEntryKind';
import type {CoreDiagnostic} from './bindings/CoreDiagnostic';
import type {CoreDiagnosticSeverity} from './bindings/CoreDiagnosticSeverity';
import type {CoreStoryIndex} from './bindings/CoreStoryIndex';
import type {Passage, Story} from '../store/stories';
import {parseLinks} from '../util/parse-links';

export interface ContentsViewModelEntry {
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
	firstReference: CoreAssetReference;
	id: string;
	kind: string;
	path: string;
	referenceCount: number;
	sourceNames: string[];
}

export interface AssetManagerViewModel {
	entries: AssetManagerViewModelEntry[];
	referenceCount: number;
}

export interface WorkbenchSelection {
	assetReferences: CoreAssetReference[];
	diagnostics: CoreDiagnostic[];
	links: string[];
	passage?: Passage;
	sourceId?: string;
	wordCount: number;
}

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

function countWords(text: string) {
	const trimmed = text.trim();

	if (trimmed === '') {
		return 0;
	}

	return trimmed.split(/\s+/).length;
}

function diagnosticLocation(story: Story, diagnostic: CoreDiagnostic) {
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

function diagnosticGroup(diagnostic: CoreDiagnostic) {
	switch (diagnostic.code) {
		case 'broken-link':
			return 'Broken Links';
		case 'duplicate-passage-name':
			return 'Duplicate Names';
		case 'missing-start-passage':
			return 'Project Metadata';
		case 'unreachable-passage':
			return 'Unreachable';
		default:
			return 'Format Errors';
	}
}

export function contentsViewModel(index: CoreStoryIndex): ContentsViewModel {
	const filtersByKind = new Map<
		CoreContentsEntryKind,
		ContentsViewModelFilter
	>();
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
	const byPath = new Map<string, CoreAssetReference[]>();

	for (const asset of index.assets) {
		byPath.set(asset.path, [...(byPath.get(asset.path) ?? []), asset]);
	}

	return {
		entries: Array.from(byPath.entries())
			.sort(([left], [right]) => left.localeCompare(right))
			.map(([path, references]) => ({
				firstReference: references[0],
				id: path,
				kind: references[0].kind,
				path,
				referenceCount: references.length,
				sourceNames: Array.from(
					new Set(references.map(reference => reference.sourceName))
				)
			})),
		referenceCount: index.assets.length
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

	return {
		assetReferences: sourceId
			? index.assets.filter(asset => asset.sourceId === sourceId)
			: [],
		diagnostics: sourceId
			? index.diagnostics.filter(diagnostic => diagnostic.sourceId === sourceId)
			: [],
		links: passage ? parseLinks(passage.text, true) : [],
		passage,
		sourceId,
		wordCount: passage ? countWords(passage.text) : 0
	};
}
